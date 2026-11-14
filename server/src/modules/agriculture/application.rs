//! Normalize agricultural operations before recording them.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "farm" => &["name", "location"],
        "crop_cycle" => &["crop"],
        "harvest" => &["grade", "lot_code"],
        "input_application" => &[],
        _ => &[],
    };
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() && matches!(*field, "name" | "crop") {
                errors.push(format!("Trường {field} không được để trống"));
            }
        }
    }
    errors
}
