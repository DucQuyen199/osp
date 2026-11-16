//! Pharmacy side effects from a completed point-of-sale transaction.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity != "prescription" {
        return Ok(Vec::new());
    }
    let Some(items) = document.get_mut("items").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    for (index, item) in items.iter_mut().enumerate() {
        let Some(item) = item.as_object_mut() else {
            errors.push(format!("Prescription item {} must be an object", index + 1));
            continue;
        };
        for field in ["base_qty", "uom_name", "uom_ratio", "base_uom"] {
            item.remove(field);
        }
        let Some(product_id) = item
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let selected_unit = match item.get("uom") {
            Some(Value::String(value)) => match Uuid::parse_str(value) {
                Ok(unit) => Some(unit),
                Err(_) => {
                    errors.push(format!(
                        "Prescription unit on item {} is invalid",
                        index + 1
                    ));
                    continue;
                }
            },
            Some(value) if !value.is_null() => {
                errors.push(format!(
                    "Prescription unit on item {} is invalid",
                    index + 1
                ));
                continue;
            }
            _ => None,
        };
        let unit = match crate::modules::master_data::unit_conversion::resolve(
            tx,
            tenant,
            product_id,
            selected_unit,
        )
        .await?
        {
            Ok(unit) => unit,
            Err(message) => {
                errors.push(format!(
                    "Prescription unit on item {}: {message}",
                    index + 1
                ));
                continue;
            }
        };
        if let Some(quantity) = item.get("qty").and_then(crate::money::decimal) {
            let Some(base_quantity) = unit
                .base_quantity(quantity)
                .and_then(crate::money::json_number)
            else {
                errors.push(format!(
                    "Prescription quantity on item {} exceeds the supported range",
                    index + 1
                ));
                continue;
            };
            item.insert("base_qty".into(), base_quantity);
        }
        if let Some(unit_id) = unit.unit_id {
            item.insert("uom".into(), serde_json::json!(unit_id));
        }
        if let Some(name) = unit.unit_name {
            item.insert("uom_name".into(), serde_json::json!(name));
        }
        if let Some(base_unit) = unit.base_unit_id {
            item.insert("base_uom".into(), serde_json::json!(base_unit));
        }
        item.insert("uom_ratio".into(), serde_json::json!(unit.ratio));
    }
    Ok(errors)
}

/// Sum quantities from completed, non-refunded POS orders linked to a prescription.
pub(super) async fn dispensed_quantities(
    tx: &Tx<'_>,
    tenant: &Tenant,
    prescription_id: Uuid,
) -> R<BTreeMap<Uuid, rust_decimal::Decimal>> {
    let rows = tx.query(
        "SELECT lines FROM pos__pos_order WHERE tenant_id = $1 AND prescription = $2::text AND status = 'completed' FOR SHARE",
        &[&tenant.id, &prescription_id.to_string()],
    ).await?;
    let mut quantities = BTreeMap::<Uuid, rust_decimal::Decimal>::new();
    for row in rows {
        let lines: Value = row.get(0);
        let Some(lines) = lines.as_array() else {
            return Err(ApiError::validation(
                "pharmacy.prescription",
                vec!["Completed POS order has invalid lines; dispensed quantities cannot be verified".into()],
            ));
        };
        for (index, line) in lines.iter().enumerate() {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    "pharmacy.prescription",
                    vec![format!(
                        "Completed POS order line {} has an invalid product",
                        index + 1
                    )],
                ));
            };
            let qty = line
                .get("base_qty")
                .or_else(|| line.get("qty"))
                .and_then(crate::money::decimal)
                .filter(|quantity| *quantity > rust_decimal::Decimal::ZERO)
                .ok_or_else(|| {
                    ApiError::validation(
                        "pharmacy.prescription",
                        vec![format!(
                            "Completed POS order line {} has an invalid quantity",
                            index + 1
                        )],
                    )
                })?;
            let current = quantities.get(&product).copied().unwrap_or_default();
            let Some(total) = current.checked_add(qty) else {
                return Err(ApiError::validation(
                    "pharmacy.prescription",
                    vec!["Dispensed quantity exceeds the supported range".into()],
                ));
            };
            quantities.insert(product, total);
        }
    }
    Ok(quantities)
}

async fn is_fully_dispensed(
    tx: &Tx<'_>,
    tenant: &Tenant,
    prescription_id: Uuid,
    prescription_items: &Value,
) -> R<bool> {
    let Some(prescription_items) = prescription_items.as_array() else {
        return Err(ApiError::validation(
            "pharmacy.prescription",
            vec!["Prescription items are invalid; dispensed quantities cannot be verified".into()],
        ));
    };
    if prescription_items.is_empty() {
        return Err(ApiError::validation(
            "pharmacy.prescription",
            vec!["Prescription has no items; dispensed quantities cannot be verified".into()],
        ));
    }
    let mut prescribed = BTreeMap::<Uuid, rust_decimal::Decimal>::new();
    for (index, item) in prescription_items.iter().enumerate() {
        let Some(product) = item
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Err(ApiError::validation(
                "pharmacy.prescription",
                vec![format!(
                    "Prescription item {} has an invalid product",
                    index + 1
                )],
            ));
        };
        let qty = item
            .get("base_qty")
            .or_else(|| item.get("qty"))
            .and_then(crate::money::decimal)
            .filter(|quantity| *quantity > rust_decimal::Decimal::ZERO)
            .ok_or_else(|| {
                ApiError::validation(
                    "pharmacy.prescription",
                    vec![format!(
                        "Prescription item {} has an invalid quantity",
                        index + 1
                    )],
                )
            })?;
        let current = prescribed.get(&product).copied().unwrap_or_default();
        let Some(total) = current.checked_add(qty) else {
            return Err(ApiError::validation(
                "pharmacy.prescription",
                vec!["Prescribed quantity exceeds the supported range".into()],
            ));
        };
        prescribed.insert(product, total);
    }
    if prescribed.is_empty() {
        return Ok(false);
    }
    let dispensed = dispensed_quantities(tx, tenant, prescription_id).await?;
    Ok(prescribed
        .iter()
        .all(|(product, qty)| dispensed.get(product).copied().unwrap_or_default() >= *qty))
}

async fn create_return_inspections(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let (order_id, movement_source, movement_source_id, reason) =
        if event_type == "pos.pos_order.refunded" {
            let Some(order_id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Refund requires a POS order id".into()],
                ));
            };
            (
                order_id,
                "pos_order_refund",
                order_id,
                document
                    .get("refund_reason")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )
        } else {
            let Some(order_id) = document
                .get("pos_order")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["POS return requires its source order".into()],
                ));
            };
            let Some(return_id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["POS return requires its id".into()],
                ));
            };
            (
                order_id,
                "pos_return",
                return_id,
                document.get("reason").and_then(Value::as_str).unwrap_or(""),
            )
        };
    let prescription = tx
        .query_opt(
            "SELECT prescription FROM pos__pos_order WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &order_id],
        )
        .await?;
    if !prescription
        .and_then(|row| row.get::<_, Option<String>>(0))
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(false);
    }
    let rows = tx
        .query(
            "SELECT product, warehouse, lot, SUM(qty::numeric)::text, SUM(total_cost::numeric)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = $2 AND source_id = $3 AND direction = 'in' GROUP BY product, warehouse, lot ORDER BY product, lot NULLS LAST",
            &[&tenant.id, &movement_source, &movement_source_id.to_string()],
        )
        .await?;
    if rows.is_empty() {
        return Ok(false);
    }
    let entity = kernel.ent(tenant, "quality.inspection")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    for row in rows {
        let product: Uuid = row.get(0);
        let warehouse: Uuid = row.get(1);
        let lot: Option<Uuid> = row.get(2);
        let qty = row
            .get::<_, String>(3)
            .parse::<rust_decimal::Decimal>()
            .unwrap_or_default();
        let total_cost = row
            .get::<_, String>(4)
            .parse::<rust_decimal::Decimal>()
            .unwrap_or_default();
        if qty <= rust_decimal::Decimal::ZERO {
            return Err(ApiError::validation(
                event_type,
                vec!["Returned medicine movement has an invalid quantity".into()],
            ));
        }
        let unit_cost = total_cost.checked_div(qty).ok_or_else(|| {
            ApiError::validation(event_type, vec!["Returned medicine cost is invalid".into()])
        })?;
        let duplicate = tx
            .query_opt(
                "SELECT id FROM quality__inspection WHERE tenant_id = $1 AND source = 'pharmacy_return' AND source_id = $2 AND product = $3 AND warehouse = $4 AND lot IS NOT DISTINCT FROM $5 AND abs(qty::numeric - $6::text::numeric) <= 0.000001 LIMIT 1",
                &[&tenant.id, &movement_source_id.to_string(), &product, &warehouse, &lot, &qty.normalize().to_string()],
            )
            .await?
            .is_some();
        if duplicate {
            continue;
        }
        let mut data = Map::new();
        data.insert("product".into(), serde_json::json!(product));
        data.insert("source".into(), Value::String("pharmacy_return".into()));
        data.insert(
            "source_id".into(),
            Value::String(movement_source_id.to_string()),
        );
        data.insert(
            "qty".into(),
            money::json_number(qty).ok_or_else(|| {
                ApiError::validation(event_type, vec!["Returned quantity is out of range".into()])
            })?,
        );
        data.insert("warehouse".into(), serde_json::json!(warehouse));
        if let Some(lot) = lot {
            data.insert("lot".into(), serde_json::json!(lot));
        }
        data.insert(
            "unit_cost".into(),
            money::json_number(unit_cost).ok_or_else(|| {
                ApiError::validation(event_type, vec!["Returned cost is out of range".into()])
            })?,
        );
        data.insert(
            "note".into(),
            Value::String(format!(
                "Customer return from prescription POS order {order_id}. Reason: {}. Quarantine; do not resell.",
                reason.trim()
            )),
        );
        kernel
            .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
            .await?;
    }
    Ok(true)
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("pharmacy") {
        return Ok(false);
    }
    if event_type == "pharmacy.return_disposition.posted" {
        let Some(inspection_id) = document
            .get("inspection")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Err(ApiError::validation(
                event_type,
                vec!["Pharmacy return disposal requires an inspection id".into()],
            ));
        };
        let inspection = tx
            .query_opt(
                "SELECT product, warehouse, lot, unit_cost::text, source, status FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &inspection_id],
            )
            .await?
            .ok_or_else(|| ApiError::not_found("Returned medicine inspection was not found"))?;
        let source: String = inspection.get(4);
        let status: String = inspection.get(5);
        if source != "pharmacy_return" || status != "failed" {
            return Err(ApiError::validation(
                event_type,
                vec!["Only failed customer-returned medicine can be disposed".into()],
            ));
        }
        let qty = document
            .get("qty")
            .and_then(money::decimal)
            .filter(|qty| *qty > rust_decimal::Decimal::ZERO)
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Disposal quantity must be positive".into()],
                )
            })?;
        let unit_cost = inspection
            .get::<_, Option<String>>(3)
            .and_then(|value| money::decimal_str(&value))
            .unwrap_or_default();
        let entity = kernel.ent(tenant, "inventory.stock_move")?;
        let mut movement = Map::new();
        movement.insert(
            "product".into(),
            serde_json::json!(inspection.get::<_, Uuid>(0)),
        );
        movement.insert(
            "warehouse".into(),
            serde_json::json!(inspection.get::<_, Uuid>(1)),
        );
        if let Some(lot) = inspection.get::<_, Option<Uuid>>(2) {
            movement.insert("lot".into(), serde_json::json!(lot));
        }
        movement.insert(
            "qty".into(),
            money::json_number(qty).ok_or_else(|| {
                ApiError::validation(event_type, vec!["Disposal quantity is out of range".into()])
            })?,
        );
        movement.insert("direction".into(), Value::String("out".into()));
        movement.insert("source".into(), Value::String("pharmacy_disposal".into()));
        movement.insert("source_id".into(), Value::String(inspection_id.to_string()));
        movement.insert(
            "unit_cost".into(),
            money::json_number(unit_cost).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Disposal unit cost is out of range".into()],
                )
            })?,
        );
        movement.insert(
            "note".into(),
            document.get("note").cloned().unwrap_or(Value::Null),
        );
        let opts = Opts {
            depth: Some(depth + 1),
            causation: Some(event_id),
            silent: false,
        };
        kernel
            .create_in(tx, &Actor::System, tenant, &entity, movement, &opts)
            .await?;
        return Ok(true);
    }
    if matches!(
        event_type,
        "pos.pos_return.received" | "pos.pos_order.refunded"
    ) {
        return create_return_inspections(
            kernel, tx, tenant, event_type, document, event_id, depth,
        )
        .await;
    }
    if event_type != "pos.pos_order.completed" {
        return Ok(false);
    }
    let Some(prescription_id) = document
        .get("prescription")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };

    let prescription = kernel.ent(tenant, "pharmacy.prescription")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let rx_row = tx
        .query_opt(
            "SELECT items, status FROM pharmacy__prescription WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &prescription_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Prescription was not found for this tenant"))?;
    let items: Value = rx_row.get(0);
    let fully_dispensed = is_fully_dispensed(tx, tenant, prescription_id, &items).await?;
    if fully_dispensed && rx_row.get::<_, String>(1) == "dispensed" {
        return Ok(true);
    }
    let action = if fully_dispensed {
        "dispensed"
    } else {
        "partially_dispensed"
    };
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &prescription,
            &prescription_id.to_string(),
            Map::from_iter([(
                "dispensed_at".into(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            )]),
            &opts,
        )
        .await?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &prescription,
            &prescription_id.to_string(),
            action,
            &opts,
        )
        .await?;
    Ok(true)
}

pub async fn validate_dispense(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "dispensed" | "partially_dispensed") {
        return Ok(Vec::new());
    }
    let Some(prescription_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Không xác định được đơn thuốc cần cấp phát".into()]);
    };
    if tx
        .query_opt(
            "SELECT 1 FROM pos__pos_order WHERE tenant_id = $1 AND prescription = $2::text AND status = 'completed' LIMIT 1",
            &[&tenant.id, &prescription_id.to_string()],
        )
        .await?
        .is_none()
    {
        return Ok(vec![
            "Đơn thuốc chỉ được cấp phát sau giao dịch POS hoàn tất".into(),
        ]);
    }
    if !matches!(
        document.get("status").and_then(Value::as_str),
        Some("verified" | "partially_dispensed")
    ) {
        return Ok(vec![
            "Chỉ cấp phát đơn thuốc đã xác minh hoặc đang cấp một phần".into(),
        ]);
    }
    if document
        .get("valid_until")
        .and_then(Value::as_str)
        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        .is_none_or(|date| date < tenant.business_today())
    {
        return Ok(vec!["Không thể cấp phát đơn thuốc đã hết hạn".into()]);
    }
    let Some(row) = tx
        .query_opt(
            "SELECT status, items FROM pharmacy__prescription WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &prescription_id],
        )
        .await?
    else {
        return Err(ApiError::not_found(
            "Prescription was not found for this tenant",
        ));
    };
    if !matches!(
        row.get::<_, String>(0).as_str(),
        "verified" | "partially_dispensed"
    ) {
        return Ok(vec![
            "Đơn thuốc đã được cấp phát hoặc không còn hiệu lực".into(),
        ]);
    }
    let items: Value = row.get(1);
    let fully_dispensed = is_fully_dispensed(tx, tenant, prescription_id, &items).await?;
    if (action == "dispensed") != fully_dispensed {
        return Ok(vec![
            if fully_dispensed {
                "Đơn đã cấp đủ số lượng; phải đóng trạng thái cấp phát"
            } else {
                "Chưa cấp đủ số lượng kê trong đơn"
            }
            .into(),
        ]);
    }
    Ok(Vec::new())
}
