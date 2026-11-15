//! Pharmacy side effects from a completed point-of-sale transaction.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
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
async fn dispensed_quantities(
    tx: &Tx<'_>,
    tenant: &Tenant,
    prescription_id: Uuid,
) -> R<BTreeMap<Uuid, rust_decimal::Decimal>> {
    let rows = tx.query(
        "SELECT lines FROM pos__pos_order WHERE tenant_id = $1 AND prescription = $2::text AND status = 'completed' FOR SHARE",
        &[&tenant.id, &prescription_id],
    ).await?;
    let mut quantities = BTreeMap::<Uuid, rust_decimal::Decimal>::new();
    for row in rows {
        let lines: Value = row.get(0);
        for line in lines.as_array().into_iter().flatten() {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let qty = line
                .get("base_qty")
                .or_else(|| line.get("qty"))
                .and_then(crate::money::decimal)
                .unwrap_or_default();
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
    let mut prescribed = BTreeMap::<Uuid, rust_decimal::Decimal>::new();
    for item in prescription_items.as_array().into_iter().flatten() {
        let Some(product) = item
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let qty = item
            .get("base_qty")
            .or_else(|| item.get("qty"))
            .and_then(crate::money::decimal)
            .unwrap_or_default();
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

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "pos.pos_order.completed" || !tenant.has_module("pharmacy") {
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
            &[&tenant.id, &prescription_id],
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
