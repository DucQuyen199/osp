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
        ("contract", "activated" | "amended") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được hợp đồng cần kích hoạt".into()]);
            };
            let Some(row) = tx
                .query_opt(
                    "SELECT status, amendment_in_progress FROM contract__contract WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
            else {
                return Ok(vec!["Không tìm thấy hợp đồng trong doanh nghiệp này".into()]);
            };
            if action == "amended" {
                let status: String = row.get(0);
                let pending: Option<String> = row.get(1);
                let last = document
                    .get("last_amendment")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if status != "active" || pending.is_none() || pending != last {
                    return Ok(vec!["Không có phụ lục vừa phê duyệt để áp dụng".into()]);
                }
                let amendment = Uuid::parse_str(pending.as_deref().unwrap_or_default()).ok();
                let applied = if let Some(amendment) = amendment {
                    tx.query_opt(
                        "SELECT id FROM contract__amendment WHERE tenant_id = $1 AND id = $2 AND contract = $3 AND status = 'effective' FOR SHARE",
                        &[&tenant.id, &amendment, &id],
                    )
                    .await?
                    .is_some()
                } else {
                    false
                };
                if !applied {
                    return Ok(vec![
                        "Phụ lục phải được phê duyệt và áp dụng trước khi cập nhật hợp đồng".into(),
                    ]);
                }
            }
        }
        ("amendment", "created" | "updated" | "submitted" | "approved" | "applied") => {
            let Some(amendment_id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được phụ lục hợp đồng".into()]);
            };
            let Some(contract_id) = document
                .get("contract")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Phụ lục phải tham chiếu hợp đồng hợp lệ".into()]);
            };
            if let Some(source) = tx
                .query_opt(
                    "SELECT source, source_id FROM contract__contract WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &contract_id],
                )
                .await?
            {
                let source_kind: Option<String> = source.get(0);
                let source_id: Option<String> = source.get(1);
                if source_kind.as_deref() == Some("real_estate_lease") {
                    let lease_id = source_id
                        .as_deref()
                        .and_then(|id| Uuid::parse_str(id).ok());
                    let Some(lease_id) = lease_id else {
                        return Ok(vec!["Hợp đồng lease có mã nguồn không hợp lệ".into()]);
                    };
                    if tx
                        .query_opt(
                            "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                            &[&tenant.id, &lease_id],
                        )
                        .await?
                        .is_none()
                    {
                        return Ok(vec!["Lease nguồn của hợp đồng không còn tồn tại".into()]);
                    }
                }
            }
            let lock_key = format!("contract.amendment:{}:{contract_id}", tenant.id);
            tx.query_one_row(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let Some(contract) = tx
                .query_opt(
                    "SELECT status, jsonb_build_object('start_date', start_date, 'end_date', end_date, 'value', value) FROM contract__contract WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &contract_id],
                )
                .await?
            else {
                return Ok(vec!["Không tìm thấy hợp đồng trong doanh nghiệp này".into()]);
            };
            let contract_status: String = contract.get(0);
            if contract_status != "active" {
                return Ok(vec![
                    "Chỉ hợp đồng đang hiệu lực mới được lập hoặc áp dụng phụ lục".into(),
                ]);
            }
            let current_terms: Value = contract.get(1);
            let errors = super::domain::validate_amendment(&current_terms, document);
            if !errors.is_empty() {
                return Ok(errors);
            }
            if matches!(action, "submitted" | "approved") {
                let existing = tx
                    .query_opt(
                        "SELECT id FROM contract__amendment WHERE tenant_id = $1 AND contract = $2 AND id <> $3 AND status IN ('submitted', 'approved') LIMIT 1",
                        &[&tenant.id, &contract_id, &amendment_id],
                    )
                    .await?
                    .is_some();
                if existing {
                    return Ok(vec![
                        "Hợp đồng đã có một phụ lục đang chờ duyệt hoặc đến ngày áp dụng".into(),
                    ]);
                }
            }
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
        ("contract", "terminated" | "expired") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được hợp đồng cần kết thúc".into()]);
            };
            let pending_statuses = if action == "terminated" {
                "('submitted', 'approved')"
            } else {
                "('approved')"
            };
            let sql = format!(
                "SELECT id FROM contract__amendment WHERE tenant_id = $1 AND contract = $2 AND status IN {pending_statuses} LIMIT 1"
            );
            if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_some() {
                let message = if action == "terminated" {
                    "Hãy hủy hoặc xử lý các phụ lục đang chờ trước khi chấm dứt hợp đồng"
                } else {
                    "Hợp đồng có phụ lục đã duyệt đang chờ ngày hiệu lực; tác vụ hết hạn sẽ thử lại sau khi phụ lục được áp dụng"
                };
                return Ok(vec![message.into()]);
            }
        }
        ("amendment", "removed") => {
            if !matches!(
                document.get("status").and_then(Value::as_str),
                Some("draft" | "rejected" | "cancelled")
            ) {
                return Ok(vec![
                    "Phụ lục đã gửi duyệt hoặc áp dụng phải được giữ làm dấu vết hợp đồng".into(),
                ]);
            }
        }
        _ => {}
    }
    Ok(Vec::new())
}
