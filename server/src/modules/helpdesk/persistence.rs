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
