//! Tenant-scoped booking resource locking and conflict safety.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "booking" || !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    if tenant.has_module("clinic") {
        let Some(party) = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "A clinic appointment must be linked to a registered patient".into(),
            ]);
        };
        if tx
            .query_opt(
                "SELECT id FROM clinic__patient WHERE tenant_id = $1 AND party = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Clinic appointments require a patient record in this tenant".into()]);
        }
    }
    let Some(resource) = document
        .get("resource")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Lịch cần tài nguyên hợp lệ".into()]);
    };
    // Lock the shared resource before the generic NoOverlap constraint runs.
    // This serializes bookings for the same room/staff/equipment and prevents
    // concurrent requests from both observing an empty time slot.
    Ok(
        if tx
            .query_opt(
                "SELECT id FROM booking__resource WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &resource],
            )
            .await?
            .is_none()
        {
            vec!["Tài nguyên đặt lịch không tồn tại trong doanh nghiệp".into()]
        } else {
            Vec::new()
        },
    )
}
