//! Pure campaign, segment, and content invariants.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| value.len() == 10)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "campaign" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Campaign name is required".into());
            }
            if document.get("budget").is_some_and(|value| !value.is_null())
                && !document
                    .get("budget")
                    .and_then(money::decimal)
                    .is_some_and(|budget| budget >= Decimal::ZERO)
            {
                errors.push("Campaign budget must be zero or greater".into());
            }
            for field in ["start", "end"] {
                if document.get(field).is_some_and(|value| !value.is_null())
                    && date(document, field).is_none()
                {
                    errors.push(format!("Campaign {field} date is invalid"));
                }
            }
            if let (Some(start), Some(end)) = (date(document, "start"), date(document, "end")) {
                if start > end {
                    errors.push("Campaign end date must not precede its start date".into());
                }
            }
        }
        "segment" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Segment name is required".into());
            }
            if document
                .get("criteria")
                .is_some_and(|value| !value.is_null() && !value.is_object() && !value.is_array())
            {
                errors.push("Segment criteria must be a JSON object or array".into());
            }
        }
        "content_asset" => {
            if document
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
            {
                errors.push("Content title is required".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    validate_action_at(entity, action, document, chrono::Utc::now().date_naive())
}

pub fn validate_action_at(
    entity: &str,
    action: &str,
    document: &Value,
    today: chrono::NaiveDate,
) -> Vec<String> {
    if entity == "campaign" {
        if action == "launched" {
            if let Some(start) = date(document, "start")
                && start > today
            {
                return vec!["A campaign cannot launch before its start date".into()];
            }
        }
        if action == "completed" && date(document, "end").is_some_and(|end| end > today) {
            return vec!["A campaign cannot complete before its end date".into()];
        }
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if matches!(entity, "campaign_member" | "campaign_cost")
        && patch.as_object().is_some_and(|patch| !patch.is_empty())
    {
        return vec!["Campaign attribution and linked accounting costs are immutable".into()];
    }
    if entity == "campaign"
        && current.get("status").and_then(Value::as_str) != Some("planned")
        && patch.as_object().is_some_and(|patch| !patch.is_empty())
    {
        return vec!["Launched or completed campaigns are immutable".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if matches!(entity, "campaign_member" | "campaign_cost") {
        return vec![
            "Campaign attribution and accounting costs must remain as audit history".into(),
        ];
    }
    if entity == "campaign" && document.get("status").and_then(Value::as_str) != Some("planned") {
        return vec!["Launched or completed campaigns cannot be deleted".into()];
    }
    Vec::new()
}
