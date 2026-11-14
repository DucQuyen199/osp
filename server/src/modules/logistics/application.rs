//! Logistics source-event and shipment preparation use cases.
use super::domain::{id, number};
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if tenant.has_module("logistics") && event_type == "logistics.tracking_event.created" {
        return apply_tracking_delivery(kernel, tx, tenant, document, event_id, depth).await;
    }
    if !tenant.has_module("logistics")
        || event_type != "sales.sales_order.confirmed"
        || document
            .get("shipping_address")
            .and_then(Value::as_str)
            .is_none_or(|address| address.trim().is_empty())
    {
        return Ok(false);
    }
    let source_id = document.get("id").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Confirmed sales order requires an id for shipment creation".into()],
        )
    })?;
    let mut data = Map::new();
    for (target, source) in [
        ("party", "party"),
        ("warehouse", "warehouse"),
        ("lines", "lines"),
        ("destination", "shipping_address"),
    ] {
        if let Some(value) = document.get(source) {
            data.insert(target.into(), value.clone());
        }
    }
    data.insert("source".into(), json!("sales_order"));
    data.insert("source_id".into(), source_id);
    let entity = kernel.ent(tenant, "logistics.shipment")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

async fn apply_tracking_delivery(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event.get("status").and_then(Value::as_str) != Some("delivered") {
        return Ok(true);
    }
    let Some(shipment_id) = event
        .get("shipment")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(crate::error::ApiError::validation(
            "logistics.tracking_event",
            vec!["Delivered tracking event requires a valid shipment".into()],
        ));
    };
    let shipment = tx
        .query_opt(
            "SELECT status FROM logistics__shipment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &shipment_id],
        )
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "logistics.tracking_event",
                vec!["Shipment for delivered tracking event was not found".into()],
            )
        })?;
    let status: String = shipment.get(0);
    if status != "dispatched" {
        // Keep late carrier scans as history without replaying fulfillment for
        // a shipment that has already been finalized or replaced by a retry.
        return Ok(true);
    }
    let Some(occurred_at) = event.get("occurred_at").and_then(Value::as_str) else {
        return Err(crate::error::ApiError::validation(
            "logistics.tracking_event",
            vec!["Delivered tracking event requires its occurrence time".into()],
        ));
    };
    let description = event
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("Carrier marked the shipment delivered");
    let carrier_reference = event
        .get("carrier_event_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("Carrier event {value}: "))
        .unwrap_or_default();
    let location = event
        .get("location")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" Location: {value}."))
        .unwrap_or_default();
    let evidence = format!("{carrier_reference}{description}.{location}")
        .chars()
        .take(1000)
        .collect::<String>();
    let shipment_entity = kernel.ent(tenant, "logistics.shipment")?;
    let child = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &shipment_entity,
            &shipment_id.to_string(),
            Map::from_iter([
                ("delivered_at".into(), json!(occurred_at)),
                ("delivery_evidence".into(), json!(evidence)),
            ]),
            &child,
        )
        .await?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &shipment_entity,
            &shipment_id.to_string(),
            "delivered",
            &child,
        )
        .await?;
    Ok(true)
}

/// Snapshot order lines and calculate shipment weight for a full or partial delivery.
pub async fn prepare_shipment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if document.get("source").and_then(Value::as_str) != Some("sales_order") {
        return Ok(Vec::new());
    }
    if !tenant.has_module("sales") {
        return Ok(vec![
            "Cần bật module bán hàng để tạo vận đơn từ đơn bán".into(),
        ]);
    }
    let Some(order_id) = id(&Value::Object(document.clone()), "source_id") else {
        return Ok(vec!["Vận đơn cần tham chiếu đơn bán hợp lệ".into()]);
    };
    let Some(order) = tx.query_opt(
        "SELECT status, party, shipping_address, warehouse, lines FROM sales__sales_order WHERE tenant_id = $1 AND id = $2",
        &[&tenant.id, &order_id],
    ).await? else {
        return Ok(vec!["Không tìm thấy đơn bán trong doanh nghiệp".into()]);
    };
    let status: String = order.get(0);
    let party: Option<Uuid> = order.get(1);
    let address: Option<String> = order.get(2);
    let order_warehouse: Option<Uuid> = order.get(3);
    let order_lines: Value = order.get(4);
    if !matches!(status.as_str(), "confirmed" | "partially_delivered") {
        return Ok(vec!["Chỉ tạo vận đơn từ đơn bán đã xác nhận".into()]);
    }
    if document
        .get("party")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        != party
    {
        return Ok(vec!["Khách hàng trên vận đơn phải khớp đơn bán".into()]);
    }
    if let Some(address) = address.as_deref() {
        if document.get("destination").and_then(Value::as_str) != Some(address) {
            return Ok(vec![
                "Địa chỉ giao vận đơn phải khớp địa chỉ trên đơn bán".into(),
            ]);
        }
    }
    if document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .is_some_and(|warehouse| Some(warehouse) != order_warehouse)
    {
        return Ok(vec!["Kho vận đơn phải khớp kho trên đơn bán".into()]);
    }
    if document.get("warehouse").is_none_or(Value::is_null) {
        if let Some(warehouse) = order_warehouse {
            document.insert("warehouse".into(), json!(warehouse));
        }
    }
    let Some(ordered_lines) = order_lines.as_array() else {
        return Ok(vec![
            "Đơn bán cần có danh sách hàng để tính khối lượng vận chuyển".into(),
        ]);
    };
    let requested_lines = document
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| ordered_lines.clone());
    if requested_lines.is_empty() {
        return Ok(vec!["Vận đơn cần có ít nhất một dòng hàng".into()]);
    }
    let mut normalized = Vec::with_capacity(requested_lines.len());
    for (index, requested) in requested_lines.iter().enumerate() {
        let product = requested.get("product").and_then(Value::as_str);
        let price = requested.get("price").and_then(money::decimal);
        let qty = requested.get("qty").and_then(money::decimal);
        let (Some(product), Some(price), Some(qty)) = (product, price, qty) else {
            return Ok(vec![format!(
                "Dòng vận đơn {} cần product, price và qty hợp lệ",
                index + 1
            )]);
        };
        if qty <= Decimal::ZERO || price < Decimal::ZERO {
            return Ok(vec![format!(
                "Dòng vận đơn {} có giá/số lượng không hợp lệ",
                index + 1
            )]);
        }
        let Some(mut line) = ordered_lines
            .iter()
            .find(|line| {
                line.get("product").and_then(Value::as_str) == Some(product)
                    && requested
                        .get("uom")
                        .and_then(Value::as_str)
                        .is_none_or(|unit| line.get("uom").and_then(Value::as_str) == Some(unit))
                    && line
                        .get("price")
                        .and_then(money::decimal)
                        .is_some_and(|ordered_price| {
                            money::within_tolerance(ordered_price, price, Decimal::new(5, 3))
                        })
            })
            .cloned()
        else {
            return Ok(vec![format!(
                "Dòng vận đơn {} không khớp mặt hàng/đơn giá trong đơn bán",
                index + 1
            )]);
        };
        if let Some(line) = line.as_object_mut() {
            line.insert(
                "qty".into(),
                money::json_number(qty).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "logistics.shipment",
                        vec!["Shipment quantity exceeds the supported decimal range".into()],
                    )
                })?,
            );
            let ratio = line
                .get("uom_ratio")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ONE);
            let base_qty = qty.checked_mul(ratio).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "logistics.shipment",
                    vec!["Shipment base quantity exceeds the supported decimal range".into()],
                )
            })?;
            line.insert(
                "base_qty".into(),
                money::json_number(base_qty).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "logistics.shipment",
                        vec!["Shipment base quantity cannot be serialized".into()],
                    )
                })?,
            );
        }
        normalized.push(line);
    }
    document.insert("lines".into(), Value::Array(normalized.clone()));
    let mut total_weight = Decimal::ZERO;
    let mut errors = Vec::new();
    for (index, line) in normalized.iter().enumerate() {
        let product_id = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let qty = line
            .get("base_qty")
            .and_then(money::decimal)
            .or_else(|| line.get("qty").and_then(money::decimal));
        let (Some(product_id), Some(qty)) =
            (product_id, qty.filter(|value| *value > Decimal::ZERO))
        else {
            errors.push(format!(
                "Dòng đơn bán {} không có sản phẩm/số lượng hợp lệ để tính tải trọng",
                index + 1
            ));
            continue;
        };
        let product = tx.query_opt(
            "SELECT kind, weight::text, active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        ).await?;
        let Some(product) = product else {
            errors.push(format!(
                "Không tìm thấy sản phẩm của dòng đơn bán {} trong doanh nghiệp",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let kind = kind.unwrap_or_else(|| "goods".into());
        let weight: Option<String> = product.get(1);
        let weight = weight.and_then(|value| money::decimal_str(&value));
        let active: Option<bool> = product.get(2);
        if active == Some(false) {
            errors.push(format!(
                "Sản phẩm ở dòng đơn bán {} đã ngừng hoạt động",
                index + 1
            ));
            continue;
        }
        let unit_weight = if kind == "goods" {
            match weight.filter(|value| *value >= Decimal::ZERO) {
                Some(value) => value,
                None => {
                    errors.push(format!(
                        "Cần khai báo khối lượng sản phẩm ở dòng đơn bán {}",
                        index + 1
                    ));
                    continue;
                }
            }
        } else {
            Decimal::ZERO
        };
        let Some(line_weight) = unit_weight.checked_mul(qty) else {
            errors.push("Shipment line weight exceeds the supported decimal range".into());
            continue;
        };
        let Some(updated_total) = total_weight.checked_add(line_weight) else {
            errors.push("Total shipment weight exceeds the supported decimal range".into());
            continue;
        };
        total_weight = updated_total;
    }
    if total_weight < Decimal::ZERO {
        errors.push("Tổng khối lượng vận chuyển không hợp lệ".into());
    }
    if let Some(weight) = number(&Value::Object(document.clone()), "weight") {
        if !money::within_tolerance(weight, total_weight, Decimal::new(1, 3)) {
            errors.push("Khối lượng vận đơn không khớp tổng khối lượng hàng trên đơn bán".into());
        }
    }
    if errors.is_empty() {
        document.insert(
            "weight".into(),
            money::json_number(total_weight).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "logistics.shipment",
                    vec!["Total shipment weight exceeds the supported decimal range".into()],
                )
            })?,
        );
    }
    Ok(errors)
}
