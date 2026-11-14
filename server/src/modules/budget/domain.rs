//! Pure budget rules. Database lookups and locking belong in `persistence`.
use crate::money;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn amount(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub(super) fn budget_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}

pub(super) fn period_end(value: &str) -> Option<NaiveDate> {
    if value.len() == 4 {
        return NaiveDate::from_ymd_opt(value.parse::<i32>().ok()?, 12, 31);
    }
    if value.len() == 7 {
        let start = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d").ok()?;
        let (year, month) = if start.month() == 12 {
            (start.year() + 1, 1)
        } else {
            (start.year(), start.month() + 1)
        };
        return NaiveDate::from_ymd_opt(year, month, 1)?.pred_opt();
    }
    None
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "budget" => {
            if let Some(value) = amount(document, "amount") {
                if value <= Decimal::ZERO {
                    errors.push("Budget amount must be greater than zero".into());
                }
            }
            if let Some(period) = document.get("period").and_then(Value::as_str) {
                if period_end(period).is_none() {
                    errors.push("Budget period must use YYYY or YYYY-MM".into());
                }
            }
        }
        "budget_line" => {
            if let Some(planned) = amount(document, "planned") {
                if planned <= Decimal::ZERO {
                    errors.push("Planned line amount must be greater than zero".into());
                }
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "budget_line" && patch.get("actual").is_some() {
        return vec!["Actual amounts are derived from posted accounting entries".into()];
    }
    if entity == "budget"
        && current.get("status").and_then(Value::as_str) != Some("draft")
        && ["name", "period", "adjustment_of", "amount"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Approved budgets are immutable; create an adjustment budget".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "budget" && document.get("status").and_then(Value::as_str) != Some("draft") {
        vec!["Approved budgets must be retained for audit history".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "budget" && action == "approved" {
        let mut errors = validate(entity, document);
        if period_end(document.get("period").and_then(Value::as_str).unwrap_or("")).is_none() {
            errors.push("Budget period must use YYYY or YYYY-MM".into());
        }
        errors
    } else {
        Vec::new()
    }
}
