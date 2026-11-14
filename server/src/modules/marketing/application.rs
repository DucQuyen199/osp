//! Normalize marketing records before generic schema validation and storage.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "campaign" | "segment" => &["name"],
        "content_asset" => &["title", "kind", "url"],
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
            if value.is_empty() && matches!(*field, "name" | "title") {
                errors.push(format!("{field} cannot be empty"));
            }
        }
    }
    errors
}
