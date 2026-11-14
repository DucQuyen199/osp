//! Product persistence rules for inventory tracking configuration.
use super::parse_id;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_expiry_policy(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let new_lot_tracked = document
        .get("lot_tracked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let expiry_required = document
        .get("expiry_required")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if expiry_required && !new_lot_tracked {
        errors.push("Expiry date can only be required for a lot-tracked product".into());
    }
    if action != "updated" {
        return Ok(());
    }
    let Some(product_id) = parse_id(document, "id") else {
        return Ok(());
    };
    let Some(current) = tx
        .query_opt(
            "SELECT COALESCE(lot_tracked, false), COALESCE(expiry_required, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &product_id],
        )
        .await?
    else {
        return Ok(());
    };
    let current_lot_tracked: bool = current.get(0);
    let current_expiry_required: bool = current.get(1);
    let tracking_changed = current_lot_tracked != new_lot_tracked;
    let expiry_policy_changed = current_expiry_required != expiry_required;
    if !tracking_changed && !expiry_policy_changed {
        return Ok(());
    }

    if expiry_policy_changed && expiry_required {
        let incompatible_history = tx
            .query_one_row(
                "SELECT EXISTS(SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND product = $2 AND expiry IS NULL) OR EXISTS(SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND lot IS NULL) OR EXISTS(SELECT 1 FROM inventory__stock_move sm JOIN inventory__lot l ON l.tenant_id = sm.tenant_id AND l.id::text = sm.lot WHERE sm.tenant_id = $1 AND sm.product = $2 AND l.expiry IS NULL)",
                &[&tenant.id, &product_id],
            )
            .await?;
        let has_incompatible_history: bool = incompatible_history.get(0);
        if has_incompatible_history {
            errors.push(
                "Require expiry dates only after all existing lots and stock movements have complete lot and expiry traceability".into(),
            );
        }
    }

    let history = tx
        .query_one_row(
            "SELECT EXISTS(SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2) OR EXISTS(SELECT 1 FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND (COALESCE(qty, 0) <> 0 OR COALESCE(value, 0) <> 0)) OR EXISTS(SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND product = $2)",
            &[&tenant.id, &product_id],
        )
        .await?;
    let has_inventory_history: bool = history.get(0);
    if tracking_changed && has_inventory_history {
        errors.push(
            "Lot tracking cannot be changed after inventory movements, balances, or lots exist for this product".into(),
        );
    }
    if expiry_policy_changed && !expiry_required && has_inventory_history {
        errors.push(
            "Expiry-date policy cannot be changed after inventory movements, balances, or lots exist for this product".into(),
        );
    }
    Ok(())
}
