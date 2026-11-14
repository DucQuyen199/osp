use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::{Value, json};
use uuid::Uuid;

pub(super) async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match action {
        "created" | "updated" => {
            let code = document
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("{}:account:{code}", tenant.id)],
            )
            .await?;
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx
                .query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 AND id <> $3 LIMIT 1",
                    &[&tenant.id, &code, &id],
                )
                .await?
                .is_some()
            {
                errors.push("Mã tài khoản đã tồn tại trong doanh nghiệp".into());
            }
            let parent_id = match document.get("parent") {
                None | Some(Value::Null) => None,
                Some(Value::String(value)) => match Uuid::parse_str(value) {
                    Ok(parent_id) => Some(parent_id),
                    Err(_) => {
                        errors.push("Tài khoản cha phải là ID hợp lệ".into());
                        None
                    }
                },
                Some(_) => {
                    errors.push("Tài khoản cha phải là ID hợp lệ".into());
                    None
                }
            };
            let kind = document
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Some(parent_id) = parent_id {
                if parent_id == id {
                    errors.push("Tài khoản không thể là tài khoản cha của chính nó".into());
                } else if let Some(parent) = tx
                    .query_opt(
                        "SELECT code, kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &parent_id],
                    )
                    .await?
                {
                    let parent_code: String = parent.get(0);
                    let parent_kind: String = parent.get(1);
                    if parent_code.len() >= code.len() || !code.starts_with(&parent_code) {
                        errors.push("Mã tài khoản chi tiết phải bắt đầu bằng mã tài khoản cha".into());
                    }
                    if parent_kind != kind {
                        errors.push("Tài khoản chi tiết phải cùng loại với tài khoản cha".into());
                    }
                } else {
                    errors.push("Tài khoản cha phải thuộc cùng doanh nghiệp".into());
                }
            }
            if action == "updated" {
                for child in tx
                    .query(
                        "SELECT code, kind FROM accounting__account WHERE tenant_id = $1 AND parent = $2",
                        &[&tenant.id, &id],
                    )
                    .await?
                {
                    let child_code: String = child.get(0);
                    let child_kind: String = child.get(1);
                    if !child_code.starts_with(code) {
                        errors.push("Không thể đổi mã vì mã này đang là tiền tố của tài khoản chi tiết".into());
                        break;
                    }
                    if child_kind != kind {
                        errors.push("Không thể đổi loại khi tài khoản chi tiết đang dùng loại khác".into());
                        break;
                    }
                }
            }
            if action == "updated" {
                let selector = json!([{ "account": id.to_string() }]);
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND status IN ('posted', 'reversed') AND lines @> $2 LIMIT 1",
                        &[&tenant.id, &selector],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể sửa tài khoản đã dùng trong bút toán ghi sổ".into());
                }
            }
        }
        "removed" => {
            if let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND parent = $2 LIMIT 1",
                        &[&tenant.id, &id],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể xóa tài khoản đang có tài khoản chi tiết".into());
                }
                let selector = json!([{ "account": id.to_string() }]);
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND lines @> $2 LIMIT 1",
                        &[&tenant.id, &selector],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể xóa tài khoản đã được tham chiếu trong bút toán".into());
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
