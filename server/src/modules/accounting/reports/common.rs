use crate::error::{ApiError, R};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) fn parse_date(value: Option<&str>, field: &str) -> R<Option<NaiveDate>> {
    value
        .map(|value| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                ApiError::new(
                    422,
                    "INVALID_DATE",
                    format!("{field} must use YYYY-MM-DD format"),
                )
            })
        })
        .transpose()
}

pub(super) fn balance_value(row: &Value, field: &str) -> R<Decimal> {
    let Some(value) = row.get(field).filter(|value| !value.is_null()) else {
        return Ok(Decimal::ZERO);
    };
    crate::money::decimal(value).ok_or_else(|| {
        ApiError::validation(
            "accounting.report",
            vec![format!(
                "Stored {field} exceeds the supported decimal range"
            )],
        )
    })
}

pub(super) fn account_with_balance(row: &Value, balance: Decimal) -> R<Value> {
    let mut row = row.clone();
    let balance = crate::money::json_number(balance).ok_or_else(|| {
        ApiError::validation(
            "accounting.report",
            vec!["Calculated account balance exceeds the supported decimal range".into()],
        )
    })?;
    if let Some(object) = row.as_object_mut() {
        object.insert("balance".into(), balance);
    }
    Ok(row)
}
