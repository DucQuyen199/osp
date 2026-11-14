use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

use super::{domain, persistence};

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("communication") {
        return Ok(false);
    }
    let Some(message) = domain::message_for(event_type, document) else {
        return Ok(false);
    };
    persistence::enqueue_message(kernel, tx, tenant, message, event_id, depth).await?;
    Ok(true)
}
