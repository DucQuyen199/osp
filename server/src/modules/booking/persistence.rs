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
