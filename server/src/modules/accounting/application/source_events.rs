//! Application adapter that turns source-module events into accounting documents.
use super::source_documents::{self, Method, Target};
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn handle_source_document_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type == "sales.sales_order.confirmed"
        && tenant.has_module("logistics")
        && event
            .get("shipping_address")
            .and_then(Value::as_str)
            .is_some_and(|address| !address.trim().is_empty())
    {
        // The order is only a commitment to sell; recognize receivables when
        // the complete shipment has been delivered successfully.
        return Ok(true);
    }
    let Some(spec) = source_documents::source_document(event_type) else {
        return Ok(false);
    };
    if !source_documents::qualifies(&spec, event) {
        return Ok(true);
    }
    let source_id = (if event_type == "purchasing.supplier_invoice.approved" {
        event.get("purchase_order").cloned()
    } else {
        event.get("id").cloned()
    })
    .ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Accounting source document requires an id".into()],
        )
    })?;
    let mut data = Map::new();
    if let Some(value) = event.get(spec.amount).filter(|value| !value.is_null()) {
        let field = match spec.target {
            Target::Invoice | Target::Bill => "total",
            Target::Payment => "amount",
        };
        data.insert(field.into(), value.clone());
    }
    if matches!(
        event_type,
        "subscription.billing_cycle.due" | "real-estate.rent_cycle.created"
    ) && let Some(due_date) = event.get("due_date").filter(|value| !value.is_null())
    {
        data.insert("issue_date".into(), due_date.clone());
        if event_type == "real-estate.rent_cycle.created" {
            data.insert("due_date".into(), due_date.clone());
        }
    }
    if event_type == "school.fee.issued"
        && let Some(due_date) = event.get("due_date").filter(|value| !value.is_null())
    {
        data.insert("due_date".into(), due_date.clone());
    }
    if let Some(field) = spec.party
        && let Some(value) = event.get(field).filter(|value| !value.is_null())
    {
        data.insert("party".into(), value.clone());
    }
    if let Some(field) = spec.supplier
        && let Some(value) = event.get(field).filter(|value| !value.is_null())
    {
        data.insert("supplier".into(), value.clone());
    }
    if let Some(Method::Field(field)) = spec.method
        && let Some(value) = event.get(field).filter(|value| !value.is_null())
    {
        data.insert("method".into(), value.clone());
    }
    if matches!(spec.target, Target::Payment) {
        if let Some(payment_date) = event.get("payment_date").filter(|value| !value.is_null()) {
            data.insert("payment_date".into(), payment_date.clone());
        }
        if event_type == "events.ticket.sold" {
            for field in ["tax_rate", "tax_name", "tax_amount"] {
                if let Some(value) = event.get(field).filter(|value| !value.is_null()) {
                    data.insert(field.into(), value.clone());
                }
            }
        }
        if event_type == "pos.pos_order.completed"
            && let Some(value) = event.get("tax_total").filter(|value| !value.is_null())
        {
            data.insert("tax_amount".into(), value.clone());
        }
    }
    data.insert("source".into(), Value::String(spec.source.into()));
    data.insert("source_id".into(), source_id.clone());
    if matches!(
        event_type,
        "sales.sales_order.confirmed"
            | "sales.sales_order.delivered"
            | "purchasing.supplier_invoice.approved"
    ) {
        for field in ["tax_total", "lines"] {
            if let Some(value) = event.get(field).filter(|value| !value.is_null()) {
                data.insert(field.into(), value.clone());
            }
        }
    }
    if event_type == "purchasing.supplier_invoice.approved" {
        if let Some(value) = event.get("id").filter(|value| !value.is_null()) {
            data.insert("supplier_invoice_id".into(), value.clone());
        }
        for (source, target) in [
            ("invoice_number", "supplier_invoice_number"),
            ("issue_date", "issue_date"),
            ("due_date", "due_date"),
        ] {
            if let Some(value) = event.get(source).filter(|value| !value.is_null()) {
                data.insert(target.into(), value.clone());
            }
        }
        if let Some(value) = event.get("department").filter(|value| !value.is_null()) {
            data.insert("department".into(), value.clone());
        }
        if let Some(value) = event.get("matched_net").filter(|value| !value.is_null()) {
            data.insert("grni_match_amount".into(), value.clone());
        }
        for field in [
            "currency",
            "exchange_rate",
            "exchange_rate_date",
            "base_total",
            "base_tax_total",
        ] {
            if let Some(value) = event.get(field).filter(|value| !value.is_null()) {
                data.insert(field.into(), value.clone());
            }
        }
        if let Some(value) = event.get("adjustments").filter(|value| !value.is_null()) {
            data.insert("purchase_adjustments".into(), value.clone());
        }
    }
    if event_type == "purchasing.purchase_order.received"
        && let Some(department) = event.get("department").filter(|value| !value.is_null())
    {
        data.insert("department".into(), department.clone());
    }
    if event_type == "lending.repayment.paid" {
        for field in ["principal_component", "interest_component"] {
            if let Some(value) = event.get(field).filter(|value| !value.is_null()) {
                data.insert(field.into(), value.clone());
            }
        }
    }
    let (qname, table) = match spec.target {
        Target::Invoice => ("accounting.invoice", "accounting__invoice"),
        Target::Bill => ("accounting.bill", "accounting__bill"),
        Target::Payment => ("accounting.payment", "accounting__payment"),
    };
    let entity = kernel.ent(tenant, qname)?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let source_key = source_id.as_str().unwrap_or_default();
    if spec.post {
        let existing = if event_type == "purchasing.supplier_invoice.approved" {
            let invoice_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            tx.query_opt(
                &format!("SELECT id, status FROM {table} WHERE tenant_id=$1 AND source=$2 AND supplier_invoice_id=$3 ORDER BY created_at,id LIMIT 1 FOR UPDATE"),
                &[&tenant.id, &spec.source, &invoice_id],
            ).await?
        } else {
            tx.query_opt(
                &format!("SELECT id, status FROM {table} WHERE tenant_id=$1 AND source=$2 AND source_id=$3 ORDER BY created_at,id LIMIT 1 FOR UPDATE"),
                &[&tenant.id, &spec.source, &source_key],
            ).await?
        };
        if let Some(existing) = existing {
            let id: Uuid = existing.get(0);
            let status: String = existing.get(1);
            if status == "draft" {
                kernel
                    .act_in(tx, &Actor::System, tenant, &entity, &id.to_string(), "posted", &opts)
                    .await?;
            }
            return Ok(true);
        }
    } else if tx
        .query_opt(
            &format!("SELECT id FROM {table} WHERE tenant_id = $1 AND source = $2 AND source_id = $3 ORDER BY created_at, id LIMIT 1 FOR UPDATE"),
            &[&tenant.id, &spec.source, &source_key],
        )
        .await?
        .is_some()
    {
        return Ok(true);
    }
    let document = kernel
        .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
        .await?;
    if spec.post {
        let id = document["id"].as_str().ok_or_else(|| {
            crate::error::ApiError::internal("Created accounting document has no id")
        })?;
        kernel
            .act_in(tx, &Actor::System, tenant, &entity, id, "posted", &opts)
            .await?;
    }
    Ok(true)
}
