//! Tenant-scoped contract and clause locking.
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
    match (entity, action) {
        ("contract", "activated") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được hợp đồng cần kích hoạt".into()]);
            };
            tx.query_opt(
                "SELECT id FROM contract__contract WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id],
            )
            .await?;
        }
        ("clause", "created" | "updated" | "removed") => {
            let Some(contract) = document
                .get("contract")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Điều khoản cần tham chiếu hợp đồng hợp lệ".into()]);
            };
            let parent = tx
                .query_opt(
                    "SELECT status FROM contract__contract WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &contract],
                )
                .await?;
            if !parent.is_some_and(|row| row.get::<_, String>(0) == "draft") {
                return Ok(vec![
                    "Điều khoản chỉ được thêm, sửa hoặc xóa khi hợp đồng còn là bản nháp".into(),
                ]);
            }
        }
        ("contract", "removed") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được hợp đồng cần xóa".into()]);
            };
            if tx
                .query_opt(
                    "SELECT id FROM contract__contract WHERE tenant_id = $1 AND id = $2 AND source = 'real_estate_lease' LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Lease-linked contracts are retained with their source lease history".into(),
                ]);
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM contract__clause WHERE tenant_id = $1 AND contract = $2 LIMIT 1",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Hãy xóa các điều khoản trước khi xóa hợp đồng nháp".into(),
                ]);
            }
        }
        _ => {}
    }
    Ok(Vec::new())
}
