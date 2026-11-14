//! E-invoice issuance request invariants.
use serde_json::{Map, Value};
use uuid::Uuid;

/// Return the posted accounting invoice referenced by a source event.
pub fn posted_invoice_id(event_type: &str, document: &Value) -> Option<Uuid> {
    if event_type != "accounting.invoice.posted" {
        return None;
    }
    document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity != "einvoice" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    for field in ["invoice", "request_payload", "attempts", "attempt_history"] {
        if patch.get(field).is_some() {
            errors.push(format!("{field} is maintained by the e-invoice workflow"));
        }
    }
    if matches!(
        current.get("status").and_then(Value::as_str),
        Some("issued" | "cancelled")
    ) && [
        "provider",
        "serial",
        "number",
        "lookup_code",
        "provider_reference",
        "provider_response",
    ]
    .iter()
    .any(|field| patch.get(*field).is_some())
    {
        errors.push("Issued provider identity and numbering are immutable".into());
    }
    if patch.get("cancellation_reason").is_some()
        && current.get("status").and_then(Value::as_str) != Some("issued")
    {
        errors
            .push("A cancellation reason can only be changed while the e-invoice is issued".into());
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "einvoice" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    match action {
        "issued" => {
            for field in ["provider", "number"] {
                if document
                    .get(field)
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                {
                    errors.push(format!(
                        "{field} is required before marking an e-invoice issued"
                    ));
                }
            }
            if document.get("request_payload").is_none_or(Value::is_null) {
                errors.push(
                    "An immutable invoice request snapshot is required before issuance".into(),
                );
            }
            if document
                .get("provider_response")
                .and_then(Value::as_object)
                .is_none_or(serde_json::Map::is_empty)
            {
                errors.push(
                    "A provider response must be recorded before marking an e-invoice issued"
                        .into(),
                );
            }
        }
        "failed" => {
            if document
                .get("provider_error")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Record the provider error before marking an e-invoice failed".into());
            }
        }
        "cancelled" => {
            if document
                .get("cancellation_reason")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("A cancellation reason is required".into());
            }
            if document
                .get("cancellation_response")
                .and_then(Value::as_object)
                .is_none_or(serde_json::Map::is_empty)
            {
                errors.push("A provider cancellation response is required".into());
            }
        }
        "cancel_requested" => {
            for field in ["provider_reference", "cancellation_reason"] {
                if document
                    .get(field)
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                {
                    errors.push(format!(
                        "{field} is required before requesting cancellation"
                    ));
                }
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_remove(entity: &str) -> Vec<String> {
    if entity == "einvoice" {
        vec!["E-invoice requests are retained as issuance and cancellation audit evidence".into()]
    } else {
        Vec::new()
    }
}

pub fn prepare_action(entity: &str, action: &str, document: &mut Map<String, Value>) {
    if entity != "einvoice" || !matches!(action, "cancel_requested" | "failed" | "retry") {
        return;
    }
    let attempts = document
        .get("attempts")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if action == "cancel_requested" {
        document.insert("operation".into(), Value::String("cancel".into()));
        document.remove("provider_error");
    } else if action == "failed" {
        if let Some(error) = document
            .get("provider_error")
            .and_then(Value::as_str)
            .map(str::to_owned)
        {
            let operation = document
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("issue")
                .to_owned();
            let history = document
                .entry("attempt_history")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(history) = history.as_array_mut() {
                history.push(serde_json::json!({
                    "attempt": attempts.max(1),
                    "operation": operation,
                    "error": error,
                }));
            }
        }
    } else {
        document.remove("provider_error");
    }
}
