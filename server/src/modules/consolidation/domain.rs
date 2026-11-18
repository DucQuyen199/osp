//! Pure validation helpers for company-group membership commands.

use crate::error::{ApiError, R};
use uuid::Uuid;

pub fn validate(entity: &str, document: &serde_json::Value) -> Vec<String> {
    validate_rate_age_days(entity, document, false)
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
