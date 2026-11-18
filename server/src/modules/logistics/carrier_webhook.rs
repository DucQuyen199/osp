//! Authenticated generic carrier tracking webhook receiver.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Map, Value, json};
use sha2::Sha256;
use std::env;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const MAX_EVENT_ID: usize = 200;
const MAX_TRACKING_NUMBER: usize = 128;
const MAX_DESCRIPTION: usize = 1000;
const MAX_LOCATION: usize = 240;

pub async fn receive_tracking_webhook(
    kernel: &Kernel,
    tenant: &Tenant,
    connector_id: &str,
    signature: Option<&str>,
    raw_body: &[u8],
) -> R<Value> {
    if tenant.suspended {
        return Err(ApiError::new(
            403,
            "TENANT_SUSPENDED",
            "Tenant is suspended",
        ));
    }
    let connector_id = Uuid::parse_str(connector_id).map_err(|_| {
        ApiError::new(
            404,
            "CARRIER_CONNECTOR_NOT_FOUND",
            "Carrier connector not found",
        )
    })?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let connector = tx
        .query_opt(
            "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND kind = 'carrier' AND enabled = true FOR UPDATE",
            &[&tenant.id, &connector_id],
        )
        .await?
        .ok_or_else(|| ApiError::new(404, "CARRIER_CONNECTOR_NOT_FOUND", "Carrier connector not found"))?;
    let config: Value = connector.get(0);
    if config.get("adapter").and_then(Value::as_str) != Some("carrier_tracking_webhook") {
        return Err(ApiError::new(
            404,
            "CARRIER_CONNECTOR_NOT_FOUND",
            "Carrier connector not found",
        ));
    }
    let secret_env = config
        .get("secret_env")
        .and_then(Value::as_str)
        .filter(|name| valid_secret_env_name(name))
        .ok_or_else(|| ApiError::internal("Carrier connector secret_env is missing or invalid"))?;
    let secret = env::var(secret_env)
        .ok()
        .filter(|value| (16..=256).contains(&value.len()))
        .ok_or_else(|| ApiError::internal("Carrier webhook runtime secret is missing or weak"))?;
    verify_signature(&secret, signature, raw_body)?;

    let payload: Value = serde_json::from_slice(raw_body).map_err(|_| {
        ApiError::new(
            400,
            "INVALID_CARRIER_EVENT",
            "Webhook body must be valid JSON",
        )
    })?;
    let event_id = required_text(&payload, "event_id", MAX_EVENT_ID)?;
    let tracking_number = required_text(&payload, "tracking_number", MAX_TRACKING_NUMBER)?;
    let status = required_text(&payload, "status", 32)?;
    if !matches!(
        status,
        "picked_up"
            | "in_transit"
            | "out_for_delivery"
            | "delivery_attempted"
            | "delivered"
            | "exception"
    ) {
        return Err(invalid(
            "status must be a supported carrier tracking status",
        ));
    }
    let description = required_text(&payload, "description", MAX_DESCRIPTION)?;
    let location = optional_text(&payload, "location", MAX_LOCATION)?;
    let occurred_at = required_text(&payload, "occurred_at", 64)?;
    let occurred_at = DateTime::parse_from_rfc3339(occurred_at)
        .map_err(|_| invalid("occurred_at must be an RFC 3339 timestamp"))?
        .with_timezone(&Utc);
    if occurred_at > Utc::now() + chrono::Duration::minutes(5) {
        return Err(invalid(
            "occurred_at cannot be more than five minutes in the future",
        ));
    }
    let carrier_name = config
        .get("carrier_name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::internal("Carrier connector name is missing"))?;
    let shipment_rows = tx
        .query(
            "SELECT id, status FROM logistics__shipment WHERE tenant_id = $1 AND lower(btrim(carrier)) = lower(btrim($2)) AND btrim(tracking_number) = $3 ORDER BY id LIMIT 2 FOR UPDATE",
            &[&tenant.id, &carrier_name, &tracking_number],
        )
        .await?;
    if shipment_rows.len() != 1 {
        return Err(ApiError::new(
            if shipment_rows.is_empty() { 404 } else { 409 },
            if shipment_rows.is_empty() {
                "CARRIER_SHIPMENT_NOT_FOUND"
            } else {
                "AMBIGUOUS_CARRIER_TRACKING_NUMBER"
            },
            if shipment_rows.is_empty() {
                "No shipment matches this carrier and tracking number"
            } else {
                "More than one shipment matches this carrier and tracking number"
            },
        ));
    }
    let shipment_id: Uuid = shipment_rows[0].get(0);
    let shipment_status: String = shipment_rows[0].get(1);
    if shipment_status == "created" {
        return Err(ApiError::new(
            409,
            "CARRIER_SHIPMENT_NOT_DISPATCHED",
            "Tracking events cannot be recorded before the shipment is dispatched",
        ));
    }

    // Serialize first-time deliveries too: a row lock cannot lock a duplicate
    // that has not been inserted yet. Share the key used by the logistics
    // persistence validator so API and webhook writes cannot race each other.
    let lock_key = format!("logistics-tracking:{}:{shipment_id}", tenant.id);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let duplicate = tx
        .query_opt(
            "SELECT (status = $4 AND description = $5 AND location IS NOT DISTINCT FROM $6 AND occurred_at = $7) FROM logistics__tracking_event WHERE tenant_id = $1 AND shipment = $2 AND carrier_event_id = $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &shipment_id, &event_id, &status, &description, &location, &occurred_at],
        )
        .await?;
    if let Some(row) = duplicate {
        let same_event: bool = row.get(0);
        if same_event {
            tx.commit().await?;
            return Ok(json!({ "accepted": true, "duplicate": true }));
        }
        return Err(ApiError::new(
            409,
            "CARRIER_EVENT_ID_CONFLICT",
            "The carrier event ID was already used with different tracking data",
        ));
    }

    let entity = kernel.ent(tenant, "logistics.tracking_event")?;
    let mut data = Map::new();
    data.insert("shipment".into(), json!(shipment_id));
    data.insert("carrier_event_id".into(), json!(event_id));
    data.insert("status".into(), json!(status));
    data.insert("description".into(), json!(description));
    data.insert("occurred_at".into(), json!(occurred_at));
    if let Some(location) = location {
        data.insert("location".into(), json!(location));
    }
    let created = kernel
        .create_in(&tx, &Actor::System, tenant, &entity, data, &Opts::top())
        .await?;
    tx.commit().await?;
    Ok(json!({ "accepted": true, "duplicate": false, "trackingEventId": created.get("id") }))
}

fn verify_signature(secret: &str, signature: Option<&str>, raw_body: &[u8]) -> R<()> {
    let signature = signature
        .and_then(|value| value.strip_prefix("sha256="))
        .and_then(|value| hex::decode(value).ok())
        .ok_or_else(|| {
            ApiError::new(
                401,
                "INVALID_CARRIER_SIGNATURE",
                "Missing or invalid carrier signature",
            )
        })?;
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(secret.as_bytes())
        .map_err(|_| ApiError::internal("Cannot initialize carrier signature verification"))?;
    mac.update(raw_body);
    mac.verify_slice(&signature).map_err(|_| {
        ApiError::new(
            401,
            "INVALID_CARRIER_SIGNATURE",
            "Missing or invalid carrier signature",
        )
    })
}

fn required_text<'a>(payload: &'a Value, field: &str, max_chars: usize) -> R<&'a str> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.chars().count() <= max_chars
                && !value.chars().any(char::is_control)
        })
        .ok_or_else(|| {
            invalid(format!(
                "{field} is required and must be at most {max_chars} characters"
            ))
        })?;
    Ok(value)
}

fn optional_text(payload: &Value, field: &str, max_chars: usize) -> R<Option<String>> {
    let Some(value) = payload.get(field).and_then(Value::as_str) else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(invalid(format!(
            "{field} must be at most {max_chars} characters"
        )));
    }
    Ok(Some(value.to_owned()))
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::validation("logistics.tracking_event", vec![message.into()])
}

fn valid_secret_env_name(name: &str) -> bool {
    name.strip_prefix("OSP_CARRIER_WEBHOOK_SECRET_")
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix.len() <= 64
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
}
