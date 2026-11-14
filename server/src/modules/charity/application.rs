//! Normalize donation program and receipt input.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    let fields: &[&str] = match entity {
        "program" => &["name"],
        "donation" => &["note"],
        "disbursement" => &["purpose"],
        _ => &[],
    };
    for field in fields {
        if let Some(value) = document.get(*field).and_then(Value::as_str) {
            document.insert((*field).into(), Value::String(value.trim().to_owned()));
        }
    }
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
    if !tenant.has_module("charity") || event_type != "charity.disbursement.paid" {
        return Ok(false);
    }
    let disbursement_id = event
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Paid disbursement requires a valid id".into()],
            )
        })?;
    let source = super::persistence::load_payment_source(tx, tenant, disbursement_id).await?;
    let super::persistence::PaymentSourceState::Ready {
        amount,
        method,
        expense_account,
        party,
    } = source
    else {
        return Ok(true);
    };
    let mut data = Map::new();
    data.insert("party".into(), json!(party));
    let amount_value = money::json_number(amount).ok_or_else(|| {
        ApiError::validation(
            event_type,
            vec!["Disbursement amount exceeds the supported decimal range".into()],
        )
    })?;
    data.insert("amount".into(), amount_value);
    data.insert("method".into(), json!(method));
    data.insert("expense_account".into(), json!(expense_account));
    data.insert(
        "payment_date".into(),
        json!(chrono::Utc::now().date_naive()),
    );
    data.insert("source".into(), json!("charity_disbursement"));
    data.insert("source_id".into(), json!(disbursement_id));
    let payment = kernel.ent(tenant, "accounting.payment")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &payment,
            data,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
