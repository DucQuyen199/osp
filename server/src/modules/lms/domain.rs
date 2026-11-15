//! Course and learner progress invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

fn progress(document: &Value) -> Option<Decimal> {
    document.get("progress").and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "course" | "lesson" => {
            if document
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
            {
                errors.push(format!("{entity} title is required"));
            }
        }
        "enrollment" => {
            if document
                .get("progress")
                .is_some_and(|value| !value.is_null())
                && !progress(document)
                    .is_some_and(|value| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&value))
            {
                errors.push("Enrollment progress must be between 0 and 100".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "enrollment" && action == "completed" {
        return if progress(document).is_some_and(|value| value >= Decimal::ONE_HUNDRED) {
            Vec::new()
        } else {
            vec!["Enrollment can complete only at 100 percent progress".into()]
        };
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if matches!(entity, "lesson_progress" | "certificate") {
        return vec![if entity == "certificate" {
            "Issued certificates are immutable training evidence".into()
        } else {
            "Lesson completion records are immutable learning history".into()
        }];
    }
    if entity != "enrollment" || !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if current.get("status").and_then(Value::as_str) == Some("completed") {
        return vec!["Completed learning enrollments are immutable".into()];
    }
    if patch.get("course").is_some() || patch.get("learner").is_some() {
        return vec!["Enrollment course and learner cannot be changed after creation".into()];
    }
    if patch.get("status").is_some() {
        return vec!["Enrollment status can change only through its lifecycle action".into()];
    }
    if let (Some(before), Some(after)) = (progress(current), progress(patch)) {
        if after < before {
            return vec!["Enrollment progress cannot move backwards".into()];
        }
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, _document: &Value) -> Vec<String> {
    if matches!(entity, "enrollment" | "lesson_progress" | "certificate") {
        return vec!["Learning progress records are retained as training history".into()];
    }
    Vec::new()
}
