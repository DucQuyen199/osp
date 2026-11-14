use super::*;

pub(super) async fn handle_purchase_return(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    returns::create_return_note(kernel, tx, tenant, event, event_id, depth, true).await?;
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
