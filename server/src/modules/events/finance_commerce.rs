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
    if crate::modules::accounting::handle_source_document_event(
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
            "module": "accounting",
            "rule": "source_document_to_financial_record",
            "outcome": "ok"
        }));
    }
    if crate::modules::accounting::handle_ledger_event(
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
            "module": "accounting",
            "rule": "return_adjustment_and_ledger_posting",
            "outcome": "ok"
        }));
    }
    if crate::modules::logistics::handle_source_event(
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
            "module": "logistics",
            "rule": "confirmed_order_to_shipment",
            "outcome": "ok"
        }));
    }
    if crate::modules::lending::handle_source_event(
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
            "module": "lending",
            "rule": "loan_disbursement_to_repayment_schedule",
            "outcome": "ok"
        }));
    }
    if crate::modules::restaurant::handle_source_event(
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
            "module": "restaurant",
            "rule": "sent_order_to_kitchen_ticket",
            "outcome": "ok"
        }));
    }
    if crate::modules::payroll::handle_source_event(
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
            "module": "payroll",
            "rule": "payslip_to_payroll_total",
            "outcome": "ok"
        }));
    }
    if crate::modules::crm::handle_source_event(
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
            "module": "crm",
            "rule": "lead_to_customer_conversion",
            "outcome": "ok"
        }));
    }
    if crate::modules::ecommerce::handle_source_event(
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
            "module": "ecommerce",
            "rule": "web_order_to_priced_sales_order",
            "outcome": "ok"
        }));
    }
    if crate::modules::einvoice::handle_source_event(
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
            "module": "einvoice",
            "rule": "posted_invoice_to_einvoice_request",
            "outcome": "ok"
        }));
    }
    if crate::modules::field_service::handle_source_event(
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
            "module": "field-service",
            "rule": "field_ticket_to_work_order",
            "outcome": "ok"
        }));
    }
    if crate::modules::lms::handle_source_event(
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
            "module": "lms",
            "rule": "lesson_progress_updates_enrollment",
            "outcome": "ok"
        }));
    }
    if crate::modules::maintenance::handle_source_event(
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
            "module": "maintenance",
            "rule": "scheduled_plan_to_work_order",
            "outcome": "ok"
        }));
    }
    if crate::modules::payments::handle_source_event(
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
            "module": "payments",
            "rule": "succeeded_transaction_to_accounting_payment",
            "outcome": "ok"
        }));
    }

    Ok(())
}
