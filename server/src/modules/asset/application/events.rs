//! Idempotent accounting reactions to fixed-asset lifecycle events.
mod capitalization;
mod depreciation;
mod disposal;

use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant},
};
use serde_json::Value;
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
    match event_type {
        "asset.asset.activated" | "asset.asset.opening_balance_recorded" => {
            capitalization::handle(kernel, tx, tenant, event_type, document, event_id, depth).await
        }
        "asset.asset.disposed" => {
            disposal::handle(kernel, tx, tenant, event_type, document, event_id, depth).await
        }
        "asset.depreciation.posted" => {
            depreciation::handle(kernel, tx, tenant, event_type, document, event_id, depth).await
        }
        _ => Ok(false),
    }
}
