//! Document metadata and signature lifecycle invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "folder" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Folder name is required".into());
            }
        }
        "document" => {
            if document
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
            {
                errors.push("Document title is required".into());
            }
            if document
                .get("version")
                .is_some_and(|value| !value.is_null())
                && !document
                    .get("version")
                    .and_then(money::decimal)
                    .is_some_and(|version| version >= Decimal::ONE && version.fract().is_zero())
            {
                errors.push("Document version must be a positive integer".into());
            }
            if document
                .get("tags")
                .is_some_and(|value| !value.is_null() && !value.is_array() && !value.is_object())
            {
                errors.push("Document tags must be a JSON object or array".into());
            }
        }
        "signature_request" => {
            let email = document
                .get("signer_email")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let valid_email = email.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty()
                    && domain.contains('.')
                    && !domain.starts_with('.')
                    && !domain.ends_with('.')
            });
            if !valid_email {
                errors.push("A valid signer email is required".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(_entity: &str, _action: &str, _document: &Value) -> Vec<String> {
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "document" => {
            let file_changed = patch
                .get("file_url")
                .is_some_and(|value| value != current.get("file_url").unwrap_or(&Value::Null));
            if file_changed {
                let before = current
                    .get("version")
                    .and_then(money::decimal)
                    .unwrap_or(Decimal::ONE);
                let after = patch
                    .get("version")
                    .and_then(money::decimal)
                    .unwrap_or(before);
                if after <= before {
                    return vec![
                        "Replacing a document file requires a higher version number".into(),
                    ];
                }
            } else if patch.get("version").is_some_and(|version| {
                money::decimal(version) != current.get("version").and_then(money::decimal)
            }) {
                return vec!["Document version can change only when its file is replaced".into()];
            }
        }
        "signature_request"
            if current.get("status").and_then(Value::as_str) != Some("pending")
                && patch.as_object().is_some_and(|patch| !patch.is_empty()) =>
        {
            return vec!["Signed or declined signature requests are immutable".into()];
        }
        "signature_request" if patch.get("status").is_some() => {
            return vec!["Signature status can change only through its lifecycle action".into()];
        }
        _ => {}
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "signature_request"
        && document.get("status").and_then(Value::as_str) != Some("pending")
    {
        return vec!["Completed signature requests are retained as document history".into()];
    }
    Vec::new()
}
