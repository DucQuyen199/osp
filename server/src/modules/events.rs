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
    if event.ty == "accounting.bill.posted"
        && crate::modules::inventory::apply_landed_costs(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?
    {
        handled.push(serde_json::json!({
            "module": "inventory",
            "rule": "supplier_bill_landed_cost_to_inventory_valuation",
            "outcome": "ok"
        }));
    }
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
            "rule": match event.ty.as_str() {
                "construction.material_request.created" => "boq_materials_create_purchase_requisition",
                _ => "approved_boq_supersedes_previous_baseline",
            },
            "outcome": "ok"
        }));
    }
    if crate::modules::school::handle_source_event(
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
            "module": "school",
            "rule": "tuition_batch_generates_missing_student_fees",
            "outcome": "ok"
        }));
    }
    if crate::modules::clinic::handle_source_event(
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
            "module": "clinic",
            "rule": "appointment-checkin-and-encounter-lifecycle",
            "outcome": "ok"
        }));
    }
    Ok(())
}
