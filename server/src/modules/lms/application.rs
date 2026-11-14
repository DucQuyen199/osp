//! Normalize learning records and initialize enrollment progress.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "course" => &["title"],
        "lesson" => &["title"],
        _ => &[],
    };
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() {
                errors.push(format!("{field} cannot be empty"));
            }
        }
    }
    if entity == "lesson" && !document.contains_key("required") {
        document.insert("required".into(), json!(true));
    }
    if entity == "enrollment" && !document.contains_key("progress") {
        document.insert("progress".into(), Value::from(0));
    }
    errors
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
    if !tenant.has_module("lms") || event_type != "lms.lesson_progress.created" {
        return Ok(false);
    }
    let Some(enrollment) = document
        .get("enrollment")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(ApiError::validation(
            event_type,
            vec!["Lesson progress requires a valid enrollment id".into()],
        ));
    };
    let row = tx
        .query_opt(
            "SELECT course, status FROM lms__enrollment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &enrollment],
        )
        .await?
        .ok_or_else(|| {
            ApiError::validation(
                event_type,
                vec!["Enrollment was not found for this tenant".into()],
            )
        })?;
    let course: Uuid = row.get(0);
    let status: String = row.get(1);
    if status != "active" {
        return Ok(true);
    }
    let counts = tx
        .query_one_row(
            "SELECT count(*) FILTER (WHERE COALESCE(l.required, true)), count(*) FILTER (WHERE COALESCE(l.required, true) AND p.id IS NOT NULL) FROM lms__lesson l LEFT JOIN lms__lesson_progress p ON p.tenant_id = l.tenant_id AND p.lesson = l.id AND p.enrollment = $2 WHERE l.tenant_id = $1 AND l.course = $3",
            &[&tenant.id, &enrollment, &course],
        )
        .await?;
    let required: i64 = counts.get(0);
    let completed: i64 = counts.get(1);
    let progress = if required > 0 {
        Decimal::from(completed)
            .checked_mul(Decimal::ONE_HUNDRED)
            .and_then(|value| value.checked_div(Decimal::from(required)))
            .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    let completed_all = progress >= Decimal::ONE_HUNDRED;
    let progress = money::json_number(progress).ok_or_else(|| {
        ApiError::validation(
            event_type,
            vec!["Enrollment progress exceeds Decimal range".into()],
        )
    })?;
    let entity = kernel.ent(tenant, "lms.enrollment")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &enrollment.to_string(),
            Map::from_iter([("progress".into(), progress)]),
            &opts,
        )
        .await?;
    if completed_all {
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &enrollment.to_string(),
                "completed",
                &opts,
            )
            .await?;
    }
    Ok(true)
}
