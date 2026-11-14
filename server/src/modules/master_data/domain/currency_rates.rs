//! Pure validation for dated currency conversion quotes.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) fn validate(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(value) = document.get("rate")
        && !money::decimal(value).is_some_and(|rate| rate > Decimal::ZERO)
    {
        errors.push("Currency rate must be a finite number greater than zero".into());
    }
    if document
        .get("effective_date")
        .and_then(Value::as_str)
        .is_none_or(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err())
    {
        errors.push("Currency rate effective_date must use YYYY-MM-DD".into());
    }
    errors
}
