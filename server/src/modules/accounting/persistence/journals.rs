use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use uuid::Uuid;

use super::database_amount;

pub(super) async fn validate_ticket_refund_journal(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(ticket_id) = document
        .get("source_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec![
            "Ticket refund journal requires a valid source ticket".into(),
        ]);
    };
    let ticket_refunded = tx
        .query_opt(
            "SELECT id FROM events__ticket WHERE tenant_id = $1 AND id = $2 AND status = 'refunded'",
            &[&tenant.id, &ticket_id],
        )
        .await?
        .is_some();
    let original = tx
        .query_opt(
            "SELECT payment.amount::text, journal.lines FROM accounting__payment payment JOIN accounting__journal_entry journal ON journal.tenant_id = payment.tenant_id AND journal.source = 'payment' AND journal.source_id = payment.id::text AND journal.status = 'posted' WHERE payment.tenant_id = $1 AND payment.source = 'ticket' AND payment.source_id = $2",
            &[&tenant.id, &ticket_id.to_string()],
        )
        .await?;
    let Some(original) = original else {
        return Ok(vec![
            "Ticket refund journal requires a posted original ticket payment".into(),
        ]);
    };
    let original_amount = database_amount(&original, 0)?;
    let original_lines: Value = original.get(1);
    let mut expected_lines = Vec::new();
    for line in original_lines.as_array().into_iter().flatten() {
        let (Some(account), Some(debit), Some(credit)) = (
            line.get("account"),
            line.get("debit").and_then(money::decimal),
            line.get("credit").and_then(money::decimal),
        ) else {
            return Ok(vec![
                "Original ticket journal contains an invalid line".into(),
            ]);
        };
        let (Some(reversed_debit), Some(reversed_credit)) =
            (money::json_number(credit), money::json_number(debit))
        else {
            return Ok(vec![
                "Original ticket journal exceeds the supported decimal range".into(),
            ]);
        };
        let mut expected =
            json!({ "account": account, "debit": reversed_debit, "credit": reversed_credit });
        if let Some(department) = line.get("department").filter(|value| !value.is_null()) {
            expected["department"] = department.clone();
        }
        expected_lines.push(expected);
    }
    let lines_match = document.get("lines") == Some(&Value::Array(expected_lines));
    let amount_matches = document
        .get("amount")
        .and_then(money::decimal)
        .is_some_and(|amount| money::within_tolerance(amount, original_amount, Decimal::new(5, 3)));
    if !ticket_refunded || !lines_match || !amount_matches {
        return Ok(vec![
            "Ticket refund journal must exactly reverse the posted ticket payment".into(),
        ]);
    }
    Ok(Vec::new())
}

pub(super) async fn validate_journal_line_references(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        for (index, line) in lines.iter().enumerate() {
            let account = line
                .get("account")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let account_exists = if let Some(account) = account {
                tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &account],
                )
                .await?
                .is_some()
            } else {
                false
            };
            if !account_exists {
                errors.push(format!(
                    "lines[{}].account không tồn tại trong tenant",
                    index + 1
                ));
            }
            if let Some(department) = line.get("department").filter(|value| !value.is_null()) {
                let department = department
                    .as_str()
                    .and_then(|value| Uuid::parse_str(value).ok());
                let department_exists = if let Some(department) = department
                    && tenant.has_module("hrm")
                {
                    tx.query_opt(
                        "SELECT 1 FROM hrm__department WHERE tenant_id = $1 AND id = $2",
                        &[&tenant.id, &department],
                    )
                    .await?
                    .is_some()
                } else {
                    false
                };
                if !department_exists {
                    errors.push(format!(
                        "lines[{}].department không tồn tại trong tenant hoặc module HRM chưa bật",
                        index + 1
                    ));
                }
            }
        }
    }
    Ok(errors)
}
