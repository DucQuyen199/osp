//! Pure objective, key-result, and review invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "objective" | "key_result" => {
            if document
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
            {
                errors.push(format!("{entity} title is required"));
            }
        }
        _ => {}
    }
    match entity {
        "key_result" => {
            if !document
                .get("target")
                .and_then(money::decimal)
                .is_some_and(|value| value > Decimal::ZERO)
            {
                errors.push("Key result target must be greater than zero".into());
            }
            if document
                .get("current")
                .is_some_and(|value| !value.is_null())
                && !document
                    .get("current")
                    .and_then(money::decimal)
                    .is_some_and(|value| value >= Decimal::ZERO)
            {
                errors.push("Key result current value cannot be negative".into());
            }
        }
        "review" => {
            if document
                .get("reviewer")
                .and_then(Value::as_str)
                .zip(document.get("employee").and_then(Value::as_str))
                .is_some_and(|(reviewer, employee)| reviewer == employee)
            {
                errors.push(
                    "The reviewer must be a different employee from the review subject".into(),
                );
            }
            if document.get("score").is_some_and(|value| !value.is_null())
                && !document
                    .get("score")
                    .and_then(money::decimal)
                    .is_some_and(|value| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&value))
            {
                errors.push("Review score must be between 0 and 100".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "review" {
        return Vec::new();
    }
    match action {
        "submitted" => {
            let mut errors = Vec::new();
            if document
                .get("period")
                .and_then(Value::as_str)
                .is_none_or(|period| period.trim().is_empty())
            {
                errors.push("A review period is required before submission".into());
            }
            if !document
                .get("score")
                .and_then(money::decimal)
                .is_some_and(|score| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&score))
            {
                errors.push("A score from 0 to 100 is required before submission".into());
            }
            if document
                .get("comment")
                .and_then(Value::as_str)
                .is_none_or(|comment| comment.trim().is_empty())
            {
                errors.push("A review comment is required before submission".into());
            }
            if document
                .get("reviewer")
                .and_then(Value::as_str)
                .is_none_or(|reviewer| reviewer.trim().is_empty())
            {
                errors.push("A reviewer is required before submission".into());
            }
            errors
        }
        "returned" => {
            if document
                .get("revision_note")
                .and_then(Value::as_str)
                .is_none_or(|note| note.trim().is_empty())
            {
                vec!["A reason is required when returning a review for revision".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "review" {
        if patch.get("employee").is_some() {
            return vec![
                "The employee on a performance review cannot be changed after creation".into(),
            ];
        }
        if matches!(
            current.get("status").and_then(Value::as_str),
            Some("submitted" | "acknowledged")
        ) && patch.as_object().is_some_and(|fields| !fields.is_empty())
        {
            let editable_revision_note = current.get("status").and_then(Value::as_str)
                == Some("submitted")
                && patch.as_object().is_some_and(|fields| {
                    fields.len() == 1 && fields.contains_key("revision_note")
                });
            if !editable_revision_note {
                return vec!["Submitted reviews are locked until returned for revision; acknowledged reviews are final".into()];
            }
        }
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, _document: &Value) -> Vec<String> {
    if entity == "review" {
        return vec!["Performance reviews are retained as employee history".into()];
    }
    Vec::new()
}
