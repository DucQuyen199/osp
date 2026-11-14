//! Pure configuration invariants for external integration records.
use serde_json::Value;
use std::net::IpAddr;
use url::Url;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "webhook" => validate_webhook(document),
        "connector" => validate_connector(document),
        "api_key" => validate_api_key(document),
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, _current: &Value, patch: &Value) -> Vec<String> {
    if !matches!(entity, "webhook" | "connector" | "api_key") {
        return Vec::new();
    }
    validate(entity, patch)
}

fn validate_webhook(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(raw) = document.get("url").and_then(Value::as_str) {
        match Url::parse(raw.trim()) {
            Ok(url) => {
                if url.scheme() != "https" {
                    errors.push("Webhook URL must use HTTPS".into());
                }
                if url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    errors
                        .push("Webhook URL must have a host and cannot include credentials".into());
                }
                if url.fragment().is_some() {
                    errors.push("Webhook URL cannot contain a fragment".into());
                }
                if is_local_host(&url) {
                    errors.push("Webhook URL cannot target a local or private IP address".into());
                }
            }
            Err(_) => errors.push("Webhook URL must be a valid absolute URL".into()),
        }
    }
    if let Some(events) = document.get("events").filter(|value| !value.is_null()) {
        match events.as_array() {
            Some(events) if events.len() <= 100 => {
                for (index, event) in events.iter().enumerate() {
                    let valid = event.as_str().is_some_and(valid_event_type);
                    if !valid {
                        errors.push(format!("events[{}] must be a valid event name", index + 1));
                    }
                }
            }
            Some(_) => errors.push("Webhook can subscribe to at most 100 event types".into()),
            None => errors.push("Webhook events must be a list of event names".into()),
        }
    }
    if let Some(secret) = document.get("secret").and_then(Value::as_str) {
        if !secret.is_empty() && !(16..=256).contains(&secret.len()) {
            errors.push("Webhook signing secret must contain 16 to 256 bytes".into());
        }
    }
    errors
}

fn validate_connector(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(kind) = document.get("kind").and_then(Value::as_str) {
        if kind.trim().is_empty() || kind.len() > 64 {
            errors.push("Connector kind must contain 1 to 64 characters".into());
        }
    }
    if let Some(name) = document.get("name").and_then(Value::as_str) {
        if name.trim().is_empty() || name.len() > 120 {
            errors.push("Connector name must contain 1 to 120 characters".into());
        }
    }
    errors
}

fn validate_api_key(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(name) = document.get("name").and_then(Value::as_str) {
        if name.trim().is_empty() || name.len() > 120 {
            errors.push("API key name must contain 1 to 120 characters".into());
        }
    }
    if let Some(scopes) = document.get("scopes").filter(|value| !value.is_null()) {
        match scopes.as_array() {
            Some(scopes) if scopes.len() <= 100 => {
                if scopes.iter().any(|scope| {
                    !scope.as_str().is_some_and(|value| {
                        !value.is_empty()
                            && value.len() <= 160
                            && value
                                .split('.')
                                .all(|part| !part.is_empty() && part.bytes().all(event_byte))
                    })
                }) {
                    errors.push("API key scopes must be valid permission names".into());
                }
            }
            Some(_) => errors.push("API key can have at most 100 scopes".into()),
            None => errors.push("API key scopes must be a list".into()),
        }
    }
    errors
}

fn valid_event_type(value: &str) -> bool {
    if value == "*" {
        return true;
    }
    value.len() <= 128
        && value.split('.').count() >= 3
        && value.split('.').enumerate().all(|(index, part)| {
            (part == "*" && index == value.split('.').count() - 1)
                || (!part.is_empty() && part.bytes().all(event_byte))
        })
}

fn event_byte(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
}

fn is_local_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return true;
    }
    host.parse::<IpAddr>().is_ok_and(|address| match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
        }
    })
}
