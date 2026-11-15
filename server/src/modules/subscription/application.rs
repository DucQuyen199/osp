use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn optional_decimal_column(
    row: &tokio_postgres::Row,
    column: usize,
    field: &str,
) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                ApiError::validation(
                    "subscription",
                    vec![format!(
                        "Stored subscription {field} is not a valid decimal"
                    )],
                )
            })
        })
        .transpose()
}

fn interval_months(interval: &str) -> Option<u32> {
    match interval {
        "monthly" => Some(1),
        "quarterly" => Some(3),
        "yearly" => Some(12),
        _ => None,
    }
}

fn next_anchored_date(anchor: NaiveDate, previous: NaiveDate, months: u32) -> Option<NaiveDate> {
    let month_index = previous.year() * 12 + previous.month0() as i32 + months as i32;
    let year = month_index.div_euclid(12);
    let month = (month_index.rem_euclid(12) + 1) as u32;
    (1..=anchor.day())
        .rev()
        .find_map(|day| NaiveDate::from_ymd_opt(year, month, day))
}

async fn schedule_cycle(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    subscription_id: Uuid,
    base_date: Option<NaiveDate>,
    reinstate_cancelled: bool,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let Some(row) = tx
        .query_opt(
            "SELECT s.status, s.party, s.start, p.price::text, p.interval FROM subscription__subscription s JOIN subscription__plan p ON p.tenant_id = s.tenant_id AND p.id = s.plan WHERE s.tenant_id = $1 AND s.id = $2 FOR UPDATE OF s, p",
            &[&tenant.id, &subscription_id],
        )
        .await?
    else {
        return Err(ApiError::not_found("Subscription was not found for this tenant"));
    };
    let status: String = row.get(0);
    if status != "active" {
        return Ok(true);
    }
    let party: Uuid = row.get(1);
    let start: Option<NaiveDate> = row.get(2);
    let price = optional_decimal_column(&row, 3, "plan price")?;
    let interval: Option<String> = row.get(4);
    let Some(months) = interval.as_deref().and_then(interval_months) else {
        return Err(ApiError::validation(
            "subscription",
            vec!["Active subscription plan needs a supported billing interval".into()],
        ));
    };
    let Some(amount) = price.filter(|amount| *amount > Decimal::ZERO) else {
        return Ok(true);
    };
    let today: NaiveDate = tenant.business_today();
    let anchor = start.or(base_date).unwrap_or(today);
    let due_date = match base_date {
        Some(previous) => next_anchored_date(anchor, previous, months).ok_or_else(|| {
            ApiError::validation(
                "subscription",
                vec!["Next billing date exceeds the supported calendar range".into()],
            )
        })?,
        None => start.unwrap_or(today),
    };
    if let Some(existing) = tx
        .query_opt(
            "SELECT id, status FROM subscription__billing_cycle WHERE tenant_id = $1 AND subscription = $2 AND due_date = $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &subscription_id, &due_date],
        )
        .await?
    {
        if reinstate_cancelled && existing.get::<_, String>(1) == "cancelled" {
            let cycle_id: Uuid = existing.get(0);
            let entity = kernel.ent(tenant, "subscription.billing_cycle")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &cycle_id.to_string(),
                    "reinstated",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        }
        return Ok(true);
    }
    let entity = kernel.ent(tenant, "subscription.billing_cycle")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            Map::from_iter([
                ("subscription".into(), json!(subscription_id)),
                ("party".into(), json!(party)),
                (
                    "amount".into(),
                    money::json_number(amount).ok_or_else(|| {
                        ApiError::validation(
                            "subscription",
                            vec!["Billing amount exceeds the supported decimal range".into()],
                        )
                    })?,
                ),
                ("due_date".into(), json!(due_date)),
            ]),
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

async fn cancel_pending_cycles(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    subscription_id: Uuid,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let rows = tx
        .query(
            "SELECT id FROM subscription__billing_cycle WHERE tenant_id = $1 AND subscription = $2 AND status = 'pending' FOR UPDATE",
            &[&tenant.id, &subscription_id],
        )
        .await?;
    let entity = kernel.ent(tenant, "subscription.billing_cycle")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    for row in rows {
        let id: Uuid = row.get(0);
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id.to_string(),
                "cancelled",
                &opts,
            )
            .await?;
    }
    Ok(true)
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let subscription_id = |value: &Value| {
        value
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
    };
    match event_type {
        "subscription.subscription.created" => {
            let Some(id) = subscription_id(document) else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Subscription event requires a valid id".into()],
                ));
            };
            schedule_cycle(kernel, tx, tenant, id, None, false, event_id, depth).await
        }
        "subscription.subscription.resumed" => {
            let Some(id) = subscription_id(document) else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Subscription event requires a valid id".into()],
                ));
            };
            let last_paid: Option<NaiveDate> = tx
                .query_opt(
                    "SELECT MAX(due_date) FROM subscription__billing_cycle WHERE tenant_id = $1 AND subscription = $2 AND status = 'paid'",
                    &[&tenant.id, &id],
                )
                .await?
                .map(|row| row.get(0));
            schedule_cycle(kernel, tx, tenant, id, last_paid, true, event_id, depth).await
        }
        "subscription.subscription.paused" | "subscription.subscription.cancelled" => {
            let Some(id) = subscription_id(document) else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Subscription event requires a valid id".into()],
                ));
            };
            cancel_pending_cycles(kernel, tx, tenant, id, event_id, depth).await
        }
        "subscription.billing_cycle.paid" => {
            let Some(cycle_id) = subscription_id(document) else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Billing cycle event requires a valid id".into()],
                ));
            };
            let row = tx
                .query_opt(
                    "SELECT subscription, due_date FROM subscription__billing_cycle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &cycle_id],
                )
                .await?;
            let Some(row) = row else {
                return Err(ApiError::not_found(
                    "Billing cycle was not found for this tenant",
                ));
            };
            let subscription_id: Uuid = row.get(0);
            let due_date: Option<NaiveDate> = row.get(1);
            let Some(due_date) = due_date else {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Paid billing cycle needs a due date to renew".into()],
                ));
            };
            schedule_cycle(
                kernel,
                tx,
                tenant,
                subscription_id,
                Some(due_date),
                false,
                event_id,
                depth,
            )
            .await
        }
        _ => Ok(false),
    }
}

/// Snapshot the active subscription's customer and current plan price on a new cycle.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "subscription"
        && document.get("id").is_none()
        && document
            .get("start")
            .is_none_or(|value| value.is_null() || value.as_str().is_some_and(str::is_empty))
    {
        let start: NaiveDate = tenant.business_today();
        document.insert("start".into(), json!(start));
        return Ok(Vec::new());
    }
    if entity != "billing_cycle" {
        return Ok(Vec::new());
    }
    let Some(subscription_id) = document
        .get("subscription")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(Vec::new());
    };
    let row = tx
        .query_opt(
            "SELECT s.party, s.status, p.price::text FROM subscription__subscription s JOIN subscription__plan p ON p.tenant_id = s.tenant_id AND p.id = s.plan WHERE s.tenant_id = $1 AND s.id = $2 FOR SHARE OF s, p",
            &[&tenant.id, &subscription_id],
        )
        .await?;
    let Some(row) = row else {
        return Ok(vec![
            "Không tìm thấy thuê bao và gói dịch vụ trong doanh nghiệp".into(),
        ]);
    };
    let status: String = row.get(1);
    let amount = optional_decimal_column(&row, 2, "plan price")?;
    if status != "active" {
        return Ok(vec![
            "Chỉ tạo kỳ thu phí cho thuê bao đang hoạt động".into(),
        ]);
    }
    let Some(amount) = amount.filter(|value| *value > Decimal::ZERO) else {
        return Ok(vec![
            "Gói thuê bao cần có mức phí lớn hơn 0 trước khi lập kỳ thu".into(),
        ]);
    };
    document.insert("party".into(), json!(row.get::<_, Uuid>(0).to_string()));
    document.insert(
        "amount".into(),
        money::json_number(amount).ok_or_else(|| {
            ApiError::validation(
                "subscription",
                vec!["Billing amount exceeds the supported decimal range".into()],
            )
        })?,
    );
    Ok(Vec::new())
}
