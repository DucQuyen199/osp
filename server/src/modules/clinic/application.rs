//! Derive patient identity for encounters from tenant-owned patient records.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "prescription" {
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
        return Ok(errors);
    }
    if entity != "encounter" {
        return Ok(Vec::new());
    }
    let Some(patient) = document
        .get("patient")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Lượt khám cần hồ sơ bệnh nhân hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT party FROM clinic__patient WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &patient],
        )
        .await?
    else {
        return Ok(vec![
            "Hồ sơ bệnh nhân không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    let party: Uuid = row.get(0);
    document.insert("party".into(), Value::String(party.to_string()));
    Ok(Vec::new())
}
