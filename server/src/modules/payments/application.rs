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
    let partial_refund = event_type == "payments.payment_refund.succeeded";
    let refund = partial_refund || event_type == "payments.payment_txn.refunded";
    if event_type != "payments.payment_txn.succeeded" && !refund {
        return Ok(false);
    }
    if event_type == "payments.payment_txn.refunded"
        && let Some(payment_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        && tx
            .query_opt(
                "SELECT id FROM payments__payment_refund WHERE tenant_id = $1 AND payment_txn = $2 AND status = 'succeeded' LIMIT 1",
                &[&tenant.id, &payment_id],
            )
            .await?
            .is_some()
    {
        // Refund rows already generated the partial/full accounting reversals.
        return Ok(true);
    }
    let source_id = document.get("id").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Provider payment record requires an id".into()],
        )
    })?;
    let accounting_source = if refund { "payment_refund" } else { "payments" };
    if tx.query_opt(
        "SELECT id FROM accounting__payment WHERE tenant_id = $1 AND source = $2 AND source_id = $3 FOR UPDATE",
        &[&tenant.id, &accounting_source, &source_id.as_str().unwrap_or_default()],
    ).await?.is_some() {
        return Ok(true);
    }
    let original = if partial_refund {
        let refund_id = source_id
            .as_str()
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(event_type, vec!["Refund id is invalid".into()])
            })?;
        let payment_id = document
            .get("payment_txn")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund requires its original payment".into()],
                )
            })?;
        let row = tx.query_opt(
            "SELECT payment.party, payment.amount::text, payment.method, payment.invoice, payment.bill, refund.amount::text, payment.status FROM payments__payment_txn payment JOIN payments__payment_refund refund ON refund.tenant_id = payment.tenant_id AND refund.payment_txn = payment.id WHERE payment.tenant_id = $1 AND payment.id = $2 AND refund.id = $3 FOR UPDATE OF payment, refund",
            &[&tenant.id, &payment_id, &refund_id],
        ).await?.ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Original payment or refund was not found".into()]))?;
        Some((row, refund_id))
    } else {
        None
    };
    let mut payment = Map::new();
    if let Some((row, _)) = original.as_ref() {
        for (field, index) in [
            ("party", 0),
            ("amount", 1),
            ("method", 2),
            ("invoice", 3),
            ("bill", 4),
        ] {
            let value: Option<Value> = match index {
                0 => Some(serde_json::json!(row.get::<_, Uuid>(0))),
                1 => Some(serde_json::json!(row.get::<_, String>(1))),
                2 => row
                    .get::<_, Option<String>>(2)
                    .map(|value| serde_json::json!(value)),
                3 => row
                    .get::<_, Option<Uuid>>(3)
                    .map(|value| serde_json::json!(value)),
                4 => row
                    .get::<_, Option<Uuid>>(4)
                    .map(|value| serde_json::json!(value)),
                _ => None,
            };
            if let Some(value) = value {
                payment.insert(field.into(), value);
            }
        }
    } else {
        for field in ["party", "amount", "method", "invoice", "bill"] {
            if let Some(value) = document.get(field) {
                payment.insert(field.into(), value.clone());
            }
        }
    }
    if refund {
        let amount = if let Some((row, _)) = original.as_ref() {
            money::decimal_str(&row.get::<_, String>(5))
        } else {
            document.get("amount").and_then(money::decimal)
        }
        .filter(|amount| *amount > rust_decimal::Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund requires a positive amount".into()],
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
    if let Some((row, payment_id)) = original {
        let amount = money::decimal_str(&row.get::<_, String>(1)).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Original payment amount is invalid".into()],
            )
        })?;
        let refunded_row = tx.query_one_row(
            "SELECT COALESCE(SUM(amount::numeric), 0)::text FROM payments__payment_refund WHERE tenant_id = $1 AND payment_txn = $2 AND status = 'succeeded'",
            &[&tenant.id, &payment_id],
        ).await?;
        let refunded_text: String = refunded_row.get(0);
        let refunded = money::decimal_str(&refunded_text).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Successful refund total is invalid".into()],
            )
        })?;
        let parent = kernel.ent(tenant, "payments.payment_txn")?;
        if refunded + rust_decimal::Decimal::new(1, 6) >= amount {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &parent,
                    &payment_id.to_string(),
                    "refunded",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        } else if row.get::<_, String>(6) == "succeeded" {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &parent,
                    &payment_id.to_string(),
                    "partially_refunded",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        }
    }
    Ok(true)
}

/// Canonicalize provider references before validation and persistence.
pub async fn prepare_document(
    _tx: &Tx<'_>,
    _tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if matches!(entity, "payment_txn" | "payment_refund")
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
