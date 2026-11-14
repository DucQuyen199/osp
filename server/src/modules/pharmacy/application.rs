//! Pharmacy side effects from a completed point-of-sale transaction.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
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
    if event_type != "pos.pos_order.completed" || !tenant.has_module("pharmacy") {
        return Ok(false);
    }
    let Some(prescription_id) = document
        .get("prescription")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };

    let prescription = kernel.ent(tenant, "pharmacy.prescription")?;
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
            &prescription,
            &prescription_id.to_string(),
            Map::from_iter([(
                "dispensed_at".into(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            )]),
            &opts,
        )
        .await?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &prescription,
            &prescription_id.to_string(),
            "dispensed",
            &opts,
        )
        .await?;
    Ok(true)
}

pub async fn validate_dispense(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if action != "dispensed" {
        return Ok(Vec::new());
    }
    let Some(prescription_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Không xác định được đơn thuốc cần cấp phát".into()]);
    };
    if tx
        .query_opt(
            "SELECT 1 FROM pos__pos_order WHERE tenant_id = $1 AND prescription = $2::text AND status = 'completed' LIMIT 1",
            &[&tenant.id, &prescription_id],
        )
        .await?
        .is_none()
    {
        return Ok(vec![
            "Đơn thuốc chỉ được cấp phát sau giao dịch POS hoàn tất".into(),
        ]);
    }
    if document.get("status").and_then(Value::as_str) != Some("verified") {
        return Ok(vec!["Chỉ cấp phát đơn thuốc đã xác minh".into()]);
    }
    if document
        .get("valid_until")
        .and_then(Value::as_str)
        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        .is_none_or(|date| date < chrono::Utc::now().date_naive())
    {
        return Ok(vec!["Không thể cấp phát đơn thuốc đã hết hạn".into()]);
    }
    let Some(row) = tx
        .query_opt(
            "SELECT status FROM pharmacy__prescription WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &prescription_id],
        )
        .await?
    else {
        return Err(ApiError::not_found(
            "Prescription was not found for this tenant",
        ));
    };
    if row.get::<_, String>(0) != "verified" {
        return Ok(vec![
            "Đơn thuốc đã được cấp phát hoặc không còn hiệu lực".into(),
        ]);
    }
    Ok(Vec::new())
}
