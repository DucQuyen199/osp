//! Application-level normalization for integration configuration commands.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use url::Url;
use uuid::Uuid;

/// Persist one delivery per active, subscribed endpoint in the source
/// transaction. Network I/O is deliberately left to the background worker.
pub async fn enqueue_event(
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_id: Uuid,
    event_type: &str,
    event_at: DateTime<Utc>,
    depth: u32,
    causation_id: Option<Uuid>,
    event_payload: &Value,
) -> R<()> {
    if !tenant.has_module("integration-hub") {
        return Ok(());
    }
    let record_id = event_payload.get("id").and_then(Value::as_str);
    let envelope = json!({
        "id": event_id,
        "type": event_type,
        "at": event_at.to_rfc3339(),
        "tenantId": tenant.id,
        "depth": depth,
        "recordId": record_id,
        "causationId": causation_id,
        "data": event_payload,
    });
    for row in tx
        .query(
            "SELECT id, events FROM integration_hub__webhook WHERE tenant_id = $1 AND active = true",
            &[&tenant.id],
        )
        .await?
    {
        let webhook_id: Uuid = row.get(0);
        let events: Option<Value> = row.get(1);
        if !subscribes_to(events.as_ref(), event_type) {
            continue;
        }
        tx.execute(
            "INSERT INTO osp_outbox (id, tenant_id, webhook_id, event_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, webhook_id, event_id) DO NOTHING",
            &[&Uuid::new_v4(), &tenant.id, &webhook_id, &event_id, &event_type, &envelope],
        )
        .await?;
    }
    Ok(())
}

pub(crate) fn subscribes_to(events: Option<&Value>, event_type: &str) -> bool {
    let Some(events) = events.and_then(Value::as_array) else {
        return false;
    };
    events.iter().any(|event| {
        event.as_str().is_some_and(|subscribed| {
            subscribed == "*"
                || subscribed == event_type
                || subscribed
                    .strip_suffix(".*")
                    .is_some_and(|prefix| event_type.starts_with(&format!("{prefix}.")))
        })
    })
}

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    match entity {
        "webhook" => {
            if let Some(raw) = document.get("url").and_then(Value::as_str) {
                if let Ok(url) = Url::parse(raw.trim()) {
                    document.insert("url".into(), Value::String(url.to_string()));
                }
            }
            normalize_string_list(document, "events");
        }
        "connector" => {
            trim_field(document, "kind");
            trim_field(document, "name");
        }
        "api_key" => {
            trim_field(document, "name");
            normalize_string_list(document, "scopes");
        }
        _ => {}
    }
}

/// Remove credentials from documents before returning them to clients or
/// publishing them to external event subscribers. The stored document remains
/// intact for the integration worker.
pub fn redact_document(entity: &str, mut document: Value) -> Value {
    if entity == "connector" {
        redact_config(&mut document);
        return document;
    }
    let Some(object) = document.as_object_mut() else {
        return document;
    };
    match entity {
        "webhook" => {
            let configured = object
                .remove("secret")
                .is_some_and(|value| !value.is_null() && value.as_str() != Some(""));
            object.insert("secretConfigured".into(), json!(configured));
        }
        "api_key" => {
            let configured = object
                .remove("key")
                .is_some_and(|value| !value.is_null() && value.as_str() != Some(""));
            object.insert("keyConfigured".into(), json!(configured));
        }
        _ => {}
    }
    document
}

fn redact_config(value: &mut Value) {
    match value {
        Value::Object(object) => {
            let header_name = object
                .get("name")
                .or_else(|| object.get("key"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            for (key, value) in object.iter_mut() {
                let normalized = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
                if normalized == "key"
                    || [
                        "secret",
                        "password",
                        "token",
                        "authorization",
                        "apikey",
                        "credential",
                        "privatekey",
                        "accesskey",
                    ]
                    .iter()
                    .any(|marker| normalized.contains(marker))
                {
                    *value = json!("[redacted]");
                } else if matches!(normalized.as_str(), "value" | "header")
                    && ["authorization", "cookie", "token", "secret", "api-key"]
                        .iter()
                        .any(|marker| header_name.contains(marker))
                {
                    *value = json!("[redacted]");
                } else {
                    redact_config(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_config),
        _ => {}
    }
}

fn trim_field(document: &mut Map<String, Value>, field: &str) {
    if let Some(value) = document.get(field).and_then(Value::as_str) {
        document.insert(field.into(), Value::String(value.trim().to_string()));
    }
}

fn normalize_string_list(document: &mut Map<String, Value>, field: &str) {
    let Some(values) = document.get(field).and_then(Value::as_array) else {
        return;
    };
    let mut normalized: Vec<String> = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    normalized.sort();
    normalized.dedup();
    document.insert(
        field.into(),
        Value::Array(normalized.into_iter().map(Value::String).collect()),
    );
}
