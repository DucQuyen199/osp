use super::*;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec![format!("Stored stock {field} is not a valid decimal")],
        )
    })
}

fn optional_decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec![format!("Stored stock {field} is not a valid decimal")],
                )
            })
        })
        .transpose()
        .map(|value| value.unwrap_or(Decimal::ZERO))
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock movement exceeds the supported decimal range".into()],
        )
    })
}

pub async fn apply_stock_move(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    movement: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Value> {
    let Some(product_id) = movement
        .get("product")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock movement requires a valid product".into()],
        ));
    };
    let warehouse_id = movement
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(direction) = movement.get("direction").and_then(Value::as_str) else {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock movement requires a direction".into()],
        ));
    };
    let qty = movement
        .get("qty")
        .and_then(money::decimal)
        .unwrap_or_default();
    let value = movement
        .get("total_cost")
        .and_then(money::decimal)
        .unwrap_or_default();
    if qty <= Decimal::ZERO || value < Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock movement quantity and value must be finite and non-negative".into()],
        ));
    }
    let delta = match direction {
        "in" => qty,
        "out" => Decimal::ZERO.checked_sub(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["Stock movement quantity exceeds the supported decimal range".into()],
            )
        })?,
        _ => {
            return Err(crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["Stock movement direction must be in or out".into()],
            ));
        }
    };
    let value_delta = if direction == "in" {
        value
    } else {
        Decimal::ZERO.checked_sub(value).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["Stock movement value exceeds the supported decimal range".into()],
            )
        })?
    };
    let source = movement
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let held_delta = match (direction, source) {
        ("in", "purchase_order" | "purchase_receipt") => qty,
        ("out", "quality_return") => Decimal::ZERO.checked_sub(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "inventory.stock_move",
                vec!["Held stock quantity exceeds the supported decimal range".into()],
            )
        })?,
        _ => Decimal::ZERO,
    };
    let lock_key = format!(
        "inventory.stock:{}:{}:{}",
        tenant.id,
        product_id,
        warehouse_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "none".into())
    );
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let level = tx.query_opt(
        "SELECT id, qty::text, value::text, held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse IS NOT DISTINCT FROM $3 LIMIT 1 FOR UPDATE",
        &[&tenant.id, &product_id, &warehouse_id],
    ).await?;
    if direction == "out"
        && source != "quality_return"
        && tenant.has_module("logistics")
        && !tenant.setting_bool("allowNegativeStock")
    {
        let fulfilling_order = (source == "sales_order")
            .then(|| {
                movement
                    .get("source_id")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok())
            })
            .flatten();
        let committed = tx
            .query_opt(
                "SELECT COALESCE(SUM(GREATEST(ordered.qty - COALESCE(delivered.qty, 0), 0::numeric)), 0)::text FROM (SELECT s.id, SUM(COALESCE((item.line->>'base_qty')::numeric, (item.line->>'qty')::numeric)) AS qty FROM sales__sales_order s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.lines, '[]'::jsonb)) AS item(line) WHERE s.tenant_id = $1 AND s.warehouse IS NOT DISTINCT FROM $2 AND s.status IN ('confirmed', 'partially_delivered') AND NULLIF(BTRIM(s.shipping_address), '') IS NOT NULL AND item.line->>'tracked' = 'true' AND item.line->>'product' = $3 AND ($4::uuid IS NULL OR s.id <> $4) GROUP BY s.id) ordered LEFT JOIN LATERAL (SELECT SUM(COALESCE((item.line->>'base_qty')::numeric, (item.line->>'qty')::numeric)) AS qty FROM logistics__shipment shipment CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.delivered_lines, shipment.lines, '[]'::jsonb)) AS item(line) WHERE shipment.tenant_id = $1 AND shipment.source = 'sales_order' AND shipment.source_id = ordered.id::text AND shipment.status = 'delivered' AND item.line->>'tracked' = 'true' AND item.line->>'product' = $3) delivered ON true",
                &[&tenant.id, &warehouse_id, &product_id.to_string(), &fulfilling_order],
            )
            .await?
            .map(|row| decimal_column(&row, 0, "committed quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let (on_hand, held) = if let Some(row) = level.as_ref() {
            (
                decimal_column(row, 1, "on-hand quantity")?,
                optional_decimal_column(row, 3, "held quantity")?,
            )
        } else {
            (Decimal::ZERO, Decimal::ZERO)
        };
        let available = on_hand
            .checked_sub(held)
            .and_then(|value| value.checked_sub(committed))
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec!["Available stock quantity exceeds the supported decimal range".into()],
                )
            })?
            .max(Decimal::ZERO);
        if qty
            > available
                .checked_add(Decimal::new(1, 6))
                .unwrap_or(available)
        {
            return Err(crate::error::ApiError::validation(
                "inventory.stock_move",
                vec![format!(
                    "Outbound movement exceeds uncommitted stock for product {product_id}: requested {qty}, available {available}"
                )],
            ));
        }
    }
    let entity = kernel.ent(tenant, "inventory.stock_level")?;
    let child = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let mut patch = Map::new();
    let on_hand = level
        .as_ref()
        .map(|row| decimal_column(row, 1, "on-hand quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let stock_value = level
        .as_ref()
        .map(|row| optional_decimal_column(row, 2, "stock value"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let held = level
        .as_ref()
        .map(|row| optional_decimal_column(row, 3, "held quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let updated_qty = on_hand.checked_add(delta).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock quantity exceeds the supported decimal range".into()],
        )
    })?;
    let updated_value = stock_value.checked_add(value_delta).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock value exceeds the supported decimal range".into()],
        )
    })?;
    let updated_held = held.checked_add(held_delta).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Held stock quantity exceeds the supported decimal range".into()],
        )
    })?;
    patch.insert("qty".into(), decimal_json(updated_qty)?);
    patch.insert("value".into(), decimal_json(updated_value)?);
    patch.insert("held_qty".into(), decimal_json(updated_held)?);
    if let Some(level) = level {
        let id: Uuid = level.get(0);
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id.to_string(),
                patch,
                &child,
            )
            .await
    } else {
        patch.insert("product".into(), json!(product_id));
        if let Some(warehouse) = warehouse_id {
            patch.insert("warehouse".into(), json!(warehouse));
        }
        kernel
            .create_in(tx, &Actor::System, tenant, &entity, patch, &child)
            .await
    }
}
