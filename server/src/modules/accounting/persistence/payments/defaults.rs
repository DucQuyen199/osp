use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let has_invoice = document.get("invoice").and_then(Value::as_str).is_some();
    let has_bill = document.get("bill").and_then(Value::as_str).is_some();
    let payment_method = document.get("method").and_then(Value::as_str);
    let cash_code = if payment_method == Some("cash") {
        "111"
    } else {
        "112"
    };
    let account_codes: &[&str] = if has_invoice {
        &[cash_code, "131"]
    } else if has_bill {
        &[cash_code, "331"]
    } else if matches!(
        document.get("source").and_then(Value::as_str),
        Some("pos_order" | "table_order" | "ticket")
    ) {
        &[cash_code, "511"]
    } else if document.get("source").and_then(Value::as_str) == Some("donation") {
        &[cash_code, "711"]
    } else if document.get("source").and_then(Value::as_str)
        == Some("payroll_contribution_remittance")
    {
        &[cash_code]
    } else if document.get("source").and_then(Value::as_str) == Some("expense_claim")
        || document.get("source").and_then(Value::as_str) == Some("payroll_run")
    {
        &[cash_code, "334"]
    } else {
        &[]
    };
    for code in account_codes {
        if tx
            .query_opt(
                "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                &[&tenant.id, code],
            )
            .await?
            .is_none()
        {
            errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
        }
    }
    Ok(errors)
}
