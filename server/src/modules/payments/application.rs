use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
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
    let refund = match event_type {
        "payments.payment_txn.succeeded" => false,
        "payments.payment_txn.refunded" => true,
        _ => return Ok(false),
    };
    let source_id = document.get("id").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Provider transaction requires an id".into()],
        )
    })?;
    let accounting_source = if refund { "payment_refund" } else { "payments" };
    if tx.query_opt(
        "SELECT id FROM accounting__payment WHERE tenant_id = $1 AND source = $2 AND source_id = $3 FOR UPDATE",
        &[&tenant.id, &accounting_source, &source_id.as_str().unwrap_or_default()],
    ).await?.is_some() {
        return Ok(true);
    }
    let mut payment = Map::new();
    for field in ["party", "amount", "method", "invoice", "bill"] {
        if let Some(value) = document.get(field) {
            payment.insert(field.into(), value.clone());
        }
    }
    if refund {
        let amount = document
            .get("amount")
            .and_then(money::decimal)
            .filter(|amount| *amount > rust_decimal::Decimal::ZERO)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund requires a positive original amount".into()],
                )
            })?;
        let refund_amount = amount
            .checked_mul(rust_decimal::Decimal::NEGATIVE_ONE)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund amount exceeds the supported decimal range".into()],
                )
            })?;
        let refund_amount = money::json_number(refund_amount).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund amount exceeds the supported decimal range".into()],
            )
        })?;
        payment.insert("amount".into(), refund_amount);
    }
    payment.insert("source".into(), Value::String(accounting_source.into()));
    payment.insert("source_id".into(), source_id);
    let entity = kernel.ent(tenant, "accounting.payment")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            payment,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

/// Canonicalize provider references before validation and persistence.
pub async fn prepare_document(
    _tx: &Tx<'_>,
    _tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "payment_txn"
        && let Some(Value::String(reference)) = document.get_mut("reference")
    {
        let canonical = reference.trim().to_string();
        if canonical.is_empty() {
            document.remove("reference");
        } else {
            *reference = canonical;
        }
    }
    if entity == "payment_txn" && !document.contains_key("method") {
        let method = match document.get("provider").and_then(Value::as_str) {
            Some("stripe") => Some("card"),
            Some("bank") => Some("bank"),
            Some("vnpay" | "momo" | "zalopay") => Some("ewallet"),
            _ => None,
        };
        if let Some(method) = method {
            document.insert("method".into(), Value::String(method.into()));
        }
    }
    Ok(Vec::new())
}
