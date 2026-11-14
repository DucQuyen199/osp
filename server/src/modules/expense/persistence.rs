//! Tenant-scoped employee and approval checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match action {
        "submitted" => {
            validate_expense_accounts(tx, tenant, document, &mut errors).await?;
            let employee = document
                .get("employee")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let Some(employee) = employee else {
                return Ok(vec!["Đề nghị chi phí cần nhân viên hợp lệ".into()]);
            };
            let row = tx
                .query_opt(
                    "SELECT status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &employee],
                )
                .await?;
            if !row.is_some_and(|row| row.get::<_, String>(0) == "active") {
                errors.push("Chỉ được gửi đề nghị chi cho nhân viên đang làm việc".into());
            }
        }
        "approved" => {
            if !tenant.has_module("accounting") {
                errors.push("Cần bật module kế toán để duyệt và ghi sổ đề nghị chi".into());
            }
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            if tenant.has_module("workflow-approval") {
                let approved = if let Some(id) = id {
                    tx.query_opt(
                        "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'expense.expense_claim' AND record_id = $2 AND status = 'approved' LIMIT 1",
                        &[&tenant.id, &id.to_string()],
                    ).await?.is_some()
                } else {
                    false
                };
                if !approved {
                    errors.push("Chỉ được duyệt đề nghị chi sau khi yêu cầu phê duyệt chung được chấp thuận".into());
                }
            }
        }
        "paid" => {
            if !tenant.has_module("accounting") {
                errors.push("Cần bật module kế toán để ghi nhận thanh toán đề nghị chi".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}

async fn validate_expense_accounts(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(items) = document.get("items").and_then(Value::as_array) else {
        return Ok(());
    };
    let mut checked = std::collections::HashSet::new();
    for item in items {
        let code = item
            .get("account_code")
            .and_then(Value::as_str)
            .filter(|code| !code.trim().is_empty())
            .unwrap_or("642")
            .trim()
            .to_ascii_uppercase();
        if !checked.insert(code.clone()) {
            continue;
        }
        let account = tx
            .query_opt(
                "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND upper(btrim(code)) = $2 FOR SHARE",
                &[&tenant.id, &code],
            )
            .await?;
        if !account.is_some_and(|row| row.get::<_, String>(0) == "expense") {
            errors.push(format!(
                "Expense account {code} does not exist or is not an expense account"
            ));
        }
    }
    Ok(())
}
