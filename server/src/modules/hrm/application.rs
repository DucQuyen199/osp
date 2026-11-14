//! Normalize employee identity and HR request text fields.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    let fields: &[&str] = match entity {
        "department" | "position" => &["name"],
        "employee" => &["name", "code", "email", "phone"],
        "leave_request" => &["kind", "reason", "pay_treatment"],
        "holiday" => &["name", "pay_treatment"],
        _ => &[],
    };
    for field in fields {
        if let Some(value) = document.get(*field).and_then(Value::as_str) {
            let value = value.trim();
            let normalized = match *field {
                "code" => value.to_ascii_uppercase(),
                "email" => value.to_ascii_lowercase(),
                _ => value.to_owned(),
            };
            document.insert((*field).into(), Value::String(normalized));
        }
    }
    if entity == "leave_request" {
        let treatment = document
            .get("pay_treatment")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| {
                if document.get("kind").and_then(Value::as_str) == Some("unpaid") {
                    "unpaid".to_owned()
                } else {
                    "paid".to_owned()
                }
            });
        document.insert("pay_treatment".into(), Value::String(treatment));
    }
    if entity == "holiday" {
        let treatment = document
            .get("pay_treatment")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "paid".into());
        document.insert("pay_treatment".into(), Value::String(treatment));
    }
}
