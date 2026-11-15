//! Scheduled BI report snapshots run transactionally through the shared job dispatcher.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn csv_cell(value: &Value) -> String {
    let is_text = value.is_string();
    let mut text = match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        _ => value.to_string(),
    };
    if is_text
        && text
            .trim_start()
            .chars()
            .next()
            .is_some_and(|character| matches!(character, '=' | '+' | '-' | '@'))
    {
        text.insert(0, '\'');
    }
    format!("\"{}\"", text.replace('"', "\"\""))
}

fn report_csv(result: &Value) -> String {
    let Some(rows) = result.get("items").and_then(Value::as_array) else {
        return format!(
            "total\n{}\n",
            csv_cell(result.get("total").unwrap_or(&Value::Null))
        );
    };
    let Some(first) = rows.first().and_then(Value::as_object) else {
        return "message\n\"Báo cáo không có dòng dữ liệu.\"\n".into();
    };
    let columns = first.keys().collect::<Vec<_>>();
    let mut output = columns
        .iter()
        .map(|column| csv_cell(&json!(column)))
        .collect::<Vec<_>>()
        .join(",");
    output.push('\n');
    for row in rows {
        let Some(row) = row.as_object() else { continue };
        let line = columns
            .iter()
            .map(|column| csv_cell(row.get(*column).unwrap_or(&Value::Null)))
            .collect::<Vec<_>>()
            .join(",");
        if output.len() + line.len() + 1 > 60_000 {
            output.push_str("\n[CSV content truncated at 60 KB]\n");
            break;
        }
        output.push_str(&line);
        output.push('\n');
    }
    output
}

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

async fn audited_schedule_owner(
    tx: &Tx<'_>,
    tenant: &Tenant,
    report_id: Uuid,
    action: &str,
) -> R<Option<String>> {
    let target = format!("bi.report#{report_id}");
    Ok(tx
        .query_opt(
            "SELECT user_id FROM osp_audit WHERE tenant_id=$1 AND target=$2 AND action=$3 ORDER BY seq DESC LIMIT 1 FOR SHARE",
            &[&tenant.id, &target, &action],
        )
        .await?
        .map(|row| row.get(0)))
}

async fn pause_report(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    report_entity: &crate::kernel::Ent,
    report_id: Uuid,
    event_id: Uuid,
    depth: u32,
) -> R<()> {
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            report_entity,
            &report_id.to_string(),
            "paused",
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(())
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
            let owner = audited_schedule_owner(tx, tenant, report_id, "create")
                .await?
                .ok_or_else(|| {
                    ApiError::validation(
                        "bi.report.schedule",
                        vec!["A scheduled report must be created by an active tenant user".into()],
                    )
                })?;
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &report_entity,
                    &report_id.to_string(),
                    Map::from_iter([("schedule_owner".into(), json!(owner))]),
                    &Opts::top(),
                )
                .await?;
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
            let current = kernel
                .get(&Actor::System, tenant, "bi.report", &report_id.to_string())
                .await?;
            let owner = audited_schedule_owner(tx, tenant, report_id, "scheduled")
                .await?
                .or_else(|| {
                    current
                        .get("schedule_owner")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
            let Some(owner) = owner else {
                pause_report(
                    kernel,
                    tx,
                    tenant,
                    &report_entity,
                    report_id,
                    event_id,
                    depth,
                )
                .await?;
                return Ok(true);
            };
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
                    Map::from_iter([
                        ("next_run_at".into(), json!(next.to_rfc3339())),
                        ("schedule_owner".into(), json!(owner)),
                    ]),
                    &Opts::top(),
                )
                .await?;
        }
        "run_due" => {
            let report = kernel
                .get(&Actor::System, tenant, "bi.report", &report_id.to_string())
                .await?;
            let owner_id = report
                .get("schedule_owner")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let owner = if let Some(owner_id) = owner_id {
                tx.query_opt(
                    "SELECT roles,disabled FROM osp_users WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                    &[&tenant.id, &owner_id],
                )
                .await?
            } else {
                None
            };
            let Some(owner) = owner.filter(|row| !row.get::<_, bool>(1)) else {
                pause_report(
                    kernel,
                    tx,
                    tenant,
                    &report_entity,
                    report_id,
                    event_id,
                    depth,
                )
                .await?;
                return Ok(true);
            };
            let actor = Actor::User {
                id: report
                    .get("schedule_owner")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                roles: owner.get(0),
                scopes: None,
            };
            let actor_roles = match &actor {
                Actor::User { roles, .. } => roles,
                Actor::System => unreachable!(),
            };
            let current_roles = tx
                .query(
                    "SELECT id,name,permissions FROM osp_roles WHERE tenant_id=$1 AND id=ANY($2) ORDER BY id FOR SHARE",
                    &[&tenant.id, actor_roles],
                )
                .await?;
            let mut permission_tenant = tenant.clone();
            permission_tenant.roles.clear();
            for role in current_roles {
                permission_tenant.roles.insert(
                    role.get(0),
                    crate::defs::RoleDef {
                        name: role.get(1),
                        permissions: role.get(2),
                    },
                );
            }
            let source = report
                .get("query")
                .and_then(|query| query.get("source"))
                .and_then(Value::as_str)
                .and_then(|source| kernel.ent(tenant, source).ok());
            let has_access = kernel.can(&permission_tenant, &actor, "bi.report.read")
                && source.is_some_and(|source| {
                    kernel.can(
                        &permission_tenant,
                        &actor,
                        &format!("{}.read", source.qname()),
                    )
                });
            if !has_access {
                pause_report(
                    kernel,
                    tx,
                    tenant,
                    &report_entity,
                    report_id,
                    event_id,
                    depth,
                )
                .await?;
                return Ok(true);
            }
            let result = kernel
                .run_bi_report(&actor, &permission_tenant, &report_id.to_string())
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
            let saved_run = kernel
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
            if let Some(recipients) = report.get("email_recipients").and_then(Value::as_array) {
                let run_id = saved_run
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let csv = report_csv(saved_run.get("result").unwrap_or(&Value::Null));
                for recipient in recipients.iter().filter_map(Value::as_str) {
                    let address = recipient.trim();
                    if address.is_empty() {
                        continue;
                    }
                    let mut message = Map::new();
                    message.insert("channel".into(), json!("email"));
                    message.insert("recipient_email".into(), json!(address));
                    message.insert(
                        "subject".into(),
                        json!(format!(
                            "{} — báo cáo định kỳ",
                            report
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("Báo cáo BI")
                        )),
                    );
                    message.insert(
                        "body".into(),
                        json!(format!(
                            "Báo cáo: {}\nThời điểm: {}\nSố dòng: {}\n\nTệp CSV kết quả được đính kèm.",
                            report
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("Báo cáo BI"),
                            saved_run
                                .get("run_at")
                                .and_then(Value::as_str)
                                .unwrap_or(""),
                            saved_run.get("row_count").unwrap_or(&Value::Null)
                        )),
                    );
                    message.insert(
                        "attachment_name".into(),
                        json!(format!("bi-report-{run_id}.csv")),
                    );
                    message.insert(
                        "attachment_content_type".into(),
                        json!("text/csv; charset=utf-8"),
                    );
                    message.insert("attachment_content".into(), json!(csv));
                    let key = format!("bi.report_run:{run_id}:{}", address.to_ascii_lowercase());
                    crate::modules::communication::enqueue_message_with_key(
                        kernel, tx, tenant, message, &key, event_id, depth,
                    )
                    .await?;
                }
            }
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
