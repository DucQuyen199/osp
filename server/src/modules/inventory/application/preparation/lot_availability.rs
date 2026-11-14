use super::stock_move::decimal_column;
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use uuid::Uuid;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    product_id: Uuid,
    warehouse_id: Uuid,
    lot_id: Uuid,
    direction: &str,
    source: &str,
    qty: Decimal,
) -> R<Vec<String>> {
    let lot = tx
        .query_opt(
            "SELECT (expiry IS NULL OR expiry >= CURRENT_DATE), expiry IS NOT NULL FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 FOR SHARE",
            &[&tenant.id, &lot_id, &product_id],
        )
        .await?;
    let Some(lot) = lot else {
        return Ok(vec![
            "Selected lot does not belong to this product and tenant".into(),
        ]);
    };

    let expiry_required = tx
        .query_opt(
            "SELECT COALESCE(expiry_required, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        )
        .await?
        .is_some_and(|row| row.get::<_, bool>(0));
    if expiry_required && !lot.get::<_, bool>(1) {
        return Ok(vec![
            "This product requires an expiry date on every lot".into(),
        ]);
    }

    if direction != "out" || source == "quality_return" {
        return Ok(Vec::new());
    }

    let lot_is_current: bool = lot.get(0);
    if !lot_is_current && source != "stock_count" {
        return Ok(vec!["Expired lots cannot be issued".into()]);
    }

    let unassigned_held = if tenant.has_module("quality") {
        tx.query_opt(
            "SELECT COALESCE(SUM(CASE WHEN qi.status = 'passed' THEN 0::numeric ELSE GREATEST(qi.qty::numeric - COALESCE(disp.qty, 0) - COALESCE(ret.qty, 0), 0::numeric) END), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qd.qty::numeric) AS qty FROM quality__inspection_disposition qd WHERE qd.tenant_id = qi.tenant_id AND qd.inspection = qi.id AND qd.status = 'posted') disp ON TRUE LEFT JOIN LATERAL (SELECT SUM(qr.qty::numeric) AS qty FROM inventory__stock_move qr WHERE qr.tenant_id = qi.tenant_id AND qr.source = 'quality_return' AND qr.source_id = qi.id::text AND qr.direction = 'out' AND qr.lot IS NOT DISTINCT FROM qi.lot::text) ret ON TRUE WHERE qi.tenant_id = $1 AND qi.product = $2 AND qi.warehouse = $3 AND qi.source IN ('purchase_order', 'purchase_receipt') AND qi.lot IS NULL",
            &[&tenant.id, &product_id, &warehouse_id],
        )
        .await?
        .map(|row| decimal_column(&row, 0, "unassigned held quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    if unassigned_held > Decimal::new(1, 6) {
        return Ok(vec![
            "Resolve quality-held stock without lot trace before issuing lot-controlled stock"
                .into(),
        ]);
    }

    let lot_balance = tx
        .query_opt(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND lot = $4",
            &[&tenant.id, &product_id, &warehouse_id, &lot_id.to_string()],
        )
        .await?
        .map(|row| decimal_column(&row, 0, "lot balance"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let held_by_lot = if tenant.has_module("quality") {
        tx.query_opt(
            "SELECT COALESCE(SUM(CASE WHEN qi.status = 'passed' THEN 0::numeric ELSE GREATEST(qi.qty::numeric - COALESCE(disp.qty, 0) - COALESCE(ret.qty, 0), 0::numeric) END), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qd.qty::numeric) AS qty FROM quality__inspection_disposition qd WHERE qd.tenant_id = qi.tenant_id AND qd.inspection = qi.id AND qd.status = 'posted') disp ON TRUE LEFT JOIN LATERAL (SELECT SUM(qr.qty::numeric) AS qty FROM inventory__stock_move qr WHERE qr.tenant_id = qi.tenant_id AND qr.source = 'quality_return' AND qr.source_id = qi.id::text AND qr.direction = 'out' AND qr.lot IS NOT DISTINCT FROM qi.lot::text) ret ON TRUE WHERE qi.tenant_id = $1 AND qi.product = $2 AND qi.warehouse = $3 AND qi.source IN ('purchase_order', 'purchase_receipt') AND qi.lot = $4",
            &[&tenant.id, &product_id, &warehouse_id, &lot_id],
        )
        .await?
        .map(|row| decimal_column(&row, 0, "lot held quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    let available_lot = lot_balance.checked_sub(held_by_lot).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Lot availability exceeds the supported decimal range".into()],
        )
    })?;
    if available_lot
        .checked_add(Decimal::new(1, 6))
        .unwrap_or(available_lot)
        < qty
    {
        return Ok(vec![
            "Selected lot has insufficient available quantity".into(),
        ]);
    }
    Ok(Vec::new())
}
