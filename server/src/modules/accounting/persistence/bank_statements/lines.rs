//! Bank statement line import, currency snapshots and draft lifecycle checks.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

use super::super::{date, decimal_amount};

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match action {
        "created" | "updated" => {
            let Some(statement) = document
                .get("statement")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Dòng sao kê cần tham chiếu sao kê hợp lệ".into()]);
            };
            let Some(transaction_date) = date(document, "transaction_date") else {
                return Ok(vec!["Dòng sao kê cần ngày giao dịch hợp lệ".into()]);
            };
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
            let mut statement_currency = base_currency_id;
            let statement_row = tx
                .query_opt(
                    "SELECT status, start_date, end_date, currency FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &statement],
                )
                .await?;
            match statement_row {
                Some(row) => {
                    let status: String = row.get(0);
                    let start: NaiveDate = row.get(1);
                    let end: NaiveDate = row.get(2);
                    let currency: Option<Uuid> = row.get(3);
                    statement_currency = currency.unwrap_or(base_currency_id);
                    if status != "draft" {
                        errors.push("Chỉ được nhập dòng vào sao kê nháp".into());
                    }
                    if transaction_date < start || transaction_date > end {
                        errors.push("Ngày giao dịch phải nằm trong kỳ sao kê".into());
                    }
                }
                None => errors.push("Không tìm thấy sao kê trong tenant này".into()),
            }
            let amount = decimal_amount(document, "amount");
            let base_amount = decimal_amount(document, "base_amount");
            let exchange_rate = decimal_amount(document, "exchange_rate");
            let exchange_rate_date = date(document, "exchange_rate_date");
            let has_fx_snapshot = base_amount.is_some()
                || exchange_rate.is_some()
                || exchange_rate_date.is_some();
            if statement_currency != base_currency_id
                && (base_amount.is_none() || exchange_rate.is_none() || exchange_rate_date.is_none())
            {
                errors.push(
                    "Dòng sao kê ngoại tệ cần có snapshot số tiền cơ sở và tỷ giá".into(),
                );
            } else if has_fx_snapshot
                && (base_amount.is_none() || exchange_rate.is_none() || exchange_rate_date.is_none())
            {
                errors.push("Snapshot quy đổi dòng sao kê chưa đầy đủ".into());
            } else if let (Some(amount), Some(base_amount), Some(exchange_rate), Some(rate_date)) =
                (amount, base_amount, exchange_rate, exchange_rate_date)
            {
                let expected_rate = if statement_currency == base_currency_id {
                    Decimal::ONE
                } else {
                    exchange_rate
                };
                let expected_base = amount
                    .checked_mul(expected_rate)
                    .map(money::round_money)
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "accounting.bank_statement_line",
                            vec!["Converted bank statement amount exceeds the supported decimal range".into()],
                        )
                    })?;
                if exchange_rate <= Decimal::ZERO
                    || rate_date > transaction_date
                    || (statement_currency == base_currency_id
                        && (exchange_rate != Decimal::ONE || rate_date != transaction_date))
                    || !money::within_tolerance(base_amount, expected_base, amount_tolerance())
                {
                    errors.push("Snapshot tỷ giá và số tiền cơ sở của dòng sao kê không hợp lệ".into());
                }
            }
            let line_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .unwrap_or(Uuid::nil());
            if let Some(reference) = document.get("reference").and_then(Value::as_str)
                && tx
                    .query_opt(
                        "SELECT 1 FROM accounting__bank_statement_line WHERE tenant_id = $1 AND statement = $2 AND reference = $3 AND id <> $4 LIMIT 1",
                        &[&tenant.id, &statement, &reference, &line_id],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Mã tham chiếu đã tồn tại trong sao kê".into());
            }
        }
        "ignored" => {
            let Some(statement) = document
                .get("statement")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Bank statement line requires a valid statement".into()]);
            };
            let statement_row = tx
                .query_opt(
                    "SELECT status FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &statement],
                )
                .await?;
            if !statement_row.is_some_and(|row| row.get::<_, String>(0) == "draft") {
                errors.push("Only lines in a draft statement can be ignored".into());
            }
        }
        "removed" => {
            if let Some(statement) = document
                .get("statement")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                && tx
                    .query_opt(
                        "SELECT 1 FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 AND status = 'draft' FOR UPDATE",
                        &[&tenant.id, &statement],
                    )
                    .await?
                    .is_none()
            {
                errors.push("Chỉ xóa được dòng chưa khớp khỏi sao kê nháp".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
