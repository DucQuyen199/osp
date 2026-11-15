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
    for field in [
        "invoice",
        "request_payload",
        "attempts",
        "attempt_history",
        "retry_at",
    ] {
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
        "retry" | "retry_due" => {
            if document
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("issue")
                != "issue"
            {
                errors.push("Only an invoice issuance request can use this retry action".into());
            }
            if action == "retry_due" && !retry_is_due(document) {
                errors.push("The e-invoice retry is not due yet".into());
            }
        }
        "retry_cancellation" | "retry_cancellation_due" => {
            if document.get("operation").and_then(Value::as_str) != Some("cancel") {
                errors
                    .push("Only an invoice cancellation request can use this retry action".into());
            }
            for field in ["provider_reference", "cancellation_reason"] {
                if document
                    .get(field)
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                {
                    errors.push(format!("{field} is required to retry cancellation"));
                }
            }
            if action == "retry_cancellation_due" && !retry_is_due(document) {
                errors.push("The e-invoice cancellation retry is not due yet".into());
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
        "withdrawn" => {
            if document
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("issue")
                != "issue"
            {
                errors.push("Only an issuance request can be withdrawn".into());
            }
            if document
                .get("attempts")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                != 0
                || document
                    .get("lease_token")
                    .is_some_and(|token| !token.is_null())
            {
                errors.push(
                    "An issuance request can only be withdrawn before a provider attempt starts"
                        .into(),
                );
            }
        }
        _ => {}
    }
    errors
}

fn retry_is_due(document: &Value) -> bool {
    document
        .get("retry_at")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|retry_at| retry_at <= chrono::Utc::now())
}

pub fn validate_remove(entity: &str) -> Vec<String> {
    if entity == "einvoice" {
        vec!["E-invoice requests are retained as issuance and cancellation audit evidence".into()]
    } else {
        Vec::new()
    }
}

pub fn prepare_action(entity: &str, action: &str, document: &mut Map<String, Value>) {
    if entity != "einvoice"
        || !matches!(
            action,
            "cancel_requested"
                | "withdrawn"
                | "failed"
                | "retry"
                | "retry_due"
                | "retry_cancellation"
                | "retry_cancellation_due"
        )
    {
        return;
    }
    let attempts = document
        .get("attempts")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if action == "cancel_requested" {
        document.insert("operation".into(), Value::String("cancel".into()));
        document.remove("provider_error");
        document.insert("retry_at".into(), Value::Null);
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
        document.insert("retry_at".into(), Value::Null);
        if matches!(action, "retry" | "retry_cancellation") {
            document.insert("attempts".into(), Value::from(0));
        }
    }
}
