//! Normalize project, task, and work-entry identifiers.
use crate::money;
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let (fields, required): (&[&str], &[&str]) = match entity {
        "project" => (&["name"], &["name"]),
        "task" => (&["title", "assignee"], &["title"]),
        "timesheet" => (&["employee"], &[]),
        _ => return Vec::new(),
    };
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            if required.contains(field) && value.is_empty() {
                errors.push(format!("{field} cannot be empty"));
            }
            document.insert((*field).into(), Value::String(value));
        }
    }
    if entity == "timesheet"
        && let Some(hours) = document.get("hours").and_then(money::decimal)
    {
        let rate = document
            .get("rate")
            .and_then(money::decimal)
            .unwrap_or_default();
        if let Some(amount) = money::amount(hours, rate).and_then(money::json_number) {
            document.insert("amount".into(), amount);
        } else {
            errors.push("Timesheet amount exceeds the supported financial range".into());
        }
    }
    errors
}
