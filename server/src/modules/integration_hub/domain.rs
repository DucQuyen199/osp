//! Pure configuration invariants for external integration records.
use serde_json::Value;
use std::{collections::HashSet, net::IpAddr};
use url::Url;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "webhook" => validate_webhook(document),
        "connector" => validate_connector(document),
        "api_key" => validate_api_key(document),
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !matches!(entity, "webhook" | "connector" | "api_key") {
        return Vec::new();
    }
    if entity != "connector" {
        return validate(entity, patch);
    }
    let mut merged = current.clone();
    if let (Some(current), Some(patch)) = (merged.as_object_mut(), patch.as_object()) {
        current.extend(patch.clone());
    }
    validate(entity, &merged)
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
    let enabled = document
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let config = document.get("config").filter(|value| !value.is_null());
    let kind = document
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(config) = config {
        if !config.is_object() {
            errors.push("Connector configuration must be an object".into());
        } else {
            if config.get("adapter").and_then(Value::as_str) == Some("carrier_tracking_webhook")
                && config.get("secret").is_some()
            {
                errors.push("Carrier signing secrets must be supplied through a runtime environment variable, not connector config".into());
            }
            if enabled {
                match config.get("adapter").and_then(Value::as_str) {
                    Some("http_event_sink") => validate_http_event_sink(config, &mut errors),
                    Some("casso_bank_feed") if kind == "bank_feed" => {
                        validate_casso_bank_feed(config, &mut errors)
                    }
                    Some("sepay_bank_feed") if kind == "bank_feed" => {
                        validate_sepay_bank_feed(config, &mut errors)
                    }
                    Some("plaid_bank_feed") if kind == "bank_feed" => {
                        validate_plaid_bank_feed(config, &mut errors)
                    }
                    Some("salt_edge_bank_feed") if kind == "bank_feed" => {
                        validate_salt_edge_bank_feed(config, &mut errors)
                    }
                    Some(
                        "casso_bank_feed"
                        | "sepay_bank_feed"
                        | "plaid_bank_feed"
                        | "salt_edge_bank_feed",
                    ) => errors.push("Bank feed adapter requires connector kind bank_feed".into()),
                    Some("carrier_tracking_webhook") if kind == "carrier" => {
                        validate_carrier_tracking_webhook(config, &mut errors)
                    }
                    Some("carrier_tracking_webhook") => errors.push(
                        "Carrier tracking webhook adapter requires connector kind carrier".into(),
                    ),
                    _ => errors.push("Enabled connector must use a supported adapter".into()),
                }
            }
        }
    } else if enabled {
        errors.push("An enabled connector requires a supported adapter configuration".into());
    }
    errors
}

fn validate_carrier_tracking_webhook(config: &Value, errors: &mut Vec<String>) {
    match config.get("carrier_name").and_then(Value::as_str) {
        Some(value)
            if !value.trim().is_empty()
                && value.chars().count() <= 120
                && !value.chars().any(char::is_control) => {}
        _ => errors
            .push("Carrier tracking webhook requires a carrier_name of 1 to 120 characters".into()),
    }
    match config.get("secret_env").and_then(Value::as_str) {
        Some(name)
            if name
                .strip_prefix("OSP_CARRIER_WEBHOOK_SECRET_")
                .is_some_and(|suffix| {
                    !suffix.is_empty()
                        && suffix.len() <= 64
                        && suffix.bytes().all(|byte| {
                            byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                        })
                }) => {}
        _ => errors.push("Carrier tracking webhook requires secret_env named OSP_CARRIER_WEBHOOK_SECRET_<UPPERCASE_NAME>".into()),
    }
}

fn validate_casso_bank_feed(config: &Value, errors: &mut Vec<String>) {
    match config.get("app_id").and_then(Value::as_str) {
        Some(value)
            if !value.trim().is_empty()
                && value.len() <= 256
                && !value.chars().any(char::is_control) => {}
        _ => errors.push("Casso bank feed requires a valid app_id".into()),
    }
    match config.get("app_secret").and_then(Value::as_str) {
        Some(value)
            if (16..=512).contains(&value.len()) && !value.chars().any(char::is_control) => {}
        _ => errors.push("Casso bank feed requires an app_secret of 16 to 512 characters".into()),
    }
    validate_bank_feed_webhook(config, "webhook_account_id", errors);
}

fn validate_sepay_bank_feed(config: &Value, errors: &mut Vec<String>) {
    match config.get("api_token").and_then(Value::as_str) {
        Some(value)
            if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_alphanumeric()) => {}
        _ => errors.push("SePay API v2 requires a 64-character alphanumeric api_token".into()),
    }
    match config.get("bank_account_id").and_then(Value::as_str) {
        Some(value) if uuid::Uuid::parse_str(value).is_ok() => {}
        _ => errors.push("SePay bank feed requires a bank_account_id UUID from SePay".into()),
    }
    if !matches!(
        config.get("environment").and_then(Value::as_str),
        Some("sandbox" | "production")
    ) {
        errors.push("SePay environment must be sandbox or production".into());
    }
    validate_bank_feed_webhook(config, "webhook_account_number", errors);
}

fn validate_bank_feed_webhook(config: &Value, account_field: &str, errors: &mut Vec<String>) {
    let secret_env = config.get("webhook_secret_env").and_then(Value::as_str);
    let account = config.get(account_field).and_then(Value::as_str);
    if secret_env.is_none() && account.is_none() {
        return;
    }
    if !secret_env.is_some_and(|name| {
        name.strip_prefix("OSP_BANK_WEBHOOK_SECRET_")
            .is_some_and(|suffix| !suffix.is_empty())
            && name.len() <= 80
            && name
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    }) {
        errors.push("Bank webhook secret must reference OSP_BANK_WEBHOOK_SECRET_<UPPERCASE_NAME> in the server environment".into());
    }
    if !account.is_some_and(|value| {
        !value.trim().is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
    }) {
        errors.push(format!(
            "Bank webhook connector requires a valid {account_field}"
        ));
    }
}

fn validate_plaid_bank_feed(config: &Value, errors: &mut Vec<String>) {
    match config.get("client_id").and_then(Value::as_str) {
        Some(value)
            if !value.trim().is_empty()
                && value.len() <= 256
                && !value.chars().any(char::is_control) => {}
        _ => errors.push("Plaid bank feed requires a valid client_id".into()),
    }
    match config.get("secret").and_then(Value::as_str) {
        Some(value)
            if (16..=512).contains(&value.len()) && !value.chars().any(char::is_control) => {}
        _ => errors.push("Plaid bank feed requires an API secret of 16 to 512 characters".into()),
    }
    if !matches!(
        config.get("environment").and_then(Value::as_str),
        Some("sandbox" | "development" | "production")
    ) {
        errors.push("Plaid environment must be sandbox, development, or production".into());
    }
    const COUNTRIES: &[&str] = &[
        "US", "CA", "GB", "AT", "BE", "DK", "EE", "FI", "FR", "DE", "IE", "IT", "LV", "LT", "NL",
        "NO", "PL", "PT", "ES", "SE",
    ];
    match config.get("country_codes").and_then(Value::as_array) {
        Some(countries)
            if (1..=10).contains(&countries.len())
                && countries.iter().all(|country| {
                    country
                        .as_str()
                        .is_some_and(|country| COUNTRIES.contains(&country))
                }) => {}
        _ => errors.push("Plaid country_codes must contain 1 to 10 supported country codes".into()),
    }
}

fn validate_salt_edge_bank_feed(config: &Value, errors: &mut Vec<String>) {
    match config.get("app_id").and_then(Value::as_str) {
        Some(value)
            if !value.trim().is_empty()
                && value.len() <= 256
                && !value.chars().any(char::is_control) => {}
        _ => errors.push("Salt Edge bank feed requires a valid app_id".into()),
    }
    match config.get("secret").and_then(Value::as_str) {
        Some(value)
            if (16..=512).contains(&value.len()) && !value.chars().any(char::is_control) => {}
        _ => {
            errors.push("Salt Edge bank feed requires an API secret of 16 to 512 characters".into())
        }
    }
}

fn validate_http_event_sink(config: &Value, errors: &mut Vec<String>) {
    match config.get("url").and_then(Value::as_str) {
        Some(raw) => match Url::parse(raw.trim()) {
            Ok(url) => {
                if url.scheme() != "https"
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.fragment().is_some()
                    || is_local_host(&url)
                {
                    errors.push("HTTP connector URL must be a public HTTPS URL without embedded credentials or fragments".into());
                }
            }
            Err(_) => errors.push("HTTP connector URL must be a valid absolute URL".into()),
        },
        None => errors.push("HTTP connector requires a URL".into()),
    }
    match config.get("events").and_then(Value::as_array) {
        Some(events) if !events.is_empty() && events.len() <= 100 => {
            for (index, event) in events.iter().enumerate() {
                if !event.as_str().is_some_and(valid_event_type) {
                    errors.push(format!("events[{}] must be a valid event name", index + 1));
                }
            }
        }
        Some(_) => errors.push("HTTP connector must subscribe to 1 to 100 event types".into()),
        None => errors.push("HTTP connector events must be a list of event names".into()),
    }
    if let Some(secret) = config.get("secret").and_then(Value::as_str) {
        if !secret.is_empty() && !(16..=256).contains(&secret.len()) {
            errors.push("HTTP connector signing secret must contain 16 to 256 bytes".into());
        }
    }
    if let Some(headers) = config.get("headers").filter(|value| !value.is_null()) {
        match headers.as_object() {
            Some(headers) if headers.len() <= 32 => {
                let mut seen = HashSet::with_capacity(headers.len());
                for (name, value) in headers {
                    let valid_name = !name.is_empty()
                        && name.len() <= 128
                        && name.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
                        });
                    let lower = name.to_ascii_lowercase();
                    if !seen.insert(lower.clone()) {
                        errors.push(format!(
                            "HTTP connector header {name} duplicates another header"
                        ));
                    }
                    if !valid_name
                        || lower.starts_with("x-osp-")
                        || matches!(
                            lower.as_str(),
                            "host"
                                | "content-length"
                                | "content-type"
                                | "transfer-encoding"
                                | "connection"
                        )
                    {
                        errors.push(format!(
                            "HTTP connector header name {name} is invalid or reserved"
                        ));
                    }
                    if !value.as_str().is_some_and(|value| {
                        value.len() <= 8192
                            && value
                                .bytes()
                                .all(|byte| byte == b'\t' || (0x20..=0x7e).contains(&byte))
                    }) {
                        errors.push(format!("HTTP connector header {name} must be a string without line breaks and at most 8192 bytes"));
                    }
                }
            }
            Some(_) => errors.push("HTTP connector can configure at most 32 headers".into()),
            None => errors.push("HTTP connector headers must be an object of string values".into()),
        }
    }
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
    let parts: Vec<&str> = value.split('.').collect();
    value.len() <= 128
        && parts.len() >= 2
        && parts.iter().enumerate().all(|(index, part)| {
            if *part == "*" {
                index == parts.len() - 1
            } else {
                !part.is_empty() && part.bytes().all(event_byte)
            }
        })
        && (parts.len() >= 3 || parts.last() == Some(&"*"))
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
