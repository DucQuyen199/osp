//! Scheduled BI report snapshots run transactionally through the shared job dispatcher.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn cadence(report: &Value) -> R<Duration> {
    match report.get("schedule").and_then(Value::as_str) {
        Some("daily") => Ok(Duration::days(1)),
        Some("weekly") => Ok(Duration::weeks(1)),
        _ => Err(ApiError::validation(
            "bi.report.schedule",
            vec!["Scheduled report requires a daily or weekly cadence".into()],
        )),
    }
}

fn next_due(report: &Value, now: DateTime<Utc>) -> R<DateTime<Utc>> {
    let interval = cadence(report)?;
    let due = report
        .get("next_run_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or(now);
    let elapsed = now.signed_duration_since(due).num_seconds().max(0);
    let interval_seconds = interval.num_seconds();
    let steps = elapsed / interval_seconds + 1;
    let next_seconds = steps
        .checked_mul(interval_seconds)
        .ok_or_else(|| ApiError::internal("Scheduled report next run time exceeds date range"))?;
    due.checked_add_signed(Duration::seconds(next_seconds))
        .ok_or_else(|| ApiError::internal("Scheduled report next run time exceeds date range"))
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
    let action = match event_type {
        "bi.report.created" => "created",
        "bi.report.run_due" => "run_due",
        "bi.report.scheduled" => "scheduled",
        "bi.report.paused" => "paused",
        _ => return Ok(false),
    };
    let Some(report_id) = event
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(ApiError::validation(
            event_type,
            vec!["Scheduled report event requires a valid report id".into()],
        ));
    };
    let report_entity = kernel.ent(tenant, "bi.report")?;
    match action {
        "created" => {
            if !matches!(
                event.get("schedule").and_then(Value::as_str),
                Some("daily" | "weekly")
            ) {
                return Ok(false);
            }
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &report_entity,
                    &report_id.to_string(),
                    "scheduled",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        }
        "paused" => {
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &report_entity,
                    &report_id.to_string(),
                    Map::from_iter([("next_run_at".into(), Value::Null)]),
                    &Opts::top(),
                )
                .await?;
        }
        "scheduled" => {
            let interval = cadence(event)?;
            let next = Utc::now().checked_add_signed(interval).ok_or_else(|| {
                ApiError::internal("Scheduled report next run time exceeds date range")
            })?;
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &report_entity,
                    &report_id.to_string(),
                    Map::from_iter([("next_run_at".into(), json!(next.to_rfc3339()))]),
                    &Opts::top(),
                )
                .await?;
        }
        "run_due" => {
            let report = kernel
                .get(&Actor::System, tenant, "bi.report", &report_id.to_string())
                .await?;
            let result = kernel
                .run_bi_report(&Actor::System, tenant, &report_id.to_string())
                .await?;
            if result.to_string().len() > 2_000_000 {
                return Err(ApiError::validation(
                    "bi.report.schedule",
                    vec!["Scheduled report snapshot exceeds the 2 MB storage limit".into()],
                ));
            }
            let run_entity = kernel.ent(tenant, "bi.report_run")?;
            let mut run = Map::new();
            run.insert("report".into(), json!(report_id));
            run.insert("run_at".into(), json!(Utc::now().to_rfc3339()));
            run.insert(
                "row_count".into(),
                result.get("total").cloned().unwrap_or_else(|| json!(0)),
            );
            run.insert("result".into(), result);
            run.insert("status".into(), json!("completed"));
            kernel
                .create_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &run_entity,
                    run,
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
            let next = next_due(&report, Utc::now())?;
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &report_entity,
                    &report_id.to_string(),
                    Map::from_iter([("next_run_at".into(), json!(next.to_rfc3339()))]),
                    &Opts::top(),
                )
                .await?;
        }
        _ => unreachable!(),
    }
    Ok(true)
}
