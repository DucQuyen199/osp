//! Normalize policy and claim commands before domain and persistence checks.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let mut errors = Vec::new();
    for field in match entity {
        "policy" => &["number", "product"][..],
        "claim" => &["number"][..],
        _ => &[][..],
    } {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() {
                errors.push(format!("Trường {field} không được để trống"));
            }
        }
    }
    if entity == "claim" {
        if let Some(value) = document
            .get("description")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert("description".into(), Value::String(value));
        }
    }
    errors
}
