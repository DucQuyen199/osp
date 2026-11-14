//! Composition root for cross-context event workflows; business rules live in focused handlers.
mod finance_commerce;
mod inventory_orders;
mod support;

use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant, rules::Event},
};
use serde_json::Value;

#[async_recursion::async_recursion]
pub async fn dispatch_source_events(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Event,
    handled: &mut Vec<Value>,
) -> R<()> {
    inventory_orders::dispatch(kernel, tx, tenant, event, handled).await?;
    support::dispatch(kernel, tx, tenant, event, handled).await?;
    finance_commerce::dispatch(kernel, tx, tenant, event, handled).await?;
    if crate::modules::bi::handle_source_event(
        kernel,
        tx,
        tenant,
        &event.ty,
        &event.payload,
        event.id,
        event.depth,
    )
    .await?
    {
        handled.push(serde_json::json!({
            "module": "bi",
            "rule": "scheduled_report_snapshot",
            "outcome": "ok"
        }));
    }
    if crate::modules::construction::handle_source_event(
        kernel,
        tx,
        tenant,
        &event.ty,
        &event.payload,
        event.id,
        event.depth,
    )
    .await?
    {
        handled.push(serde_json::json!({
            "module": "construction",
            "rule": "approved_boq_supersedes_previous_baseline",
            "outcome": "ok"
        }));
    }
    Ok(())
}
