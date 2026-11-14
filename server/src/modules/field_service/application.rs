//! Field-service ticket intake and work-order creation.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::persistence;

/// Rebuild the work-order amount from its server-stored line snapshot.
pub fn prepare_document(document: &mut Map<String, Value>) -> Vec<String> {
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        document.insert("total".into(), Value::from(0));
        return Vec::new();
    };
    let Some(total) = money::sum_line_totals(lines).and_then(money::json_number) else {
        document.remove("total");
        return vec!["Work-order lines have an invalid quantity, price, or total".into()];
    };
    document.insert("total".into(), total);
    Vec::new()
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
    if !tenant.has_module("field-service") {
        return Ok(false);
    }
    if event_type != "helpdesk.ticket.created"
        || document.get("channel").and_then(Value::as_str) != Some("field")
    {
        return Ok(false);
    }
    let Some(party) = document.get("party").filter(|value| !value.is_null()) else {
        return Ok(false);
    };
    let Some(ticket) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    if persistence::existing_ticket_work_order(tx, tenant, ticket).await? {
        return Ok(true);
    }

    let mut data = Map::new();
    data.insert("party".into(), party.clone());
    data.insert("source_ticket".into(), Value::String(ticket.to_string()));
    if let Some(subject) = document.get("subject") {
        data.insert("title".into(), subject.clone());
    }
    let entity = kernel.ent(tenant, "field-service.work_order")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
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
