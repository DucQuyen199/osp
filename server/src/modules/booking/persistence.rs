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
    if entity != "booking" {
        return Ok(Vec::new());
    }
    if action == "removed"
        && tenant.has_module("clinic")
        && let Some(appointment) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        && tx
            .query_opt(
                "SELECT id FROM clinic__encounter WHERE tenant_id = $1 AND appointment = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &appointment],
            )
            .await?
            .is_some()
    {
        return Ok(vec![
            "Không thể xóa lịch hẹn đã liên kết với lượt khám".into(),
        ]);
    }
    if action == "completed" && tenant.has_module("clinic") {
        if let Some(appointment) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            && let Some(encounter_status) = tx
                .query_opt(
                    "SELECT status FROM clinic__encounter WHERE tenant_id = $1 AND appointment = $2 LIMIT 1 FOR SHARE",
                    &[&tenant.id, &appointment],
                )
                .await?
                .map(|row| row.get::<_, String>(0))
            && encounter_status != "completed"
        {
            return Ok(vec![
                "Lịch khám chỉ hoàn tất sau khi lượt khám hoàn tất".into(),
            ]);
        }
    }
    if !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    if tenant.has_module("clinic") {
        let Some(party) = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Lịch khám cần gắn hồ sơ bệnh nhân đã đăng ký".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM clinic__patient WHERE tenant_id = $1 AND party = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Lịch khám cần hồ sơ bệnh nhân trong doanh nghiệp".into()]);
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
