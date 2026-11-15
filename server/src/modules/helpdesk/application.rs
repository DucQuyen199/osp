//! Normalize support tickets, SLA policies, and knowledge-base content.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "ticket" => &[
            "subject",
            "channel",
            "assignee",
            "description",
            "resolution",
        ],
        "message" => &["author", "body"],
        "sla_policy" => &["name"],
        "kb_article" => &["title", "body"],
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
            if value.is_empty() && matches!(*field, "subject" | "name" | "title") {
                errors.push(format!("{field} cannot be empty"));
            }
        }
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
    if !tenant.has_module("helpdesk") || event_type != "helpdesk.message.created" {
        return Ok(false);
    }
    let Some(ticket_id) = document
        .get("ticket")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    let id = ticket_id.to_string();
    let Some(ticket) = kernel.get_row(tx, tenant, "helpdesk.ticket", &id).await? else {
        return Ok(false);
    };
    let status = ticket
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let direction = document.get("direction").and_then(Value::as_str);
    let action = match (direction, status) {
        (Some("outbound"), "open") => Some("responded"),
        (Some("inbound"), "resolved" | "closed") => Some("reopened"),
        _ => None,
    };
    if let Some(action) = action {
        let entity = kernel.ent(tenant, "helpdesk.ticket")?;
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id,
                action,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
    }
    Ok(true)
}
