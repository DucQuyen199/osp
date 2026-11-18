//! Casso bank transaction webhook/API payload adapter.
use super::model::{BankLine, validation};
use crate::{
    error::{ApiError, R},
    money,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) fn parse(payload: &Value) -> R<Vec<BankLine>> {
    let records = payload
        .as_array()
        .or_else(|| payload.get("data").and_then(Value::as_array))
        .or_else(|| payload.pointer("/data/records").and_then(Value::as_array))
        .ok_or_else(|| validation("Casso payload must contain a data array of transactions"))?;
    if records.is_empty() {
        return Err(validation("Casso payload contains no transactions"));
    }
    if records.len() > 20_000 {
        return Err(ApiError::new(
            413,
            "TOO_MANY_ROWS",
            "A bank statement import is limited to 20,000 rows",
        ));
    }

    records
        .iter()
        .enumerate()
        .map(|(index, record)| {
            let row = index + 1;
            let value = |field: &str| {
                record
                    .get(field)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        record
                            .get(field)
                            .filter(|value| value.is_number())
                            .map(Value::to_string)
                    })
            };
            let id = value("id")
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| {
                    validation(format!(
                        "Casso transaction {row}: a stable Casso transaction id is required"
                    ))
                })?;
            if id.len() > 160 || id.chars().any(char::is_control) {
                return Err(validation(format!(
                    "Casso transaction {row}: invalid transaction id"
                )));
            }
            let date_raw = value("when")
                .or_else(|| value("transactionDate"))
                .ok_or_else(|| {
                    validation(format!(
                        "Casso transaction {row}: transaction date is required"
                    ))
                })?;
            let date = parse_casso_date(&date_raw).ok_or_else(|| {
                validation(format!("Casso transaction {row}: invalid transaction date"))
            })?;
            let amount_raw = value("amount").ok_or_else(|| {
                validation(format!("Casso transaction {row}: amount is required"))
            })?;
            let signed = money::decimal_str(&amount_raw)
                .ok_or_else(|| validation(format!("Casso transaction {row}: invalid amount")))?;
            if signed.is_zero() {
                return Err(validation(format!(
                    "Casso transaction {row}: amount must be nonzero"
                )));
            }
            let amount = signed.abs();
            if amount > Decimal::new(999_999_999_999_999_999, 4) {
                return Err(validation(format!(
                    "Casso transaction {row}: amount exceeds supported financial range"
                )));
            }
            let description = value("description").filter(|text| !text.trim().is_empty());
            if description
                .as_ref()
                .is_some_and(|text| text.chars().count() > 1000)
            {
                return Err(validation(format!(
                    "Casso transaction {row}: description is limited to 1,000 characters"
                )));
            }
            Ok(BankLine {
                row,
                date,
                reference: format!("CASSO:{id}"),
                description,
                direction: if signed.is_sign_positive() {
                    "credit"
                } else {
                    "debit"
                },
                amount,
                currency: None,
            })
        })
        .collect()
}

fn parse_casso_date(value: &str) -> Option<NaiveDate> {
    let value = value.trim();
    [
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%.f%:z",
        "%Y-%m-%dT%H:%M:%S%.fZ",
    ]
    .iter()
    .find_map(|format| NaiveDate::parse_from_str(value, format).ok())
    .or_else(|| {
        value
            .get(..10)
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
    })
}
