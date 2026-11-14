use super::*;

pub async fn handle_transfer_or_count_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let (field, warehouse_field, default_direction, source) = match event_type {
        "inventory.stock_transfer.dispatched" => {
            ("lines", "from_warehouse", Some("out"), "stock_transfer_out")
        }
        "inventory.stock_transfer.received" => {
            ("lines", "to_warehouse", Some("in"), "stock_transfer_in")
        }
        "inventory.stock_count.approved" => ("adjustment_lines", "warehouse", None, "stock_count"),
        _ => return Ok(false),
    };
    let mut lines = document
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let warehouse = document.get(warehouse_field).cloned();
    let source_id = document.get("id").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Inventory source document requires an id".into()],
        )
    })?;
    if event_type == "inventory.stock_transfer.received" {
        let transfer_id = source_id
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Stock transfer requires a valid id".into()],
                )
            })?;
        lines = tx
            .query(
                "SELECT product, qty::text, lot, (total_cost::numeric / NULLIF(qty::numeric, 0))::text, fifo_allocations, transfer_to_location FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'stock_transfer_out' AND source_id = $2 AND direction = 'out' ORDER BY created_at, id",
                &[&tenant.id, &transfer_id.to_string()],
            )
            .await?
            .into_iter()
            .flat_map(|row| {
                let product: Uuid = row.get(0);
                let quantity = row
                    .get::<_, String>(1)
                    .parse::<Decimal>()
                    .unwrap_or(Decimal::ZERO);
                let fallback_lot: Option<String> = row.get(2);
                let fallback_cost: Option<String> = row.get(3);
                let fallback_cost = fallback_cost.and_then(|value| value.parse::<Decimal>().ok());
                let layer_allocations: Option<Value> = row.get(4);
                let transfer_to_location: Option<Uuid> = row.get(5);
                if let Some(allocations) = layer_allocations
                    .and_then(|value| value.as_array().cloned())
                    .filter(|values| !values.is_empty())
                {
                    allocations
                        .into_iter()
                        .filter_map(|allocation| {
                            let qty = money::decimal(allocation.get("qty")?)?;
                            let unit_cost = money::decimal(allocation.get("unit_cost")?)?;
                            let mut line = serde_json::Map::new();
                            line.insert("product".into(), json!(product));
                            line.insert("qty".into(), money::json_number(qty)?);
                            line.insert("unit_cost".into(), money::json_number(unit_cost)?);
                            if let Some(lot) = allocation.get("lot").filter(|value| !value.is_null()) {
                                line.insert("lot".into(), lot.clone());
                            }
                            if let Some(received_at) = allocation.get("received_at") {
                                line.insert("fifo_date".into(), received_at.clone());
                            }
                            if let Some(origin_id) = allocation.get("origin_id") {
                                line.insert("fifo_origin_id".into(), origin_id.clone());
                            }
                            if let Some(location) = transfer_to_location {
                                line.insert("location".into(), json!(location));
                            }
                            Some(Value::Object(line))
                        })
                        .collect::<Vec<_>>()
                } else {
                    let Some(quantity_value) = money::json_number(quantity) else {
                        return Vec::new();
                    };
                    let mut line = serde_json::Map::new();
                    line.insert("product".into(), json!(product));
                    line.insert("qty".into(), quantity_value);
                    if let Some(lot) = fallback_lot {
                        line.insert("lot".into(), json!(lot));
                    }
                    if let Some(unit_cost) = fallback_cost {
                        if let Some(unit_cost) = money::json_number(unit_cost) {
                            line.insert("unit_cost".into(), unit_cost);
                        }
                    }
                    if let Some(location) = transfer_to_location {
                        line.insert("location".into(), json!(location));
                    }
                    vec![Value::Object(line)]
                }
            })
            .collect();
    }
    if event_type == "inventory.stock_count.approved" {
        lines = lines
            .into_iter()
            .filter_map(|line| {
                let Some(counted) = line.get("counted_qty").and_then(money::decimal) else {
                    // Preserve existing adjustment rows while old approvals are completed.
                    return Some(line);
                };
                let expected = line.get("expected_qty").and_then(money::decimal)?;
                let variance = line
                    .get("variance_qty")
                    .and_then(money::decimal)
                    .or_else(|| counted.checked_sub(expected))?;
                if variance.abs() <= Decimal::new(1, 6) {
                    return None;
                }
                let mut adjustment = Map::new();
                adjustment.insert("product".into(), line.get("product")?.clone());
                adjustment.insert("qty".into(), money::json_number(variance.abs())?);
                if let Some(lot) = line.get("lot") {
                    adjustment.insert("lot".into(), lot.clone());
                }
                if let Some(location) = line.get("location") {
                    adjustment.insert("location".into(), location.clone());
                }
                adjustment.insert(
                    "direction".into(),
                    json!(if variance > Decimal::ZERO {
                        "in"
                    } else {
                        "out"
                    }),
                );
                if variance < Decimal::ZERO {
                    adjustment.insert("_include_expired_lots".into(), Value::Bool(true));
                }
                Some(Value::Object(adjustment))
            })
            .collect();
    }
    if event_type == "inventory.stock_transfer.dispatched" {
        for line in &mut lines {
            if let Some(from_location) = line.get("from_location").filter(|value| !value.is_null())
            {
                line["location"] = from_location.clone();
            }
        }
    }
    let entity = kernel.ent(tenant, "inventory.stock_move")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    for line in lines {
        if line.get("product").and_then(Value::as_str).is_none() {
            continue;
        }
        let direction = default_direction
            .or_else(|| line.get("direction").and_then(Value::as_str))
            .unwrap_or_default()
            .to_owned();
        let allocations = if direction == "out" {
            if let Some(warehouse_id) = warehouse
                .as_ref()
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            {
                valuation::allocate_fefo(tx, tenant, warehouse_id, &line).await?
            } else {
                vec![line]
            }
        } else {
            vec![line]
        };
        for allocation in allocations {
            let mut move_data = Map::new();
            for field in [
                "product",
                "qty",
                "lot",
                "location",
                "unit_cost",
                "fifo_date",
                "fifo_origin_id",
            ] {
                if let Some(value) = allocation.get(field) {
                    move_data.insert(field.into(), value.clone());
                }
            }
            if let Some(warehouse) = &warehouse {
                move_data.insert("warehouse".into(), warehouse.clone());
            }
            if source == "stock_transfer_out"
                && let Some(location) = allocation
                    .get("to_location")
                    .filter(|value| !value.is_null())
            {
                move_data.insert("transfer_to_location".into(), location.clone());
            }
            move_data.insert("direction".into(), json!(direction));
            move_data.insert("source".into(), json!(source));
            move_data.insert("source_id".into(), source_id.clone());
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, move_data, &opts)
                .await?;
        }
    }
    Ok(true)
}
