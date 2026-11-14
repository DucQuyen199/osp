use super::super::database_amount;
use super::shared::{amount, amount_tolerance};
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let refund = document.get("source").and_then(Value::as_str) == Some("payment_refund");
    let has_invoice = document.get("invoice").and_then(Value::as_str).is_some();
    let has_bill = document.get("bill").and_then(Value::as_str).is_some();
    let payment_method = document.get("method").and_then(Value::as_str);
    if (has_invoice || has_bill)
        && !matches!(
            payment_method,
            Some("cash" | "card" | "transfer" | "ewallet" | "bank")
        )
    {
        errors
            .push("Payment công nợ cần phương thức cash, card, transfer, ewallet hoặc bank".into());
    }
    for (field, table, party_field, note_table, note_field) in [
        (
            "invoice",
            "accounting__invoice",
            "party",
            "accounting__credit_note",
            "invoice",
        ),
        (
            "bill",
            "accounting__bill",
            "supplier",
            "accounting__debit_note",
            "bill",
        ),
    ] {
        let Some(id) = document.get(field).and_then(Value::as_str) else {
            continue;
        };
        let Ok(id) = Uuid::parse_str(id) else {
            continue;
        };
        let sql = format!(
            "SELECT total::text, status, {party_field} FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"
        );
        if let Some(row) = tx.query_opt(&sql, &[&tenant.id, &id]).await? {
            let total = database_amount(&row, 0)?;
            let status: String = row.get(1);
            let party: Uuid = row.get(2);
            if !matches!(
                status.as_str(),
                "posted" | "partially_paid" | "partially_settled"
            ) && !(refund && matches!(status.as_str(), "paid" | "settled"))
            {
                errors.push("Chỉ được thanh toán hóa đơn đang còn số dư phải thu/phải trả".into());
            }
            let payment_sql = format!(
                "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {field} = $2"
            );
            let paid_row = tx.query_opt(&payment_sql, &[&tenant.id, &id]).await?;
            let paid = match paid_row {
                Some(row) => database_amount(&row, 0)?,
                None => Decimal::ZERO,
            };
            let note_sql = format!(
                "SELECT COALESCE(SUM(total), 0)::text FROM {note_table} WHERE tenant_id = $1 AND {note_field} = $2 AND status = 'posted'"
            );
            let adjusted_row = tx.query_opt(&note_sql, &[&tenant.id, &id]).await?;
            let adjusted = match adjusted_row {
                Some(row) => database_amount(&row, 0)?,
                None => Decimal::ZERO,
            };
            let outstanding = total
                .checked_sub(paid)
                .and_then(|value| value.checked_sub(adjusted))
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "accounting.payment",
                        vec!["Invoice balance exceeds the supported decimal range".into()],
                    )
                })?
                .max(Decimal::ZERO);
            if !refund
                && !amount(document, "amount").is_some_and(|value| {
                    outstanding
                        .checked_add(amount_tolerance())
                        .is_some_and(|limit| value <= limit)
                })
            {
                errors.push(format!(
                    "Khoản thanh toán vượt số dư còn lại ({outstanding:.2})"
                ));
            }
            if document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                != Some(party)
            {
                errors.push("Payment công nợ phải có đối tác trùng với chứng từ liên kết".into());
            }
        }
    }
    Ok(errors)
}
