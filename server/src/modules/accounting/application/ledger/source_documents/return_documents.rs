use super::*;

pub(super) async fn handle_purchase_return(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    let purchase_order = event
        .get("purchase_order")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let supplier_invoice = event.get("supplier_invoice").and_then(Value::as_str);
    let has_bill = if let Some(invoice_id) = supplier_invoice {
        tx.query_opt(
            "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND supplier_invoice_id=$3 AND status IN ('posted','partially_paid','partially_settled','paid','settled') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
            &[&tenant.id, &purchase_order, &invoice_id],
        ).await?.is_some()
    } else {
        tx.query_opt(
            "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND supplier_invoice_id IS NULL AND status IN ('posted','partially_paid','partially_settled','paid','settled') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
            &[&tenant.id, &purchase_order],
        ).await?.is_some()
    };
    if has_bill {
        returns::create_return_note(kernel, tx, tenant, event, event_id, depth, true).await?;
    }
    Ok(Some(true))
}

pub(super) async fn handle_sales_return(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    returns::create_return_note(kernel, tx, tenant, event, event_id, depth, false).await?;
    Ok(Some(true))
}
