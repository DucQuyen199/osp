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
    if tenant.has_module("budget")
        && crate::modules::budget::handle_source_event(
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
            "module": "budget",
            "rule": "approved_adjustment_supersedes_previous_budget",
            "outcome": "ok"
        }));
    }
    if tenant.has_module("subscription")
        && crate::modules::subscription::handle_source_event(
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
            "module": "subscription",
            "rule": "billing_cycle_renewal_and_cancellation",
            "outcome": "ok"
        }));
    }
    if tenant.has_module("charity")
        && crate::modules::charity::handle_source_event(
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
            "module": "charity",
            "rule": "approved_beneficiary_disbursement_to_accounting_payment",
            "outcome": "ok"
        }));
    }
    let is_purchase_receipt = event.ty == "purchasing.purchase_receipt.received";
    if !is_purchase_receipt
        && crate::modules::purchasing::handle_source_event(
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
            "module": "purchasing",
            "rule": "purchase_receipt_to_order_progress",
            "outcome": "ok"
        }));
    }
    // An approved internal requisition becomes a draft purchase order in
    // the same PostgreSQL transaction and keeps a traceable source link.
    if event.ty == "purchasing.purchase_requisition.approved"
        && event.payload.get("sourcing_method").and_then(Value::as_str) != Some("competitive")
    {
        crate::modules::purchasing::create_order_from_requisition(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?;
        handled.push(json!({
            "module": "purchasing",
            "rule": "purchase_requisition_to_purchase_order",
            "outcome": "ok"
        }));
    } else if event.ty == "purchasing.rfq.accepted" {
        crate::modules::purchasing::create_order_from_rfq(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?;
        handled.push(json!({
            "module": "purchasing",
            "rule": "rfq_to_purchase_order",
            "outcome": "ok"
        }));
    } else if event.ty == "logistics.shipment.delivered"
        && event.payload.get("source").and_then(Value::as_str) == Some("sales_order")
    {
        if crate::modules::inventory::handle_source_stock_event(
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
            handled.push(json!({ "module": "inventory", "rule": "delivered_shipment_to_stock_issue", "outcome": "ok" }));
        }
        if crate::modules::sales::handle_source_event(
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
            handled.push(json!({ "module": "sales", "rule": "complete_order_after_all_shipments", "outcome": "ok" }));
        }
    } else if event.ty == "inventory.stock_move.created" {
        crate::modules::inventory::apply_stock_move(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?;
        handled.push(json!({
            "module": "inventory",
            "rule": "stock_move_to_stock_level",
            "outcome": "ok"
        }));
        if crate::modules::accounting::post_stock_movement(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?
        {
            handled.push(json!({
                "module": "accounting",
                "rule": "stock_move_to_valuation_journal",
                "outcome": "ok"
            }));
        }
    } else if crate::modules::inventory::handle_transfer_or_count_event(
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
            "module": "inventory",
            "rule": "transfer_or_count_to_stock_move",
            "outcome": "ok"
        }));
    } else if crate::modules::inventory::handle_source_stock_event(
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
            "module": "inventory",
            "rule": "operational_source_to_stock_move",
            "outcome": "ok"
        }));
        // Receive and value the stock before advancing the purchase order. If
        // this completes the order, its bill can clear the GRNI journals that
        // were just posted by the stock-move events.
        if is_purchase_receipt
            && crate::modules::purchasing::handle_source_event(
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
                "module": "purchasing",
                "rule": "purchase_receipt_to_order_progress",
                "outcome": "ok"
            }));
        }
    } else if crate::modules::sales::handle_source_event(
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
            "module": "sales",
            "rule": "sales_source_event_workflow",
            "outcome": "ok"
        }));
    }
    if event.ty == "manufacturing.production_order.done"
        && crate::modules::accounting::post_abnormal_scrap_cost(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?
    {
        handled.push(json!({
            "module": "accounting",
            "rule": "production_scrap_to_expense",
            "outcome": "ok"
        }));
    }
    if event.ty == "manufacturing.production_disposition.posted"
        && crate::modules::accounting::post_production_qc_scrap_cost(
            kernel,
            tx,
            tenant,
            &event.payload,
            event.id,
            event.depth,
        )
        .await?
    {
        handled.push(json!({
            "module": "accounting",
            "rule": "production_qc_scrap_to_expense",
            "outcome": "ok"
        }));
    }
    Ok(())
}
