use super::super::*;
use std::collections::HashMap;

#[derive(Clone)]
struct Layer {
    id: Uuid,
    receipt: Uuid,
    product: Uuid,
    warehouse: Uuid,
    qty: Decimal,
    total_cost: Decimal,
}

fn round_currency(value: Decimal) -> Decimal {
    value.round_dp(2)
}

fn json_amount(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.landed_cost",
            vec!["Landed-cost amount exceeds the supported decimal range".into()],
        )
    })
}

fn db_amount(row: &tokio_postgres::Row, column: usize, name: &str) -> R<Decimal> {
    let raw: String = row.get(column);
    money::decimal_str(&raw).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.landed_cost",
            vec![format!("Stored {name} is not a valid decimal")],
        )
    })
}

/// Estimate each received layer's remaining physical quantity. FIFO allocation
/// history is authoritative when present; moving-average tenants use the same
/// receipt chronology only to split the late cost between stock and COGS.
async fn open_layer_quantities(
    tx: &Tx<'_>,
    tenant: &Tenant,
    product: Uuid,
    warehouse: Uuid,
) -> R<HashMap<Uuid, Decimal>> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        &[&format!(
            "inventory.stock:{}:{}:{}",
            tenant.id, product, warehouse
        )],
    )
    .await?;
    let rows = tx
        .query(
            "SELECT id,direction,qty::text,lot,fifo_allocations FROM inventory__stock_move WHERE tenant_id=$1 AND product=$2 AND warehouse=$3 ORDER BY created_at,id FOR UPDATE",
            &[&tenant.id, &product, &warehouse],
        )
        .await?;
    let mut open = HashMap::<Uuid, (Decimal, Option<String>)>::new();
    let mut order = Vec::new();
    for row in rows {
        let id: Uuid = row.get(0);
        let direction: String = row.get(1);
        let qty = db_amount(&row, 2, "stock quantity")?;
        let lot: Option<String> = row.get(3);
        if direction == "in" {
            open.insert(id, (qty.max(Decimal::ZERO), lot));
            order.push(id);
            continue;
        }
        let allocations: Option<Value> = row.get(4);
        if let Some(allocations) = allocations.and_then(|value| value.as_array().cloned()) {
            for allocation in allocations {
                let Some(layer_id) = allocation
                    .get("layer_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    continue;
                };
                if let Some((remaining, _)) = open.get_mut(&layer_id) {
                    let consumed = allocation
                        .get("qty")
                        .and_then(money::decimal)
                        .unwrap_or_default();
                    *remaining = remaining
                        .checked_sub(consumed)
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                "inventory.landed_cost",
                                vec!["FIFO layer quantity is outside the supported range".into()],
                            )
                        })?
                        .max(Decimal::ZERO);
                }
            }
            continue;
        }
        let outbound_lot: Option<String> = row.get(3);
        let mut remaining = qty.max(Decimal::ZERO);
        for layer_id in &order {
            if remaining <= Decimal::ZERO {
                break;
            }
            let Some((layer_remaining, layer_lot)) = open.get_mut(layer_id) else {
                continue;
            };
            if outbound_lot.is_some() && outbound_lot != *layer_lot {
                continue;
            }
            let consumed = remaining.min(*layer_remaining);
            *layer_remaining = layer_remaining.checked_sub(consumed).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Stock layer quantity is outside the supported range".into()],
                )
            })?;
            remaining = remaining.checked_sub(consumed).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Stock issue quantity is outside the supported range".into()],
                )
            })?;
        }
    }
    Ok(open
        .into_iter()
        .map(|(id, (remaining, _))| (id, remaining))
        .collect())
}

pub async fn apply_landed_costs(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    bill: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("inventory") || !tenant.has_module("accounting") {
        return Ok(false);
    }
    let Some(adjustments) = bill.get("purchase_adjustments").and_then(Value::as_array) else {
        return Ok(false);
    };
    let landed = adjustments
        .iter()
        .filter(|adjustment| {
            adjustment.get("allocation").and_then(Value::as_str) == Some("landed_cost")
        })
        .collect::<Vec<_>>();
    if landed.is_empty() {
        return Ok(false);
    }
    let bill_id = bill
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost bill requires a valid id".into()],
            )
        })?;
    let invoice_id = bill
        .get("supplier_invoice_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed cost must be linked to an approved supplier invoice".into()],
            )
        })?;
    let order_id = bill
        .get("source_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost bill requires its source purchase order".into()],
            )
        })?;
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        &[&format!("inventory.landed_cost:{}:{}", tenant.id, bill_id)],
    )
    .await?;
    if tx
        .query_opt(
            "SELECT id FROM inventory__valuation_adjustment WHERE tenant_id=$1 AND source_bill=$2 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &bill_id.to_string()],
        )
        .await?
        .is_some()
    {
        return Ok(false);
    }

    let mut layers_by_receipt = HashMap::<Uuid, Vec<Layer>>::new();
    for adjustment in &landed {
        let Some(receipt_ids) = adjustment.get("receipt_ids").and_then(Value::as_array) else {
            return Err(crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost adjustment has no selected receipt documents".into()],
            ));
        };
        for receipt_id in receipt_ids.iter().filter_map(Value::as_str) {
            let receipt_id = Uuid::parse_str(receipt_id).map_err(|_| {
                crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Landed-cost adjustment has an invalid receipt id".into()],
                )
            })?;
            if layers_by_receipt.contains_key(&receipt_id) {
                continue;
            }
            let receipt = tx
                .query_opt(
                    "SELECT id FROM purchasing__purchase_receipt WHERE tenant_id=$1 AND id=$2 AND purchase_order=$3 AND status='received' FOR UPDATE",
                    &[&tenant.id, &receipt_id, &order_id],
                )
                .await?;
            if receipt.is_none() {
                return Err(crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Landed cost references a receipt outside its purchase order".into()],
                ));
            }
            let rows = tx
                .query(
                    "SELECT sm.id,sm.product,sm.warehouse,sm.qty::text,(COALESCE(sm.total_cost,0)::numeric+COALESCE((SELECT SUM(va.amount::numeric) FROM inventory__valuation_adjustment va WHERE va.tenant_id=sm.tenant_id AND va.stock_move=sm.id),0))::text FROM inventory__stock_move sm WHERE sm.tenant_id=$1 AND sm.source='purchase_receipt' AND sm.source_id=$2 AND sm.direction='in' AND sm.warehouse IS NOT NULL ORDER BY sm.created_at,sm.id FOR UPDATE",
                    &[&tenant.id, &receipt_id.to_string()],
                )
                .await?;
            let mut layers = Vec::new();
            for row in rows {
                layers.push(Layer {
                    id: row.get(0),
                    receipt: receipt_id,
                    product: row.get(1),
                    warehouse: row.get(2),
                    qty: db_amount(&row, 3, "receipt layer quantity")?,
                    total_cost: db_amount(&row, 4, "receipt layer value")?,
                });
            }
            if layers.is_empty() {
                return Err(crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Selected receipt has no inventory valuation layers".into()],
                ));
            }
            layers_by_receipt.insert(receipt_id, layers);
        }
    }

    let cost_method = tenant
        .setting_str("inventoryCostMethod")
        .unwrap_or("moving_average");
    let entity = kernel.ent(tenant, "inventory.valuation_adjustment")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let mut stock_value_delta = HashMap::<(Uuid, Uuid), Decimal>::new();
    let mut open_layers = HashMap::<(Uuid, Uuid), HashMap<Uuid, Decimal>>::new();
    let mut applied = 0usize;
    for adjustment in landed {
        let Some(amount) = adjustment
            .get("base_amount")
            .and_then(money::decimal)
            .filter(|amount| *amount > Decimal::ZERO)
        else {
            return Err(crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost amount must be positive in base currency".into()],
            ));
        };
        let basis = adjustment
            .get("allocation_basis")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(basis, "quantity" | "value") {
            return Err(crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost allocation basis must be quantity or value".into()],
            ));
        }
        let receipt_ids = adjustment
            .get("receipt_ids")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Landed-cost adjustment has no receipt ids".into()],
                )
            })?;
        let selected_receipts = receipt_ids
            .iter()
            .filter_map(Value::as_str)
            .filter_map(|value| Uuid::parse_str(value).ok())
            .collect::<Vec<_>>();
        let mut layers = selected_receipts
            .iter()
            .filter_map(|id| layers_by_receipt.get(id))
            .flat_map(|layers| layers.iter().cloned())
            .collect::<Vec<_>>();
        let measure = |layer: &Layer| match basis {
            "quantity" => layer.qty,
            _ => layer.total_cost,
        };
        layers.retain(|layer| layer.qty > Decimal::ZERO && measure(layer) > Decimal::ZERO);
        let total_measure = layers
            .iter()
            .try_fold(Decimal::ZERO, |sum, layer| sum.checked_add(measure(layer)));
        let Some(total_measure) = total_measure.filter(|value| *value > Decimal::ZERO) else {
            return Err(crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Selected receipt layers have no positive allocation basis".into()],
            ));
        };
        let mut remaining_amount = amount;
        for (index, layer) in layers.iter().enumerate() {
            let layer_measure = measure(layer);
            if layer_measure <= Decimal::ZERO || layer.qty <= Decimal::ZERO {
                continue;
            }
            let share = if index + 1 == layers.len() {
                remaining_amount
            } else {
                amount
                    .checked_mul(layer_measure)
                    .and_then(|value| value.checked_div(total_measure))
                    .map(round_currency)
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "inventory.landed_cost",
                            vec!["Landed-cost allocation exceeds the supported range".into()],
                        )
                    })?
                    .min(remaining_amount)
            };
            remaining_amount = remaining_amount.checked_sub(share).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.landed_cost",
                    vec!["Landed-cost allocation exceeds the supported range".into()],
                )
            })?;
            let layer_key = (layer.product, layer.warehouse);
            if !open_layers.contains_key(&layer_key) {
                open_layers.insert(
                    layer_key,
                    open_layer_quantities(tx, tenant, layer.product, layer.warehouse).await?,
                );
            }
            let remaining = open_layers
                .get(&layer_key)
                .and_then(|quantities| quantities.get(&layer.id))
                .copied()
                .unwrap_or_default()
                .min(layer.qty);
            let open_share = share
                .checked_mul(remaining)
                .and_then(|value| value.checked_div(layer.qty))
                .map(round_currency)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "inventory.landed_cost",
                        vec!["Open landed-cost value exceeds the supported range".into()],
                    )
                })?;
            let adjustment_data = Map::from_iter([
                ("stock_move".into(), json!(layer.id)),
                ("source_bill".into(), json!(bill_id.to_string())),
                ("source_invoice".into(), json!(invoice_id)),
                ("receipt".into(), json!(layer.receipt.to_string())),
                ("amount".into(), json_amount(share)?),
                ("capitalized_amount".into(), json_amount(open_share)?),
                ("layer_qty".into(), json_amount(layer.qty)?),
                ("cost_method".into(), json!(cost_method)),
            ]);
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, adjustment_data, &opts)
                .await?;
            applied += 1;
            if open_share > Decimal::ZERO {
                let key = (layer.product, layer.warehouse);
                let current = stock_value_delta.get(&key).copied().unwrap_or_default();
                stock_value_delta.insert(
                    key,
                    current.checked_add(open_share).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "inventory.landed_cost",
                            vec!["Open landed-cost total exceeds the supported range".into()],
                        )
                    })?,
                );
            }
        }
    }
    if applied == 0 {
        return Err(crate::error::ApiError::validation(
            "inventory.landed_cost",
            vec!["Landed cost did not allocate to a receipt layer".into()],
        ));
    }

    let mut reclassified = Decimal::ZERO;
    let level_entity = kernel.ent(tenant, "inventory.stock_level")?;
    for ((product, warehouse), delta) in stock_value_delta {
        let level = tx
            .query_opt(
                "SELECT id,COALESCE(value,0)::text FROM inventory__stock_level WHERE tenant_id=$1 AND product=$2 AND warehouse=$3 FOR UPDATE",
                &[&tenant.id, &product, &warehouse],
            )
            .await?;
        let Some(level) = level else {
            return Err(crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Received stock layer has no current stock balance".into()],
            ));
        };
        let level_id: Uuid = level.get(0);
        let current_value = db_amount(&level, 1, "stock value")?;
        let next_value = current_value.checked_add(delta).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Inventory value exceeds the supported range".into()],
            )
        })?;
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &level_entity,
                &level_id.to_string(),
                Map::from_iter([("value".into(), json_amount(next_value)?)]),
                &opts,
            )
            .await?;
        reclassified = reclassified.checked_add(delta).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.landed_cost",
                vec!["Landed-cost reclassification exceeds the supported range".into()],
            )
        })?;
    }
    if reclassified > Decimal::ZERO {
        let accounts = tx
            .query(
                "SELECT code,id FROM accounting__account WHERE tenant_id=$1 AND code IN ('156','632') FOR SHARE",
                &[&tenant.id],
            )
            .await?;
        let mut account_ids = HashMap::new();
        for account in accounts {
            let code: String = account.get(0);
            let id: Uuid = account.get(1);
            account_ids.insert(code, id);
        }
        let (Some(inventory), Some(expense)) = (account_ids.get("156"), account_ids.get("632"))
        else {
            return Err(crate::error::ApiError::validation(
                "accounting.journal_entry",
                vec![
                    "Inventory and purchase-expense accounts are required to post landed cost"
                        .into(),
                ],
            ));
        };
        let amount = json_amount(reclassified)?;
        let mut journal = Map::new();
        journal.insert(
            "memo".into(),
            json!(format!("Landed cost reclassification: {invoice_id}")),
        );
        journal.insert("amount".into(), amount.clone());
        journal.insert("source".into(), json!("landed_cost_reclassification"));
        journal.insert("source_id".into(), json!(bill_id.to_string()));
        journal.insert(
            "lines".into(),
            json!([
                { "account": inventory, "debit": amount.clone(), "credit": 0 },
                { "account": expense, "debit": 0, "credit": amount }
            ]),
        );
        let journal_entity = kernel.ent(tenant, "accounting.journal_entry")?;
        let entry = kernel
            .create_in(tx, &Actor::System, tenant, &journal_entity, journal, &opts)
            .await?;
        let journal_id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| crate::error::ApiError::internal("Landed-cost journal has no id"))?;
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &journal_entity,
                journal_id,
                "posted",
                &opts,
            )
            .await?;
    }
    Ok(true)
}
