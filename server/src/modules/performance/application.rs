//! Normalize objective, key-result, and review text fields.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "objective" => &["title", "period"],
        "key_result" => &["title"],
        "review" => &["period", "comment"],
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
            if value.is_empty() && *field == "title" {
                errors.push("Title cannot be empty".into());
            }
        }
    }
    errors
}
