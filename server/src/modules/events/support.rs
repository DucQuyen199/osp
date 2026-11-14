use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant, rules::Event},
};
use serde_json::{Value, json};

#[async_recursion::async_recursion]
pub(super) async fn dispatch(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Event,
    handled: &mut Vec<Value>,
) -> R<()> {
    if crate::modules::quality::handle_source_event(
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
        handled.push(json!({
            "module": "quality",
            "rule": "quality_source_event_workflow",
            "outcome": "ok"
        }));
    }
    if crate::modules::recruitment::handle_source_event(
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
        handled.push(json!({
            "module": "recruitment",
            "rule": "hired_application_to_employee",
            "outcome": "ok"
        }));
    }
    if crate::modules::asset::handle_source_event(
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
        handled.push(json!({
            "module": "asset",
            "rule": "fixed_asset_accounting_workflow",
            "outcome": "ok"
        }));
    }
    if crate::modules::contract::handle_source_event(
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
        handled.push(json!({
            "module": "contract",
            "rule": "lease_to_contract",
            "outcome": "ok"
        }));
    }
    if crate::modules::real_estate::handle_source_event(
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
        handled.push(json!({
            "module": "real-estate",
            "rule": "lease_to_property_status",
            "outcome": "ok"
        }));
    }
    if crate::modules::hotel::handle_source_event(
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
        handled.push(json!({
            "module": "hotel",
            "rule": "folio_and_room_state_workflow",
            "outcome": "ok"
        }));
    }
    if crate::modules::loyalty::handle_source_event(
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
        handled.push(json!({
            "module": "loyalty",
            "rule": "point_accrual_and_reversal",
            "outcome": "ok"
        }));
    }
    if crate::modules::communication::handle_source_event(
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
        handled.push(json!({
            "module": "communication",
            "rule": "source_event_to_message_queue",
            "outcome": "ok"
        }));
    }
    if crate::modules::workflow_approval::handle_source_event(
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
        handled.push(json!({
            "module": "workflow-approval",
            "rule": "approval_request_lifecycle_and_dispatch",
            "outcome": "ok"
        }));
    }
    Ok(())
}
