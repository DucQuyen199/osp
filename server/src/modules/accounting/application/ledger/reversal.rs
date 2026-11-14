use crate::error::{ApiError, R};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn lines_to_reverse(lines: &Value, event_type: &str) -> R<Vec<Value>> {
    let mut reversal_lines = Vec::new();
    for line in lines.as_array().into_iter().flatten() {
        let account = line
            .get("account")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Original journal has an invalid account id".into()],
                )
            })?;
        let debit = line
            .get("debit")
            .and_then(crate::money::decimal)
            .filter(|amount| *amount >= Decimal::ZERO)
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Original journal has an invalid debit amount".into()],
                )
            })?;
        let credit = line
            .get("credit")
            .and_then(crate::money::decimal)
            .filter(|amount| *amount >= Decimal::ZERO)
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Original journal has an invalid credit amount".into()],
                )
            })?;
        let debit_value = crate::money::json_number(credit).ok_or_else(|| {
            ApiError::validation(
                event_type,
                vec!["Reversal debit exceeds the supported decimal range".into()],
            )
        })?;
        let credit_value = crate::money::json_number(debit).ok_or_else(|| {
            ApiError::validation(
                event_type,
                vec!["Reversal credit exceeds the supported decimal range".into()],
            )
        })?;
        let mut reversal = serde_json::json!({
            "account": account,
            "debit": debit_value,
            "credit": credit_value
        });
        if let Some(department) = line.get("department").filter(|value| !value.is_null()) {
            reversal["department"] = department.clone();
        }
        reversal_lines.push(reversal);
    }
    if reversal_lines.len() < 2 {
        return Err(ApiError::validation(
            event_type,
            vec!["Original journal does not have enough lines to reverse".into()],
        ));
    }
    Ok(reversal_lines)
}
