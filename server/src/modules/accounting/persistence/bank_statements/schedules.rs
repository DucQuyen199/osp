use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let schedule_id = document
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let interval = document.get("interval_minutes").and_then(Value::as_i64);
    if action != "removed" && !interval.is_some_and(|value| (15..=1440).contains(&value)) {
        errors.push("Bank feed interval must be between 15 and 1440 minutes".into());
    }
    if action == "removed" {
        return Ok(errors);
    }
    let Some(statement_id) = document.get("statement").and_then(Value::as_str) else {
        errors.push("A bank statement is required for a feed schedule".into());
        return Ok(errors);
    };
    let Some(connector_id) = document.get("connector").and_then(Value::as_str) else {
        errors.push("A bank feed connector is required for a feed schedule".into());
        return Ok(errors);
    };
    let schedule_enabled = document
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let row = tx.query_opt(
        "SELECT s.status, c.enabled, c.config->>'adapter', s.end_date - s.start_date FROM accounting__bank_statement s CROSS JOIN integration_hub__connector c WHERE s.tenant_id = $1 AND s.id::text = $2 AND c.tenant_id = $1 AND c.id::text = $3",
        &[&tenant.id, &statement_id, &connector_id],
    ).await?;
    match row {
        None => errors.push("Schedule statement and connector must belong to this tenant".into()),
        Some(row) => {
            let status: String = row.get(0);
            let enabled: bool = row.get(1);
            let adapter: Option<String> = row.get(2);
            let period_days: i32 = row.get(3);
            if status != "draft" {
                errors.push("Feed schedules can only target draft bank statements".into());
            }
            if period_days >= 90 {
                errors.push("Scheduled feed statement periods must not exceed 90 days".into());
            }
            if !adapter.as_deref().is_some_and(|value| {
                matches!(
                    value,
                    "casso_bank_feed"
                        | "sepay_bank_feed"
                        | "plaid_bank_feed"
                        | "salt_edge_bank_feed"
                )
            }) || (schedule_enabled && !enabled)
            {
                errors.push("Select an enabled Casso, SePay, Plaid, or Salt Edge bank feed".into());
            }
        }
    }
    if action != "removed" {
        let duplicate = tx.query_opt(
            "SELECT 1 FROM accounting__bank_feed_schedule WHERE tenant_id = $1 AND statement::text = $2 AND id::text <> $3 LIMIT 1",
            &[&tenant.id, &statement_id, &schedule_id],
        ).await?.is_some();
        if duplicate {
            errors.push("Only one periodic bank feed schedule is allowed per statement".into());
        }
    }
    Ok(errors)
}
