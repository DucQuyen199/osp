//! Tenant-scoped helpdesk references and policy lifecycle checks.
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
    let mut errors = Vec::new();
    match entity {
        "message" if action == "created" => {
            let Some(ticket) = document
                .get("ticket")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Ticket trao đổi phải là mã hợp lệ".into()]);
            };
            let status = tx
                .query_opt(
                    "SELECT status FROM helpdesk__ticket WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &ticket],
                )
                .await?
                .map(|row| row.get::<_, String>(0));
            let Some(status) = status else {
                return Ok(vec!["Ticket không tồn tại trong doanh nghiệp".into()]);
            };
            let direction = document.get("direction").and_then(Value::as_str);
            if direction == Some("outbound") && matches!(status.as_str(), "resolved" | "closed") {
                errors.push("Hãy mở lại ticket trước khi gửi phản hồi mới".into());
            }
            if direction == Some("internal") && status == "closed" {
                errors.push("Không thể thêm ghi chú nội bộ vào ticket đã đóng".into());
            }
        }
        "ticket" if action == "responded" => {
            let Some(ticket) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Không xác định được ticket đang phản hồi".into()]);
            };
            let ticket_text = ticket.to_string();
            let has_new_outbound = tx
                .query_one_row(
                    "SELECT EXISTS (SELECT 1 FROM helpdesk__message m WHERE m.tenant_id = $1 AND m.ticket = $2 AND m.direction = 'outbound' AND m.created_at > COALESCE((SELECT max(e.at) FROM osp_events e WHERE e.tenant_id = $1 AND e.record_id = $3 AND e.type = 'helpdesk.ticket.reopened'), '-infinity'::timestamptz))",
                    &[&tenant.id, &ticket, &ticket_text],
                )
                .await?
                .get::<_, bool>(0);
            if !has_new_outbound {
                errors.push("Ghi nhận phản hồi sau khi lưu tin nhắn gửi khách hàng".into());
            }
        }
        "ticket" => {
            for (field, table, label) in [
                ("party", "master_data__party", "Khách hàng"),
                ("sla_policy", "helpdesk__sla_policy", "Chính sách SLA"),
            ] {
                let Some(value) = document.get(field).filter(|value| !value.is_null()) else {
                    continue;
                };
                let Some(id) = value.as_str().and_then(|value| Uuid::parse_str(value).ok()) else {
                    errors.push(format!("{label} phải là mã hợp lệ"));
                    continue;
                };
                let sql =
                    format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR SHARE");
                if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_none() {
                    errors.push(format!("{label} không tồn tại trong doanh nghiệp"));
                }
            }
        }
        "sla_policy" if matches!(action, "updated" | "removed") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Không xác định được chính sách SLA".into()]);
            };
            if tx
                .query_opt(
                    "SELECT id FROM helpdesk__ticket WHERE tenant_id = $1 AND sla_policy = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                errors.push("Chính sách SLA đang được ticket sử dụng; hãy tạo chính sách mới để giữ nguyên lịch sử".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
