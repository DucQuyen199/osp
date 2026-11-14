//! Budget use-case helpers. Cross-module accounting aggregation remains in the
//! kernel transaction until the shared unit-of-work port is extracted.
use super::persistence;
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

/// Recompute each budget line from posted journal entries inside the caller's
/// transaction so approval and ledger posting cannot observe stale actuals.
pub async fn refresh_actuals(tx: &Tx<'_>, tenant: &Tenant) -> R<()> {
    persistence::refresh_actuals(tx, tenant).await
}

pub async fn validate_journal_posting(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    if !tenant.has_module("budget") || !tenant.setting_bool("enforceBudgetControl") {
        return Ok(Vec::new());
    }
    persistence::validate_journal_posting(tx, tenant, document).await
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("budget") || event_type != "budget.budget.approved" {
        return Ok(false);
    }
    let Some(previous_id) = event
        .get("adjustment_of")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    let status = tx
        .query_opt(
            "SELECT status FROM budget__budget WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &previous_id],
        )
        .await?
        .map(|row| row.get::<_, String>(0))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Adjustment source budget was not found in this tenant".into()],
            )
        })?;
    if status == "superseded" {
        return Ok(true);
    }
    if !matches!(status.as_str(), "approved" | "closed") {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Only an active approved budget can be superseded".into()],
        ));
    }
    let entity = kernel.ent(tenant, "budget.budget")?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &previous_id.to_string(),
            "superseded",
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
