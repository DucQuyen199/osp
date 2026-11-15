//! Derive patient identity for encounters from tenant-owned patient records.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
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
    if !tenant.has_module("clinic") {
        return Ok(false);
    }
    match event_type {
        "booking.booking.checked_in" => {
            let Some(appointment) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Check-in lịch hẹn cần mã hợp lệ".into()],
                ));
            };
            let Some(booking) = tx
                .query_opt(
                    "SELECT party, resource, note, status FROM booking__booking WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &appointment],
                )
                .await?
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Lịch hẹn đã check-in không tồn tại trong doanh nghiệp".into()],
                ));
            };
            let party: Option<Uuid> = booking.get(0);
            let resource: Option<Uuid> = booking.get(1);
            let note: Option<String> = booking.get(2);
            let status: String = booking.get(3);
            if status != "checked_in" {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Lịch hẹn phải được check-in trước khi tạo lượt khám".into()],
                ));
            }
            let Some(party) = party else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Lịch khám cần gắn hồ sơ bệnh nhân đã đăng ký".into()],
                ));
            };
            let Some(patient_row) = tx
                .query_opt(
                    "SELECT id FROM clinic__patient WHERE tenant_id = $1 AND party = $2 FOR SHARE",
                    &[&tenant.id, &party],
                )
                .await?
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Hãy đăng ký người này thành bệnh nhân trước khi check-in".into()],
                ));
            };
            if tx
                .query_opt(
                    "SELECT id FROM clinic__encounter WHERE tenant_id = $1 AND appointment = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &appointment],
                )
                .await?
                .is_some()
            {
                return Ok(true);
            }
            let patient: Uuid = patient_row.get(0);
            let mut encounter = Map::new();
            encounter.insert("patient".into(), json!(patient));
            encounter.insert("appointment".into(), json!(appointment));
            if let Some(note) = note
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
            {
                encounter.insert("complaint".into(), json!(note));
            }
            if let Some(resource) = resource
                && let Some(resource_row) = tx
                    .query_opt(
                        "SELECT name FROM booking__resource WHERE tenant_id = $1 AND id = $2 AND kind = 'staff' FOR SHARE",
                        &[&tenant.id, &resource],
                    )
                    .await?
            {
                let doctor: String = resource_row.get(0);
                encounter.insert("doctor".into(), json!(doctor));
            }
            let encounter_entity = kernel.ent(tenant, "clinic.encounter")?;
            kernel
                .create_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &encounter_entity,
                    encounter,
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
            Ok(true)
        }
        "clinic.encounter.completed" => {
            let Some(encounter) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(false);
            };
            let Some(appointment) = tx
                .query_opt(
                    "SELECT appointment FROM clinic__encounter WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &encounter],
                )
                .await?
                .and_then(|row| row.get::<_, Option<Uuid>>(0))
            else {
                return Ok(false);
            };
            let Some(status) = tx
                .query_opt(
                    "SELECT status FROM booking__booking WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &appointment],
                )
                .await?
                .map(|row| row.get::<_, String>(0))
            else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Lịch hẹn của lượt khám không tồn tại trong doanh nghiệp".into()],
                ));
            };
            if status == "completed" {
                return Ok(true);
            }
            if status != "checked_in" {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Chỉ hoàn tất lịch hẹn đang check-in cùng với lượt khám".into()],
                ));
            }
            let booking_entity = kernel.ent(tenant, "booking.booking")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &booking_entity,
                    &appointment.to_string(),
                    "completed",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

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
