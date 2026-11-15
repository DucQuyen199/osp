//! Scheduled maintenance-plan execution and completion synchronization.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    match event_type {
        "maintenance.maintenance_plan.due" => {
            let plan_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or_else(|| {
                    ApiError::validation(event_type, vec!["Kế hoạch bảo trì cần id hợp lệ".into()])
                })?;
            let row = tx
                .query_opt(
                    "SELECT asset, title, next_due, status FROM maintenance__maintenance_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &plan_id],
                )
                .await?;
            let Some(row) = row else {
                return Err(ApiError::not_found(
                    "Không tìm thấy kế hoạch bảo trì trong doanh nghiệp",
                ));
            };
            let asset: Uuid = row.get(0);
            let title: String = row.get(1);
            let due: Option<NaiveDate> = row.get(2);
            let status: String = row.get(3);
            let today: NaiveDate = tenant.business_today();
            if status != "active" {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Chỉ kế hoạch bảo trì đang hoạt động mới được chạy".into()],
                ));
            }
            let Some(due) = due.filter(|due| *due <= today) else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Kế hoạch bảo trì chưa đến hạn hoặc thiếu ngày đến hạn".into()],
                ));
            };
            let existing = tx
                .query_opt(
                    "SELECT id FROM maintenance__maintenance_request WHERE tenant_id = $1 AND source_plan = $2 AND scheduled_for = $3 AND status IN ('open', 'in_progress') LIMIT 1",
                    &[&tenant.id, &plan_id, &due],
                )
                .await?;
            if existing.is_none() {
                let request = kernel.ent(tenant, "maintenance.maintenance_request")?;
                kernel
                    .create_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &request,
                        serde_json::Map::from_iter([
                            ("asset".into(), json!(asset)),
                            ("source_plan".into(), json!(plan_id)),
                            ("scheduled_for".into(), json!(due)),
                            (
                                "description".into(),
                                json!(format!("Kế hoạch bảo trì: {title}")),
                            ),
                            ("priority".into(), json!("normal")),
                        ]),
                        &opts,
                    )
                    .await?;
            }
            Ok(true)
        }
        "maintenance.maintenance_request.done" => {
            let Some(plan_id) = document
                .get("source_plan")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(false);
            };
            let plan_row = tx.query_opt(
                "SELECT interval_days::text FROM maintenance__maintenance_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &plan_id],
            ).await?.ok_or_else(|| ApiError::validation(event_type, vec!["Kế hoạch bảo trì nguồn không còn tồn tại".into()]))?;
            let interval_text: String = plan_row.get(0);
            let interval = money::decimal_str(&interval_text)
                .filter(|days| *days >= Decimal::ONE && days.fract().is_zero())
                .and_then(|days| days.trunc().to_string().parse::<i64>().ok())
                .ok_or_else(|| {
                    ApiError::validation(event_type, vec!["Chu kỳ bảo trì không hợp lệ".into()])
                })?;
            let today: NaiveDate = tenant.business_today();
            let interval_days = Duration::try_days(interval).ok_or_else(|| {
                ApiError::validation(event_type, vec!["Chu kỳ bảo trì vượt giới hạn ngày".into()])
            })?;
            let next_due = today.checked_add_signed(interval_days).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Ngày bảo trì kế tiếp vượt giới hạn".into()],
                )
            })?;
            let plan = kernel.ent(tenant, "maintenance.maintenance_plan")?;
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &plan,
                    &plan_id.to_string(),
                    serde_json::Map::from_iter([
                        ("last_completed".into(), json!(today)),
                        ("next_due".into(), json!(next_due)),
                    ]),
                    &opts,
                )
                .await?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
