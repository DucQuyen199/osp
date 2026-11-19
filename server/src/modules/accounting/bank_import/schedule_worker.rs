use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel},
};
use chrono::NaiveDate;
use serde_json::Value;
use uuid::Uuid;

/// Claims a bounded batch under row locks, commits, and only then calls providers.
/// next_attempt_at is the lease; legacy rows fall back to last_attempt_at + interval.
pub async fn run_scheduled_bank_feeds_once(kernel: &Kernel) -> R<u32> {
    let mut processed = 0;
    let tenants = kernel.list_tenants().await?;
    for item in tenants {
        let Some(tenant_id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let tenant = match kernel.tenant(tenant_id).await {
            Ok(tenant) if !tenant.suspended && tenant.has_module("accounting") => tenant,
            _ => continue,
        };
        let today = tenant.business_today();
        let mut conn = kernel.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let rows = tx.query(
            "SELECT s.id, s.statement::text, s.connector::text, s.interval_minutes::int, c.config->>'adapter', b.start_date, LEAST(b.end_date, $2) \
             FROM accounting__bank_feed_schedule s \
             JOIN accounting__bank_statement b ON b.tenant_id = s.tenant_id AND b.id = s.statement AND b.status = 'draft' AND b.start_date <= $2 \
             JOIN integration_hub__connector c ON c.tenant_id = s.tenant_id AND c.id = s.connector AND c.enabled = true \
             WHERE s.tenant_id = $1 AND s.enabled = true AND s.interval_minutes BETWEEN 15 AND 1440 \
               AND c.config->>'adapter' IN ('casso_bank_feed','sepay_bank_feed','plaid_bank_feed','salt_edge_bank_feed') \
             AND (s.next_attempt_at <= now() OR (s.next_attempt_at IS NULL AND (s.last_attempt_at IS NULL OR s.last_attempt_at <= now() - make_interval(mins => s.interval_minutes::int)))) \
             AND b.end_date - b.start_date < 90 \
             ORDER BY COALESCE(s.last_attempt_at, '-infinity'::timestamptz), s.created_at \
             LIMIT 5 FOR UPDATE OF s SKIP LOCKED",
            &[&tenant.id, &today],
        ).await?;
        let mut claimed = Vec::with_capacity(rows.len());
        for row in rows {
            let id: Uuid = row.get(0);
            let interval: i32 = row.get(3);
            tx.execute("UPDATE accounting__bank_feed_schedule SET last_attempt_at = now(), next_attempt_at = now() + make_interval(mins => $3::int), last_error = NULL WHERE tenant_id = $1 AND id = $2", &[&tenant.id, &id, &interval]).await?;
            claimed.push((
                id,
                row.get::<_, String>(1),
                row.get::<_, String>(2),
                interval,
                row.get::<_, Option<String>>(4),
                row.get::<_, NaiveDate>(5),
                row.get::<_, NaiveDate>(6),
            ));
        }
        tx.commit().await?;
        drop(conn);
        for (schedule_id, statement_id, connector_id, interval, adapter, from, to) in claimed {
            let actor = Actor::System;
            let from_date = from.format("%Y-%m-%d").to_string();
            let to_date = to.format("%Y-%m-%d").to_string();
            let outcome = match adapter.as_deref() {
                Some("casso_bank_feed") => {
                    super::import::sync_statement_casso(
                        kernel,
                        &actor,
                        &tenant,
                        &statement_id,
                        &connector_id,
                        Some(&from_date),
                        Some(&to_date),
                    )
                    .await
                }
                Some("sepay_bank_feed") => {
                    super::import::sync_statement_sepay(
                        kernel,
                        &actor,
                        &tenant,
                        &statement_id,
                        &connector_id,
                        Some(&from_date),
                        Some(&to_date),
                    )
                    .await
                }
                Some("plaid_bank_feed") => {
                    super::import::sync_statement_plaid(
                        kernel,
                        &actor,
                        &tenant,
                        &statement_id,
                        &connector_id,
                        Some(&from_date),
                        Some(&to_date),
                    )
                    .await
                }
                Some("salt_edge_bank_feed") => {
                    super::import::sync_statement_salt_edge(
                        kernel,
                        &actor,
                        &tenant,
                        &statement_id,
                        &connector_id,
                        Some(&from_date),
                        Some(&to_date),
                    )
                    .await
                }
                _ => continue,
            };
            let mut conn = kernel.pool.get().await?;
            let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
            match outcome {
                Ok(_) => {
                    tx.execute("UPDATE accounting__bank_feed_schedule SET last_success_at = now(), last_error = NULL WHERE tenant_id = $1 AND id = $2", &[&tenant.id, &schedule_id]).await?;
                    processed += 1;
                }
                Err(error) => {
                    tracing::warn!(tenant_id = %tenant.id, schedule_id = %schedule_id, error_code = %error.code, "scheduled bank feed sync failed");
                    let safe_error = scheduled_error(&error);
                    let retry_after = provider_retry_after(&error);
                    tx.execute("UPDATE accounting__bank_feed_schedule SET last_error = $3, next_attempt_at = GREATEST(now() + make_interval(mins => $4::int), now() + (COALESCE($5::bigint, 0) * interval '1 second')) WHERE tenant_id = $1 AND id = $2", &[&tenant.id, &schedule_id, &safe_error, &interval, &retry_after]).await?;
                }
            }
            tx.commit().await?;
        }
    }
    Ok(processed)
}

fn scheduled_error(error: &crate::error::ApiError) -> String {
    if error.code == "BANK_PROVIDER_RATE_LIMITED" {
        if provider_retry_after(error).is_some() {
            return "Bank provider rate limit reached; the next automatic sync is delayed to respect Retry-After.".into();
        }
        return "Bank provider rate limit reached; the next automatic sync will follow the configured interval.".into();
    }
    match error.code.as_str() {
        "BANK_PROVIDER_UNAVAILABLE" => "Bank provider is unavailable; the next automatic sync will follow the configured interval.".into(),
        "BANK_PROVIDER_REJECTED" => "Bank provider rejected the request; check connector credentials and permissions.".into(),
        _ => "Bank feed sync failed; check connector settings and server logs.".into(),
    }
}

fn provider_retry_after(error: &crate::error::ApiError) -> Option<i64> {
    if error.code != "BANK_PROVIDER_RATE_LIMITED" {
        return None;
    }
    let seconds = error
        .message
        .split_once("retry after ")?
        .1
        .split_whitespace()
        .next()?
        .parse::<i64>()
        .ok()?;
    Some(seconds.clamp(0, 31_536_000))
}
