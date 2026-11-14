//! Tenant-scoped integration configuration checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "api_key" || !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    let Some(name) = document.get("name").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| uuid::Uuid::parse_str(value).ok());
    let duplicate = tx
        .query_opt(
            "SELECT id FROM integration_hub__api_key WHERE tenant_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1 FOR SHARE",
            &[&tenant.id, &name, &id],
        )
        .await?
        .is_some();
    Ok(if duplicate {
        vec!["API key name must be unique within the tenant".into()]
    } else {
        Vec::new()
    })
}
