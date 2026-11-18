//! Pure validation helpers for company-group membership commands.

use crate::error::{ApiError, R};
use uuid::Uuid;

pub fn validate(entity: &str, document: &serde_json::Value) -> Vec<String> {
    let mut errors = validate_rate_age_days(entity, document, false);
    if entity == "elimination_journal" {
        errors.extend(validate_elimination_journal(document));
    }
    errors
}

fn validate_elimination_journal(document: &serde_json::Value) -> Vec<String> {
    use rust_decimal::Decimal;
    let mut errors = Vec::new();
    if document
        .get("memo")
        .and_then(serde_json::Value::as_str)
        .is_none_or(|memo| memo.trim().is_empty())
    {
        errors.push("Elimination journal requires a reason or memo".into());
    }
    let lines = document.get("lines").and_then(serde_json::Value::as_array);
    let Some(lines) = lines else {
        errors.push("Elimination journal requires balanced debit and credit lines".into());
        return errors;
    };
    if lines.len() < 2 {
        errors.push("Elimination journal requires at least two lines".into());
    }
    let mut debit_total = Decimal::ZERO;
    let mut credit_total = Decimal::ZERO;
    for line in lines {
        if line
            .get("accountCode")
            .and_then(serde_json::Value::as_str)
            .is_none_or(|code| code.trim().is_empty())
        {
            errors.push("Every elimination line requires an accountCode".into());
            break;
        }
        let debit_value = line.get("debit").filter(|value| !value.is_null());
        let credit_value = line.get("credit").filter(|value| !value.is_null());
        let debit = match debit_value {
            Some(value) => match crate::money::decimal(value) {
                Some(amount) => amount,
                None => {
                    errors
                        .push("Elimination debit and credit amounts must be valid numbers".into());
                    break;
                }
            },
            None => Decimal::ZERO,
        };
        let credit = match credit_value {
            Some(value) => match crate::money::decimal(value) {
                Some(amount) => amount,
                None => {
                    errors
                        .push("Elimination debit and credit amounts must be valid numbers".into());
                    break;
                }
            },
            None => Decimal::ZERO,
        };
        if debit < Decimal::ZERO
            || credit < Decimal::ZERO
            || (debit > Decimal::ZERO) == (credit > Decimal::ZERO)
        {
            errors.push(
                "Each elimination line must have exactly one positive debit or credit".into(),
            );
            break;
        }
        let Some(next_debit) = debit_total.checked_add(debit) else {
            errors.push("Elimination journal total is outside the supported range".into());
            break;
        };
        let Some(next_credit) = credit_total.checked_add(credit) else {
            errors.push("Elimination journal total is outside the supported range".into());
            break;
        };
        debit_total = next_debit;
        credit_total = next_credit;
    }
    if debit_total <= Decimal::ZERO || debit_total != credit_total {
        errors.push(
            "Elimination journal debit and credit totals must be equal and greater than zero"
                .into(),
        );
    }
    if document
        .get("matching_evidence")
        .and_then(serde_json::Value::as_array)
        .is_none_or(|evidence| {
            evidence.is_empty()
                || evidence
                    .iter()
                    .any(|item| item.as_str().is_none_or(|value| value.trim().is_empty()))
        })
    {
        errors.push(
            "Add at least one reference or explanation supporting the intercompany match".into(),
        );
    }
    errors
}

pub fn validate_update(
    entity: &str,
    current: &serde_json::Value,
    patch: &serde_json::Value,
) -> Vec<String> {
    if entity != "company_group" {
        return Vec::new();
    }
    let Some(patch) = patch.as_object() else {
        return Vec::new();
    };
    let Some(value) = patch.get("max_rate_age_days") else {
        return Vec::new();
    };
    if value.is_null() {
        return Vec::new();
    }
    let mut merged = current.as_object().cloned().unwrap_or_default();
    merged.insert("max_rate_age_days".into(), value.clone());
    validate_rate_age_days(entity, &serde_json::Value::Object(merged), true)
}

fn validate_rate_age_days(
    entity: &str,
    document: &serde_json::Value,
    only_if_present: bool,
) -> Vec<String> {
    if entity != "company_group" {
        return Vec::new();
    }
    let Some(value) = document.get("max_rate_age_days") else {
        return Vec::new();
    };
    if value.is_null() && only_if_present {
        return Vec::new();
    }
    let valid = value
        .as_f64()
        .is_some_and(|days| days.is_finite() && days >= 1.0 && days.fract() == 0.0);
    if valid {
        Vec::new()
    } else {
        vec!["Maximum currency rate age must be a positive whole number of days".into()]
    }
}

pub(super) fn parse_id(value: &str, resource: &'static str) -> R<Uuid> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(resource))
}
