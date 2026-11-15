//! Tenant-scoped shipment, vehicle, and source-order validation.
use super::domain::{id, number};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Hash, PartialEq, Eq)]
enum PriceBucket {
    Cents(Decimal, Option<String>),
}

fn price_bucket(price: Decimal, unit: Option<String>) -> PriceBucket {
    PriceBucket::Cents(
        price.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero),
        unit,
    )
}

fn quantities(lines: &Value) -> R<HashMap<(String, PriceBucket), Decimal>> {
    let Some(lines) = lines.as_array() else {
        return Err(crate::error::ApiError::validation(
            "logistics.shipment",
            vec![
                "Shipment source lines are missing or invalid; quantities cannot be verified"
                    .into(),
            ],
        ));
    };
    let mut result = HashMap::new();
    for (index, line) in lines.iter().enumerate() {
        if !line.is_object() {
            return Err(crate::error::ApiError::validation(
                "logistics.shipment",
                vec![format!(
                    "Shipment line {} is invalid; quantities cannot be verified",
                    index + 1
                )],
            ));
        }
        if matches!(
            line.get("kind").and_then(Value::as_str),
            Some("service" | "digital")
        ) {
            continue;
        }
        let (Some(product), Some(price), Some(qty)) = (
            line.get("product").and_then(Value::as_str),
            line.get("price").and_then(money::decimal),
            line.get("qty").and_then(money::decimal),
        ) else {
            return Err(crate::error::ApiError::validation(
                "logistics.shipment",
                vec![format!(
                    "Shipment line {} is incomplete; quantities cannot be verified",
                    index + 1
                )],
            ));
        };
        if Uuid::parse_str(product).is_err() || price < Decimal::ZERO || qty <= Decimal::ZERO {
            return Err(crate::error::ApiError::validation(
                "logistics.shipment",
                vec![format!(
                    "Shipment line {} has an invalid product, price, or quantity",
                    index + 1
                )],
            ));
        }
        let key = (
            product.to_string(),
            price_bucket(
                price,
                line.get("uom").and_then(Value::as_str).map(str::to_owned),
            ),
        );
        let total = result.entry(key).or_insert(Decimal::ZERO);
        *total = total.checked_add(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "logistics.shipment",
                vec!["Shipment quantity exceeds the supported decimal range".into()],
            )
        })?;
    }
    Ok(result)
}

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: Option<String> = row.get(column);
    value
        .as_deref()
        .and_then(money::decimal_str)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "logistics.persistence",
                vec![format!("Stored logistics {field} is not a valid decimal")],
            )
        })
}

async fn validate_sales_shipment_quantities(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    if document.get("source").and_then(Value::as_str) != Some("sales_order") {
        return Ok(Vec::new());
    }
    let Some(order_id) = id(document, "source_id") else {
        return Ok(vec![
            "Vận đơn bán hàng cần tham chiếu đơn bán hợp lệ".into(),
        ]);
    };
    let Some(order) = tx.query_opt(
        "SELECT status, warehouse, lines FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &order_id],
    ).await? else {
        return Ok(vec!["Không tìm thấy đơn bán trong doanh nghiệp".into()]);
    };
    let status: String = order.get(0);
    let order_warehouse: Option<Uuid> = order.get(1);
    let order_lines: Value = order.get(2);
    let shipment_warehouse = id(document, "warehouse");
    let mut errors = Vec::new();
    if !matches!(status.as_str(), "confirmed" | "partially_delivered") {
        errors.push("Chỉ nhận giao từng phần cho đơn bán đang xác nhận".into());
    }
    if shipment_warehouse != order_warehouse {
        errors.push("Kho vận đơn phải khớp kho trên đơn bán".into());
    }
    let ordered = quantities(&order_lines)?;
    let requested = quantities(document.get("lines").unwrap_or(&Value::Null))?;
    if requested.is_empty() {
        errors.push("Vận đơn bán hàng cần ít nhất một dòng hợp lệ".into());
    }
    let current_id = id(document, "id").unwrap_or(Uuid::nil());
    let prior_rows = tx.query(
        "SELECT CASE WHEN status = 'delivered' THEN COALESCE(delivered_lines, lines) ELSE lines END FROM logistics__shipment WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND id <> $3 AND status IN ('created', 'dispatched', 'delivered') FOR UPDATE",
        &[&tenant.id, &order_id.to_string(), &current_id],
    ).await?;
    let mut reserved = HashMap::<(String, PriceBucket), Decimal>::new();
    for row in prior_rows {
        let lines: Value = row.get(0);
        for (key, qty) in quantities(&lines)? {
            let total = reserved.entry(key).or_default();
            *total = total.checked_add(qty).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "logistics.shipment",
                    vec!["Reserved shipment quantity exceeds the supported decimal range".into()],
                )
            })?;
        }
    }
    for (key, qty) in requested {
        let ordered_qty = ordered.get(&key).copied().unwrap_or_default();
        let already_assigned = reserved.get(&key).copied().unwrap_or_default();
        if ordered_qty <= Decimal::ZERO {
            errors.push(format!("Mặt hàng {} không nằm trong đơn bán", key.0));
        } else if already_assigned.checked_add(qty).is_none_or(|total| {
            total
                > ordered_qty
                    .checked_add(Decimal::new(1, 6))
                    .unwrap_or(ordered_qty)
        }) {
            errors.push(format!(
                "Tổng lượng vận đơn vượt số lượng đơn bán cho mặt hàng {}",
                key.0
            ));
        }
    }
    Ok(errors)
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "shipment" && action == "updated" {
        return validate_sales_shipment_quantities(tx, tenant, document).await;
    }
    let mut errors = Vec::new();
    match (entity, action) {
        ("tracking_event", "created") => {
            let Some(shipment) = id(document, "shipment") else {
                return Ok(vec!["Tracking event requires a valid shipment".into()]);
            };
            let shipment_row = tx
                .query_opt(
                    "SELECT status FROM logistics__shipment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &shipment],
                )
                .await?;
            let Some(shipment_row) = shipment_row else {
                return Ok(vec!["Shipment was not found in this tenant".into()]);
            };
            if shipment_row.get::<_, String>(0) == "created" {
                errors.push("Tracking events can only be recorded after dispatch".into());
            }
            if let Some(carrier_event_id) = document
                .get("carrier_event_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                let lock_key = format!("logistics-tracking:{}:{shipment}", tenant.id);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                if tx
                    .query_opt(
                        "SELECT id FROM logistics__tracking_event WHERE tenant_id = $1 AND shipment = $2 AND carrier_event_id = $3 LIMIT 1 FOR UPDATE",
                        &[&tenant.id, &shipment, &carrier_event_id],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("This carrier tracking event has already been recorded".into());
                }
            }
        }
        ("shipment", "created")
            if document.get("source").and_then(Value::as_str) == Some("sales_order") =>
        {
            let Some(order_id) = id(document, "source_id") else {
                return Ok(vec![
                    "Vận đơn bán hàng cần tham chiếu đơn bán hợp lệ".into(),
                ]);
            };
            let order = tx.query_opt(
                "SELECT status, party, shipping_address FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &order_id],
            ).await?;
            let Some(order) = order else {
                return Ok(vec!["Không tìm thấy đơn bán trong doanh nghiệp".into()]);
            };
            let order_status: String = order.get(0);
            let order_party: Option<Uuid> = order.get(1);
            let order_address: Option<String> = order.get(2);
            if !matches!(order_status.as_str(), "confirmed" | "partially_delivered")
                || document
                    .get("party")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    != order_party
            {
                errors.push("Chỉ tạo vận đơn cho đúng khách hàng trên đơn bán đã xác nhận".into());
            }
            if let Some(address) = order_address.as_deref() {
                if document.get("destination").and_then(Value::as_str) != Some(address) {
                    errors.push("Địa chỉ giao vận đơn phải khớp đơn bán".into());
                }
            }
            errors.extend(validate_sales_shipment_quantities(tx, tenant, document).await?);
        }
        ("vehicle", "created" | "updated") => {
            if let Some(plate) = document.get("plate").and_then(Value::as_str) {
                let record = id(document, "id").unwrap_or(Uuid::nil());
                if tx.query_opt(
                    "SELECT 1 FROM logistics__vehicle WHERE tenant_id = $1 AND lower(plate) = lower($2) AND id <> $3 LIMIT 1",
                    &[&tenant.id, &plate, &record],
                ).await?.is_some() {
                    errors.push("Biển số phương tiện đã tồn tại trong doanh nghiệp".into());
                }
            }
        }
        ("driver", "created" | "updated") => {
            if let Some(license) = document
                .get("license")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                let record = id(document, "id").unwrap_or(Uuid::nil());
                if tx.query_opt(
                    "SELECT 1 FROM logistics__driver WHERE tenant_id = $1 AND lower(license) = lower($2) AND id <> $3 LIMIT 1",
                    &[&tenant.id, &license, &record],
                ).await?.is_some() {
                    errors.push("Số giấy phép lái xe đã được đăng ký".into());
                }
            }
        }
        ("shipment", "dispatched") => {
            let Some(vehicle) = id(document, "vehicle") else {
                return Ok(vec!["Cần phân công phương tiện trước khi xuất phát".into()]);
            };
            let Some(driver) = id(document, "driver") else {
                return Ok(vec!["Cần phân công tài xế trước khi xuất phát".into()]);
            };
            let weight = number(document, "weight");
            let vehicle_row = tx.query_opt(
                "SELECT capacity::text FROM logistics__vehicle WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &vehicle],
            ).await?;
            let Some(vehicle_row) = vehicle_row else {
                return Ok(vec!["Không tìm thấy phương tiện trong doanh nghiệp".into()]);
            };
            let capacity = decimal_column(&vehicle_row, 0, "vehicle capacity").ok();
            if let Some(weight) = weight {
                if !capacity.is_some_and(|capacity| capacity >= weight) {
                    errors.push(
                        "Khối lượng hàng vượt tải trọng hoặc phương tiện chưa khai báo tải trọng"
                            .into(),
                    );
                }
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM logistics__driver WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &driver],
                )
                .await?
                .is_none()
            {
                errors.push("Không tìm thấy tài xế trong doanh nghiệp".into());
            }
            // A dispatched trip has no planned end time, so its driver and
            // vehicle stay reserved until the shipment is delivered or failed.
            // Serialize dispatch attempts by resource to prevent two concurrent
            // requests from assigning the same resource at once.
            let mut resource_locks = [
                format!("logistics-dispatch:{}:vehicle:{vehicle}", tenant.id),
                format!("logistics-dispatch:{}:driver:{driver}", tenant.id),
            ];
            resource_locks.sort_unstable();
            for lock_key in resource_locks {
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
            }
            if tx
                .query_opt(
                    "SELECT id FROM logistics__shipment WHERE tenant_id = $1 AND status = 'dispatched' AND id <> $2 AND (vehicle = $3 OR driver = $4) LIMIT 1 FOR UPDATE",
                    &[
                        &tenant.id,
                        &id(document, "id").unwrap_or(Uuid::nil()),
                        &vehicle,
                        &driver,
                    ],
                )
                .await?
                .is_some()
            {
                errors.push("A vehicle or driver is already assigned to an active shipment".into());
            }
            if document.get("source").and_then(Value::as_str) == Some("sales_order") {
                if !tenant.has_module("sales") {
                    errors.push("Module bán hàng phải được bật để giao vận đơn bán hàng".into());
                    return Ok(errors);
                }
                let Some(order_id) = id(document, "source_id") else {
                    errors.push("Vận đơn bán hàng cần tham chiếu đơn bán hợp lệ".into());
                    return Ok(errors);
                };
                let order = tx.query_opt(
                    "SELECT status, party FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &order_id],
                ).await?;
                if !order.is_some_and(|row| {
                    matches!(
                        row.get::<_, String>(0).as_str(),
                        "confirmed" | "partially_delivered"
                    ) && document
                        .get("party")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok())
                        == row.get::<_, Option<Uuid>>(1)
                }) {
                    errors.push("Chỉ được giao vận đơn khớp với đơn bán đã xác nhận".into());
                }
                errors.extend(validate_sales_shipment_quantities(tx, tenant, document).await?);
            }
        }
        ("shipment", "delivered")
            if document.get("source").and_then(Value::as_str) == Some("sales_order") =>
        {
            if !tenant.has_module("sales") {
                return Ok(vec![
                    "Module bán hàng phải được bật để hoàn tất vận đơn bán hàng".into(),
                ]);
            }
            let Some(order_id) = id(document, "source_id") else {
                return Ok(vec![
                    "Vận đơn bán hàng cần tham chiếu đơn bán hợp lệ".into(),
                ]);
            };
            if tx.query_opt(
                "SELECT 1 FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 AND status IN ('confirmed', 'partially_delivered') FOR UPDATE",
                &[&tenant.id, &order_id],
            ).await?.is_none() {
                errors.push("Đơn bán phải còn ở trạng thái đã xác nhận trước khi hoàn tất giao hàng".into());
            }
            errors.extend(validate_sales_shipment_quantities(tx, tenant, document).await?);
        }
        ("vehicle" | "driver", "removed") => {
            let record = id(document, "id").unwrap_or(Uuid::nil());
            let query = if entity == "vehicle" {
                "SELECT 1 FROM logistics__shipment WHERE tenant_id = $1 AND vehicle = $2 LIMIT 1"
            } else {
                "SELECT 1 FROM logistics__shipment WHERE tenant_id = $1 AND driver = $2 LIMIT 1"
            };
            if tx.query_opt(query, &[&tenant.id, &record]).await?.is_some() {
                errors.push("Không xóa được hồ sơ đội xe đang được vận đơn tham chiếu".into());
            }
        }
        ("shipment", "removed") => {
            if document.get("status").and_then(Value::as_str) != Some("created") {
                errors.push("Chỉ được xóa vận đơn chưa xuất phát".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
