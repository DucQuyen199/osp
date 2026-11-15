use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::HashMap;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.valuation",
            vec![format!("Stored inventory {field} is not a valid decimal")],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.valuation",
            vec!["Inventory amount exceeds the supported decimal range".into()],
        )
    })
}

/// Allocate an outbound line across eligible lots in FEFO order. Unlotted
/// legacy stock remains usable after known lot balances have been accounted for.
pub(super) async fn allocate_fefo(
    tx: &Tx<'_>,
    tenant: &Tenant,
    warehouse: Uuid,
    line: &Value,
) -> R<Vec<Value>> {
    if line
        .get("lot")
        .and_then(Value::as_str)
        .is_some_and(|lot| !lot.is_empty())
    {
        return Ok(vec![line.clone()]);
    }
    let Some(product) = line
        .get("product")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec![line.clone()]);
    };
    let Some(requested) = line
        .get("qty")
        .and_then(money::decimal)
        .filter(|qty| *qty > Decimal::ZERO)
    else {
        return Ok(vec![line.clone()]);
    };
    let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;

    let stock = tx
        .query_opt(
            "SELECT COALESCE(qty, 0)::text, COALESCE(held_qty, 0)::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
            &[&tenant.id, &product, &warehouse],
        )
        .await?;
    let (on_hand, held) = if let Some(row) = stock {
        (
            decimal_column(&row, 0, "on-hand quantity")?,
            decimal_column(&row, 1, "held quantity")?,
        )
    } else {
        (Decimal::ZERO, Decimal::ZERO)
    };

    // Lock lot metadata before reading its movement-derived balance so expiry
    // dates cannot change while this outbound transaction is being prepared.
    tx.query(
        "SELECT id FROM inventory__lot WHERE tenant_id = $1 AND product = $2 ORDER BY id FOR SHARE",
        &[&tenant.id, &product],
    )
    .await?;
    let lots = tx
        .query(
            "SELECT l.id, (l.expiry IS NULL OR l.expiry >= $4::date), COALESCE(SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END), 0)::text FROM inventory__lot l LEFT JOIN inventory__stock_move sm ON sm.tenant_id = l.tenant_id AND sm.product = l.product AND sm.warehouse = $3 AND sm.lot = l.id::text WHERE l.tenant_id = $1 AND l.product = $2 GROUP BY l.id, l.expiry ORDER BY l.expiry ASC NULLS LAST, l.id",
            &[&tenant.id, &product, &warehouse, &tenant.business_today()],
        )
        .await?;
    let quality_holds = if tenant.has_module("quality") {
        tx.query(
            "SELECT qi.lot, COALESCE(SUM(CASE WHEN qi.status = 'passed' THEN 0::numeric ELSE GREATEST(qi.qty::numeric - COALESCE(disp.qty, 0) - COALESCE(ret.qty, 0), 0::numeric) END), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qd.qty::numeric) AS qty FROM quality__inspection_disposition qd WHERE qd.tenant_id = qi.tenant_id AND qd.inspection = qi.id AND qd.status = 'posted') disp ON TRUE LEFT JOIN LATERAL (SELECT SUM(qr.qty::numeric) AS qty FROM inventory__stock_move qr WHERE qr.tenant_id = qi.tenant_id AND qr.source = 'quality_return' AND qr.source_id = qi.id::text AND qr.product = qi.product AND qr.warehouse = qi.warehouse AND qr.lot IS NOT DISTINCT FROM qi.lot::text AND qr.direction = 'out') ret ON TRUE WHERE qi.tenant_id = $1 AND qi.product = $2 AND qi.warehouse = $3 AND qi.source IN ('purchase_order', 'purchase_receipt') GROUP BY qi.lot",
            &[&tenant.id, &product, &warehouse],
        )
        .await?
    } else {
        Vec::new()
    };
    let mut held_by_lot = std::collections::HashMap::new();
    let mut unassigned_held = Decimal::ZERO;
    for row in quality_holds {
        let lot: Option<Uuid> = row.get(0);
        let held_qty = decimal_column(&row, 1, "quality held quantity")?;
        if let Some(lot) = lot {
            held_by_lot.insert(lot, held_qty);
        } else {
            unassigned_held = unassigned_held.checked_add(held_qty).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.valuation",
                    vec!["Quality held quantity exceeds the supported decimal range".into()],
                )
            })?;
        }
    }

    let mut available_lotted = Decimal::ZERO;
    let mut eligible = Vec::new();
    for row in lots {
        let balance = decimal_column(&row, 2, "lot balance")?;
        if balance <= Decimal::new(1, 6) {
            continue;
        }
        let lot = row.get::<_, Uuid>(0);
        let available = balance
            .checked_sub(held_by_lot.get(&lot).copied().unwrap_or_default())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.valuation",
                    vec!["Lot available quantity exceeds the supported decimal range".into()],
                )
            })?
            .max(Decimal::ZERO);
        available_lotted = available_lotted.checked_add(available).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.valuation",
                vec!["Available lot quantity exceeds the supported decimal range".into()],
            )
        })?;
        if row.get::<_, bool>(1) || line.get("_include_expired_lots") == Some(&Value::Bool(true)) {
            eligible.push((lot, available));
        }
    }
    if available_lotted <= Decimal::new(1, 6) {
        return Ok(vec![line.clone()]);
    }
    let unallocated = on_hand
        .checked_sub(held)
        .and_then(|value| value.checked_sub(available_lotted))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.valuation",
                vec!["Unallocated stock quantity exceeds the supported decimal range".into()],
            )
        })?
        .max(Decimal::ZERO);
    if unassigned_held > Decimal::new(1, 6) {
        if requested
            <= unallocated
                .checked_add(Decimal::new(1, 6))
                .unwrap_or(unallocated)
        {
            return Ok(vec![line.clone()]);
        }
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Resolve pending quality-held stock before allocating tracked lots".into()],
        ));
    }

    let mut remaining = requested;
    let mut allocations = Vec::new();
    for (lot, balance) in eligible {
        if remaining <= Decimal::new(1, 6) {
            break;
        }
        let qty = remaining.min(balance);
        if qty <= Decimal::new(1, 6) {
            continue;
        }
        let mut allocation = line.clone();
        allocation["qty"] = decimal_json(qty)?;
        allocation["lot"] = json!(lot);
        allocations.push(allocation);
        remaining = remaining.checked_sub(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.valuation",
                vec!["Lot allocation exceeds the supported decimal range".into()],
            )
        })?;
    }
    if remaining > Decimal::new(1, 6) && unallocated > Decimal::new(1, 6) {
        let qty = remaining.min(unallocated);
        let mut allocation = line.clone();
        allocation["qty"] = decimal_json(qty)?;
        allocation.as_object_mut().map(|row| row.remove("lot"));
        allocations.push(allocation);
        remaining = remaining.checked_sub(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.valuation",
                vec!["Unallocated stock quantity exceeds the supported decimal range".into()],
            )
        })?;
    }
    if remaining > Decimal::new(1, 6) {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec![
                "Insufficient non-expired lot quantity; replenish stock or correct lot expiry"
                    .into(),
            ],
        ));
    }
    Ok(allocations)
}

#[derive(Clone)]
struct FifoLayer {
    id: Uuid,
    origin_id: String,
    lot: Option<String>,
    received_at: String,
    remaining_qty: Decimal,
    unit_cost: Decimal,
}

/// Rebuild open receipt layers from immutable stock moves and allocate the oldest
/// unheld layers. Outbound moves persist these allocations for deterministic replay.
pub(super) async fn fifo_cost_allocations(
    tx: &Tx<'_>,
    tenant: &Tenant,
    product: Uuid,
    warehouse: Option<Uuid>,
    lot: Option<&str>,
    quantity: Decimal,
    source: &str,
) -> R<(Decimal, Value)> {
    let rows = tx
        .query(
            "SELECT sm.id, sm.direction, sm.qty::text, (COALESCE(sm.total_cost, 0)::numeric + COALESCE((SELECT SUM(va.amount::numeric) FROM inventory__valuation_adjustment va WHERE va.tenant_id=sm.tenant_id AND va.stock_move=sm.id AND va.cost_method='fifo'),0))::text, sm.lot, sm.fifo_date::text, sm.fifo_origin_id, sm.created_at::text, sm.fifo_allocations FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.product = $2 AND sm.warehouse IS NOT DISTINCT FROM $3 ORDER BY sm.created_at, sm.id",
            &[&tenant.id, &product, &warehouse],
        )
        .await?;
    let mut layers: HashMap<Uuid, FifoLayer> = HashMap::new();
    for row in rows {
        let direction: String = row.get(1);
        let row_qty = decimal_column(&row, 2, "movement quantity")?;
        if direction == "in" {
            if row_qty <= Decimal::new(1, 6) {
                continue;
            }
            let total_cost = decimal_column(&row, 3, "movement cost")?;
            let unit_cost = total_cost.checked_div(row_qty).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec![
                        "Receipt has invalid FIFO cost; correct the source before issuing stock"
                            .into(),
                    ],
                )
            })?;
            if unit_cost < Decimal::ZERO {
                return Err(crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec![
                        "Receipt has invalid FIFO cost; correct the source before issuing stock"
                            .into(),
                    ],
                ));
            }
            let id: Uuid = row.get(0);
            let origin_id: Option<String> = row.get(6);
            let created_at: String = row.get(7);
            let fifo_date: Option<String> = row.get(5);
            let layer = FifoLayer {
                id,
                origin_id: origin_id.unwrap_or_else(|| id.to_string()),
                lot: row.get(4),
                received_at: fifo_date.unwrap_or(created_at),
                remaining_qty: row_qty,
                unit_cost,
            };
            layers.insert(id, layer);
        } else if direction == "out" {
            let allocations: Option<Value> = row.get(8);
            let Some(allocations) = allocations.and_then(|value| value.as_array().cloned()) else {
                return Err(crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec![
                        "FIFO history is missing a cost-layer allocation; stock issue is blocked"
                            .into(),
                    ],
                ));
            };
            for allocation in allocations {
                let Some(layer_id) = allocation
                    .get("layer_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    return Err(crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["FIFO history contains an invalid receipt-layer reference".into()],
                    ));
                };
                let consumed = allocation
                    .get("qty")
                    .and_then(money::decimal)
                    .unwrap_or_default();
                let Some(layer) = layers.get_mut(&layer_id) else {
                    return Err(crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["FIFO history references a missing receipt layer".into()],
                    ));
                };
                if consumed <= Decimal::ZERO
                    || consumed
                        > layer
                            .remaining_qty
                            .checked_add(Decimal::new(1, 6))
                            .unwrap_or(layer.remaining_qty)
                {
                    return Err(crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["FIFO history consumes more than the receipt-layer balance".into()],
                    ));
                }
                layer.remaining_qty = layer
                    .remaining_qty
                    .checked_sub(consumed)
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "inventory.stock_move",
                            vec!["FIFO layer balance exceeds the supported decimal range".into()],
                        )
                    })?
                    .max(Decimal::ZERO);
            }
        }
    }

    let mut open = layers
        .into_values()
        .filter(|layer| {
            layer.remaining_qty > Decimal::new(1, 6)
                && lot.is_none_or(|requested| layer.lot.as_deref() == Some(requested))
        })
        .collect::<Vec<_>>();
    open.sort_by(|left, right| {
        left.received_at
            .cmp(&right.received_at)
            .then_with(|| left.origin_id.cmp(&right.origin_id))
            .then_with(|| left.id.cmp(&right.id))
    });

    // Quality-held units are unavailable to ordinary issues. Reserve them from
    // the newest layer in each lot so FIFO continues to issue the oldest free stock.
    if tenant.has_module("quality") && source != "quality_return" {
        let held_rows = tx
            .query(
                "SELECT qi.lot::text, COALESCE(SUM(CASE WHEN qi.status = 'passed' THEN 0::numeric ELSE GREATEST(qi.qty::numeric - COALESCE(disp.qty, 0) - COALESCE(ret.qty, 0), 0::numeric) END), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qd.qty::numeric) AS qty FROM quality__inspection_disposition qd WHERE qd.tenant_id = qi.tenant_id AND qd.inspection = qi.id AND qd.status = 'posted') disp ON TRUE LEFT JOIN LATERAL (SELECT SUM(qr.qty::numeric) AS qty FROM inventory__stock_move qr WHERE qr.tenant_id = qi.tenant_id AND qr.source = 'quality_return' AND qr.source_id = qi.id::text AND qr.product = qi.product AND qr.warehouse = qi.warehouse AND qr.lot IS NOT DISTINCT FROM qi.lot::text AND qr.direction = 'out') ret ON TRUE WHERE qi.tenant_id = $1 AND qi.product = $2 AND qi.warehouse IS NOT DISTINCT FROM $3 AND ($4::text IS NULL OR qi.lot::text = $4) AND qi.source IN ('purchase_order', 'purchase_receipt') GROUP BY qi.lot",
                &[&tenant.id, &product, &warehouse, &lot],
            )
            .await?;
        let mut held_by_lot = HashMap::new();
        for row in held_rows {
            let held_lot: Option<String> = row.get(0);
            let held_qty = decimal_column(&row, 1, "quality held quantity")?;
            held_by_lot.insert(held_lot, held_qty);
        }
        for (held_lot, mut held_qty) in held_by_lot {
            for layer in open.iter_mut().rev().filter(|layer| layer.lot == held_lot) {
                let reserve = held_qty.min(layer.remaining_qty);
                layer.remaining_qty =
                    layer.remaining_qty.checked_sub(reserve).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "inventory.stock_move",
                            vec!["FIFO layer balance exceeds the supported decimal range".into()],
                        )
                    })?;
                held_qty = held_qty.checked_sub(reserve).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["Quality held quantity exceeds the supported decimal range".into()],
                    )
                })?;
                if held_qty <= Decimal::new(1, 6) {
                    break;
                }
            }
            if held_qty > Decimal::new(1, 6) {
                return Err(crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec!["Quality-held quantity exceeds its available FIFO receipt layers".into()],
                ));
            }
        }
    }

    let mut remaining = quantity;
    let mut total_cost = Decimal::ZERO;
    let mut allocations = Vec::new();
    for layer in open {
        if remaining <= Decimal::new(1, 6) {
            break;
        }
        let consumed = remaining.min(layer.remaining_qty);
        if consumed <= Decimal::new(1, 6) {
            continue;
        }
        let extended_cost = consumed.checked_mul(layer.unit_cost).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["FIFO layer cost exceeds the supported decimal range".into()],
            )
        })?;
        total_cost = total_cost.checked_add(extended_cost).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["FIFO issue cost exceeds the supported decimal range".into()],
            )
        })?;
        allocations.push(json!({
            "layer_id": layer.id,
            "origin_id": layer.origin_id,
            "qty": decimal_json(consumed)?,
            "unit_cost": decimal_json(layer.unit_cost)?,
            "received_at": layer.received_at,
            "lot": layer.lot,
        }));
        remaining = remaining.checked_sub(consumed).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["FIFO remaining quantity exceeds the supported decimal range".into()],
            )
        })?;
    }
    if remaining > Decimal::new(1, 6) {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec![format!(
                "FIFO receipt layers do not cover this issue; requested {quantity}, unallocated {remaining}"
            )],
        ));
    }
    let unit_cost = total_cost.checked_div(quantity).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["FIFO allocation produced an invalid cost".into()],
        )
    })?;
    if unit_cost < Decimal::ZERO || total_cost < Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["FIFO allocation produced an invalid cost".into()],
        ));
    }
    Ok((unit_cost, json!(allocations)))
}
