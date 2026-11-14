//! Product persistence rules for inventory tracking configuration.
use super::parse_id;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_lot_tracking_change(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(product_id) = parse_id(document, "id") else {
        return Ok(());
    };
    let new_lot_tracked = document
        .get("lot_tracked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let Some(current) = tx
        .query_opt(
            "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &product_id],
        )
        .await?
    else {
        return Ok(());
    };
    let current_lot_tracked: bool = current.get(0);
    if current_lot_tracked == new_lot_tracked {
        return Ok(());
    }
    let history = tx
        .query_one_row(
            "SELECT EXISTS(SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2) OR EXISTS(SELECT 1 FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND (COALESCE(qty, 0) <> 0 OR COALESCE(value, 0) <> 0)) OR EXISTS(SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND product = $2)",
            &[&tenant.id, &product_id],
        )
        .await?;
    let has_inventory_history: bool = history.get(0);
    if has_inventory_history {
        errors.push(
            "Lot tracking cannot be changed after inventory movements, balances, or lots exist for this product".into(),
        );
    }
    Ok(())
}
