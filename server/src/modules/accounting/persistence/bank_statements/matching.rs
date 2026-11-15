//! Payment and posted-journal matching against bank statement lines.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

use super::super::{database_amount, database_optional_amount, decimal_amount};
use super::is_bank_account_code;

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let Some(line_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Không xác định được dòng sao kê cần khớp".into()]);
    };
    let Some(statement) = document
        .get("statement")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Dòng sao kê cần tham chiếu sao kê hợp lệ".into()]);
    };
    let payment = document
        .get("payment")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let journal_entry = document
        .get("journal_entry")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    if payment.is_some() == journal_entry.is_some() {
        return Ok(vec![
            "Dòng sao kê cần chọn đúng một payment hoặc bút toán hợp lệ".into(),
        ]);
    }
    let base_code = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let Some(base_currency_id) = tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
            &[&tenant.id, &base_code],
        )
        .await?
        .map(|row| row.get::<_, Uuid>(0))
    else {
        return Ok(vec![format!(
            "Tenant base currency {base_code} is missing from its currency catalog"
        )]);
    };
    let statement_row = tx
        .query_opt(
            "SELECT status, currency, account FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &statement],
        )
        .await?;
    let (statement_currency, bank_account) = match statement_row {
        Some(row) => {
            if row.get::<_, String>(0) != "draft" {
                errors.push("Chỉ được khớp dòng trong sao kê nháp".into());
            }
            (
                row.get::<_, Option<Uuid>>(1).unwrap_or(base_currency_id),
                row.get::<_, Option<Uuid>>(2),
            )
        }
        None => {
            errors.push("Không tìm thấy sao kê trong tenant này".into());
            (base_currency_id, None)
        }
    };
    let Some(bank_account) = bank_account else {
        errors.push("Sao kê chưa gắn tài khoản ngân hàng hợp lệ".into());
        return Ok(errors);
    };
    let account_row = tx
        .query_opt(
            "SELECT code, kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &bank_account],
        )
        .await?;
    if !account_row.is_some_and(|row| {
        is_bank_account_code(&row.get::<_, String>(0)) && row.get::<_, String>(1) == "asset"
    }) {
        errors.push("Tài khoản gắn với sao kê không còn là tài khoản ngân hàng hợp lệ".into());
        return Ok(errors);
    }
    let direction = document
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let line_amount = decimal_amount(document, "amount").unwrap_or(Decimal::ZERO);
    let line_base_amount = decimal_amount(document, "base_amount").unwrap_or(line_amount);
    if statement_currency != base_currency_id && decimal_amount(document, "base_amount").is_none() {
        errors.push("Dòng sao kê ngoại tệ chưa có số tiền quy đổi cơ sở".into());
    }
    let (journal_id, lines) = if let Some(payment) = payment {
        let payment_row = tx
            .query_opt(
                "SELECT amount::text, method, currency, base_amount::text FROM accounting__payment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &payment],
            )
            .await?;
        match payment_row {
            Some(row) => {
                let payment_amount = database_amount(&row, 0)?;
                let method: Option<String> = row.get(1);
                let payment_currency: Option<Uuid> = row.get(2);
                let payment_base_amount =
                    database_optional_amount(&row, 3)?.unwrap_or(payment_amount);
                if !matches!(method.as_deref(), Some("transfer" | "bank")) {
                    errors.push("Chỉ khớp payment chuyển khoản/ngân hàng".into());
                }
                if payment_currency.unwrap_or(base_currency_id) != statement_currency {
                    errors.push("Đồng tiền payment phải khớp đồng tiền sao kê".into());
                }
                if !money::within_tolerance(payment_amount, line_amount, amount_tolerance()) {
                    errors.push("Số tiền payment phải khớp số tiền dòng sao kê".into());
                }
                if !money::within_tolerance(
                    payment_base_amount,
                    line_base_amount,
                    amount_tolerance(),
                ) {
                    errors.push("Số tiền cơ sở của payment phải khớp snapshot dòng sao kê".into());
                }
            }
            None => errors.push("Không tìm thấy payment trong tenant này".into()),
        }
        let journal = tx
            .query_opt(
                "SELECT id, lines FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'payment' AND source_id = $2 AND status = 'posted' FOR SHARE",
                &[&tenant.id, &payment.to_string()],
            )
            .await?;
        match journal {
            Some(row) => (Some(row.get::<_, Uuid>(0)), Some(row.get::<_, Value>(1))),
            None => {
                errors.push("Payment chưa có bút toán ngân hàng đã ghi sổ".into());
                (None, None)
            }
        }
    } else if let Some(journal_entry) = journal_entry {
        let journal = tx
            .query_opt(
                "SELECT lines FROM accounting__journal_entry WHERE tenant_id = $1 AND id = $2 AND status = 'posted' FOR UPDATE",
                &[&tenant.id, &journal_entry],
            )
            .await?;
        match journal {
            Some(row) => (Some(journal_entry), Some(row.get::<_, Value>(0))),
            None => {
                errors.push("Không tìm thấy bút toán đã ghi sổ trong tenant này".into());
                (None, None)
            }
        }
    } else {
        unreachable!("payment or journal entry was checked above")
    };
    if let Some(journal_id) = journal_id {
        let duplicate = tx
            .query_opt(
                "SELECT 1 FROM accounting__bank_statement_line b WHERE b.tenant_id = $1 AND b.status = 'matched' AND b.id <> $2 AND (b.journal_entry = $3 OR EXISTS (SELECT 1 FROM accounting__payment p JOIN accounting__journal_entry linked ON linked.tenant_id = p.tenant_id AND linked.source = 'payment' AND linked.source_id = p.id::text WHERE p.tenant_id = b.tenant_id AND p.id = b.payment AND linked.id = $3)) LIMIT 1",
                &[&tenant.id, &line_id, &journal_id],
            )
            .await?
            .is_some();
        if duplicate {
            errors.push("Bút toán này đã được đối soát với một dòng sao kê khác".into());
        }
    }
    let mut bank_net = Decimal::ZERO;
    if let Some(lines) = lines.as_ref().and_then(Value::as_array) {
        let bank_account = bank_account.to_string();
        for line in lines.iter().filter(|line| {
            line.get("account").and_then(Value::as_str) == Some(bank_account.as_str())
        }) {
            let debit = line
                .get("debit")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            let credit = line
                .get("credit")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            bank_net = bank_net
                .checked_add(debit)
                .and_then(|value| value.checked_sub(credit))
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "accounting.bank_statement_line",
                        vec!["Bank journal amount exceeds the supported decimal range".into()],
                    )
                })?;
        }
    }
    let expected_net = if direction == "credit" {
        line_base_amount
    } else {
        -line_base_amount
    };
    if !money::within_tolerance(bank_net, expected_net, amount_tolerance()) {
        errors.push(
            "Bút toán TK 112 phải có phát sinh cùng chiều và khớp số tiền dòng sao kê".into(),
        );
    }
    Ok(errors)
}
