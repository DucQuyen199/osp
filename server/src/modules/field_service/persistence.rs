//! Tenant-scoped references for field-service source records.
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
    if entity != "work_order" {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    for (field, table, label) in [
        ("party", "master_data__party", "Khách hàng"),
        ("source_ticket", "helpdesk__ticket", "Ticket nguồn"),
        ("warehouse", "inventory__warehouse", "Kho"),
    ] {
        let Some(value) = document.get(field).filter(|value| !value.is_null()) else {
            continue;
        };
        let Some(id) = value.as_str().and_then(|value| Uuid::parse_str(value).ok()) else {
            errors.push(format!("{label} phải là mã hợp lệ"));
            continue;
        };
        let lock_mode = if field == "source_ticket" {
            // Serialize work-order creation for a ticket before checking for an existing link.
            "UPDATE"
        } else {
            "SHARE"
        };
        let sql =
            format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR {lock_mode}");
        if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_none() {
            errors.push(format!("{label} không tồn tại trong doanh nghiệp"));
        }
    }
    if matches!(action, "created" | "updated" | "dispatched") {
        if let Some(employee) = document
            .get("technician_employee")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            let active = tx
                .query_opt(
                    "SELECT status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &employee],
                )
                .await?
                .is_some_and(|row| row.get::<_, String>(0) == "active");
            if !active {
                errors.push(
                    "Nhân viên phụ trách không tồn tại hoặc đã ngừng hoạt động trong doanh nghiệp"
                        .into(),
                );
            }
            if let (Some(start), Some(end)) = (
                document.get("scheduled_at").and_then(Value::as_str),
                document.get("scheduled_end").and_then(Value::as_str),
            ) {
                let lock_key = format!("field-service-calendar:{}:{employee}", tenant.id);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let current_id = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .unwrap_or(Uuid::nil());
                if tx
                    .query_opt(
                        "SELECT id FROM field_service__work_order WHERE tenant_id = $1 AND technician_employee = $2 AND status IN ('open', 'dispatched') AND scheduled_at IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_at < $4::text::timestamptz AND scheduled_end > $3::text::timestamptz AND id <> $5 LIMIT 1",
                        &[&tenant.id, &employee, &start, &end, &current_id],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Nhân viên đã có lệnh công việc khác trong khoảng thời gian này".into());
                }
            }
        }
    }
    if matches!(action, "created" | "updated" | "dispatched")
        && document
            .get("technician_employee")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
    {
        if let (Some(technician), Some(start), Some(end)) = (
            document
                .get("technician")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty()),
            document.get("scheduled_at").and_then(Value::as_str),
            document.get("scheduled_end").and_then(Value::as_str),
        ) {
            let lock_key = format!(
                "field-service-contractor-calendar:{}:{}",
                tenant.id,
                technician.to_lowercase()
            );
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let current_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx.query_opt(
                "SELECT id FROM field_service__work_order WHERE tenant_id=$1 AND technician_employee IS NULL AND lower(btrim(technician))=lower($2) AND status IN ('open','dispatched') AND scheduled_at IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_at < $4::text::timestamptz AND scheduled_end > $3::text::timestamptz AND id<>$5 LIMIT 1",
                &[&tenant.id, &technician, &start, &end, &current_id],
            ).await?.is_some() {
                errors.push("Kỹ thuật viên bên ngoài đã có lệnh công việc khác trong khung giờ này".into());
            }
        }
    }
    if let Some(ticket) = document
        .get("source_ticket")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    {
        let current_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if tx
            .query_opt(
                "SELECT id FROM field_service__work_order WHERE tenant_id = $1 AND source_ticket = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &ticket, &current_id],
            )
            .await?
            .is_some()
        {
            errors.push("Ticket nguồn đã được liên kết với một lệnh công việc khác".into());
        }
    }
    Ok(errors)
}

/// Serialize ticket conversion with direct work-order creation and detect an existing link.
pub async fn existing_ticket_work_order(tx: &Tx<'_>, tenant: &Tenant, ticket: Uuid) -> R<bool> {
    if tx
        .query_opt(
            "SELECT id FROM helpdesk__ticket WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &ticket],
        )
        .await?
        .is_none()
    {
        return Ok(false);
    }
    Ok(tx
        .query_opt(
            "SELECT id FROM field_service__work_order WHERE tenant_id = $1 AND source_ticket = $2 FOR UPDATE",
            &[&tenant.id, &ticket],
        )
        .await?
        .is_some())
}
