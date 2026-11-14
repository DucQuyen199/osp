//! Normalize support tickets, SLA policies, and knowledge-base content.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "ticket" => &[
            "subject",
            "channel",
            "assignee",
            "description",
            "resolution",
        ],
        "sla_policy" => &["name"],
        "kb_article" => &["title", "body"],
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
            if value.is_empty() && matches!(*field, "subject" | "name" | "title") {
                errors.push(format!("{field} cannot be empty"));
            }
        }
    }
    errors
}
