use super::*;

pub async fn handle_source_stock_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    // Direct counter sales issue on confirmation. Shipped orders issue stock
    // one shipment at a time only after a successful delivery.
    if event_type == "sales.sales_order.confirmed"
        && tenant.has_module("logistics")
        && document
            .get("shipping_address")
            .and_then(Value::as_str)
            .is_some_and(|address| !address.trim().is_empty())
    {
        return Ok(false);
    }
    // Completion records delivery progress; each shipment has already issued its
    // own stock. Counter sales have already issued theirs at confirmation.
    if event_type == "sales.sales_order.delivered" {
        return Ok(false);
    }
    let (field, direction, source, tracked_only) = match event_type {
        "sales.sales_order.confirmed" => (Some("lines"), "out", "sales_order", true),
        "logistics.shipment.delivered"
            if document.get("source").and_then(Value::as_str) == Some("sales_order") =>
        {
            (Some("lines"), "out", "sales_order", true)
        }
        "sales.sales_return.received" => (Some("lines"), "in", "sales_return", true),
        "purchasing.purchase_return.dispatched" => (
            Some("lines"),
            "out",
            if document
                .get("inspection")
                .is_some_and(|value| !value.is_null())
            {
                "quality_return"
            } else {
                "purchase_return"
            },
            true,
        ),
        "purchasing.purchase_receipt.received" => (Some("lines"), "in", "purchase_receipt", true),
        "pos.pos_order.completed" => (Some("lines"), "out", "pos_order", true),
        "pos.pos_order.refunded" => (Some("lines"), "in", "pos_order_refund", true),
        "pos.pos_return.received" => (Some("lines"), "in", "pos_return", true),
        "field-service.work_order.done" => (Some("lines"), "out", "work_order", true),
        "restaurant.table_order.completed" => (Some("consumptions"), "out", "table_order", true),
        "auto-service.repair_order.completed" => (Some("lines"), "out", "repair_order", true),
        "clinic.prescription.dispensed" => (Some("items"), "out", "prescription", true),
        "maintenance.maintenance_request.done" => (Some("parts"), "out", "maintenance", true),
        "quality.inspection.passed"
            if document.get("source").and_then(Value::as_str) == Some("production_order") =>
        {
            (None, "in", "production_order", false)
        }
        "quality.inspection.passed"
            if document.get("source").and_then(Value::as_str) == Some("production_rework") =>
        {
            (None, "in", "production_rework", false)
        }
        "quality.inspection.passed"
            if document.get("source").and_then(Value::as_str) == Some("production_concession") =>
        {
            (None, "in", "production_concession", false)
        }
        "manufacturing.production_order.started" => {
            (Some("$bom"), "out", "production_order_bom", true)
        }
        "manufacturing.rework_order.started" => {
            (Some("$rework_bom"), "out", "production_order_bom", true)
        }
        "agriculture.harvest.created" => (None, "in", "harvest", false),
        "agriculture.input_application.created" => (None, "out", "input_application", false),
        _ => return Ok(false),
    };
    let source_id = document.get("id").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Inventory source document requires an id".into()],
        )
    })?;
    let mut warehouse = document.get("warehouse").cloned();
    let movement_source_id = if event_type == "manufacturing.rework_order.started" {
        document.get("id").cloned().ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Rework order requires its id for material-cost traceability".into()],
            )
        })?
    } else if event_type == "quality.inspection.passed"
        && document.get("source").and_then(Value::as_str) == Some("production_rework")
    {
        document.get("rework_order").cloned().ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Rework inspection requires its rework-order id".into()],
            )
        })?
    } else if event_type == "quality.inspection.passed" {
        document.get("source_id").cloned().ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Production inspection requires its source order id".into()],
            )
        })?
    } else if event_type == "logistics.shipment.delivered" {
        document.get("source_id").cloned().ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Sales shipment requires its source order id".into()],
            )
        })?
    } else {
        source_id.clone()
    };
    let mut lines = if matches!(field, Some("$bom" | "$rework_bom")) {
        let bom_value = if field == Some("$rework_bom") {
            let order_id = document
                .get("production_order")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Rework production-order id must be a valid UUID".into()],
                    )
                })?;
            let order = tx.query_opt(
                "SELECT bom, warehouse FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &order_id],
            ).await?.ok_or_else(|| crate::error::ApiError::validation(
                event_type,
                vec!["Rework source production order was not found".into()],
            ))?;
            let warehouse_id: Uuid = order.get(1);
            warehouse = Some(json!(warehouse_id));
            Some(order.get::<_, Uuid>(0).to_string())
        } else {
            document
                .get("bom")
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        if let Some(bom_value) = bom_value.as_deref() {
            let bom_id = Uuid::parse_str(bom_value).map_err(|_| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Production BOM id must be a valid UUID".into()],
                )
            })?;
            let bom = tx.query_opt(
                "SELECT components, output_qty::text FROM manufacturing__bom WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &bom_id],
            ).await?;
            if let Some(bom) = bom {
                let components: Value = bom.get(0);
                let output_qty: Option<String> = bom.get(1);
                let produced = document
                    .get("qty")
                    .and_then(money::decimal)
                    .filter(|qty| *qty > Decimal::ZERO)
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Production quantity must be positive".into()],
                        )
                    })?;
                let divisor = output_qty
                    .and_then(|value| money::decimal_str(&value))
                    .unwrap_or(Decimal::ZERO);
                if divisor <= Decimal::ZERO {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["BOM output quantity must be positive".into()],
                    ));
                }
                let Some(components) = components.as_array().filter(|rows| !rows.is_empty()) else {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Production BOM must contain item lines before stock can be consumed"
                                .into(),
                        ],
                    ));
                };
                let mut prepared = components
                    .iter()
                    .cloned()
                    .into_iter()
                    .enumerate()
                    .map(|(index, mut line)| -> R<Value> {
                        let product = line
                            .get("product")
                            .and_then(Value::as_str)
                            .and_then(|value| Uuid::parse_str(value).ok());
                        if product.is_none() {
                            return Err(crate::error::ApiError::validation(
                                event_type,
                                vec![format!(
                                    "Production BOM line {} has an invalid product",
                                    index + 1
                                )],
                            ));
                        }
                        let qty = line
                            .get("base_qty")
                            .or_else(|| line.get("qty"))
                            .and_then(money::decimal)
                            .filter(|qty| *qty > Decimal::ZERO)
                            .ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    event_type,
                                    vec![format!(
                                        "Production BOM line {} has an invalid quantity",
                                        index + 1
                                    )],
                                )
                            })?;
                        let scaled = qty
                            .checked_mul(produced)
                            .and_then(|value| value.checked_div(divisor))
                            .ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    event_type,
                                    vec![
                                        "Scaled BOM quantity exceeds the supported decimal range"
                                            .into(),
                                    ],
                                )
                            })?;
                        line["qty"] = money::json_number(scaled).ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec![
                                    "Scaled BOM quantity exceeds the supported decimal range"
                                        .into(),
                                ],
                            )
                        })?;
                        line["base_qty"] = line["qty"].clone();
                        Ok(line)
                    })
                    .collect::<R<Vec<_>>>()?;
                prepared.shrink_to_fit();
                prepared
            } else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Production BOM was not found for this tenant".into()],
                ));
            }
        } else {
            Vec::new()
        }
    } else if let Some(field) = field {
        document
            .get(field)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    } else {
        vec![document.clone()]
    };
    if event_type == "logistics.shipment.delivered"
        && let Some(delivered_lines) = document.get("delivered_lines").and_then(Value::as_array)
    {
        lines = delivered_lines.clone();
    }
    if matches!(
        event_type,
        "sales.sales_return.received" | "purchasing.purchase_return.dispatched"
    ) {
        let (table, fk) = if event_type == "sales.sales_return.received" {
            ("sales__sales_order", "sales_order")
        } else {
            ("purchasing__purchase_order", "purchase_order")
        };
        let id = document
            .get(fk)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(id) = id else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Return movement requires a valid source order".into()],
            ));
        };
        let sql =
            format!("SELECT warehouse FROM {table} WHERE tenant_id = $1 AND id = $2 FOR SHARE");
        let order = tx.query_opt(&sql, &[&tenant.id, &id]).await?;
        let Some(order) = order else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Return source order was not found for this tenant".into()],
            ));
        };
        warehouse = order.get::<_, Option<Uuid>>(0).map(|id| json!(id));
        if warehouse.is_none() {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Return source order has no warehouse".into()],
            ));
        }
    }
    // Keep the previous subscriber filters: operational consumption only
    // moves tracked products; non-operational harvest lines are passed through.
    lines.retain(|line| !tracked_only || line.get("tracked") == Some(&Value::Bool(true)));
    let entity = kernel.ent(tenant, "inventory.stock_move")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let lot_entity = if matches!(source, "harvest" | "purchase_receipt") {
        Some(kernel.ent(tenant, "inventory.lot")?)
    } else {
        None
    };
    let mut refunded_lot_quantities = std::collections::HashMap::<(Uuid, Uuid), Decimal>::new();
    for mut line in lines {
        if let Some(base_qty) = line.get("base_qty").cloned() {
            line["qty"] = base_qty;
        }
        let Some(product) = line
            .get("product")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if source == "harvest"
            && let Ok(product_id) = Uuid::parse_str(&product)
            && tx
                .query_opt(
                    "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product_id],
                )
                .await?
                .is_some_and(|row| row.get::<_, bool>(0))
        {
            let code = line
                .get("lot_code")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Lot-tracked harvests require a lot code".into()],
                    )
                })?;
            let expiry = line
                .get("expiry")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            let lock_key = format!(
                "inventory.harvest-lot:{}:{}:{}",
                tenant.id,
                product_id,
                code.to_ascii_lowercase()
            );
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let lot_id = if let Some(row) = tx
                .query_opt(
                    "SELECT id, expiry::text FROM inventory__lot WHERE tenant_id = $1 AND product = $2 AND lower(btrim(code)) = lower(btrim($3)) FOR SHARE",
                    &[&tenant.id, &product_id, &code],
                )
                .await?
            {
                let existing_expiry: Option<String> = row.get(1);
                if expiry
                    .as_deref()
                    .is_some_and(|value| Some(value) != existing_expiry.as_deref())
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Mã lô thu hoạch đã tồn tại với ngày hết hạn khác".into()],
                    ));
                }
                row.get::<_, Uuid>(0)
            } else {
                let mut lot_data = Map::new();
                lot_data.insert("product".into(), json!(product_id));
                lot_data.insert("code".into(), json!(code));
                if let Some(expiry) = &expiry {
                    lot_data.insert("expiry".into(), json!(expiry));
                }
                let lot = kernel
                    .create_in(
                        tx,
                        &Actor::System,
                        tenant,
                        lot_entity.as_ref().ok_or_else(|| {
                            crate::error::ApiError::internal(
                                "Inventory lot entity is unavailable for a harvest",
                            )
                        })?,
                        lot_data,
                        &opts,
                    )
                    .await?;
                lot.get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok())
                    .ok_or_else(|| {
                        crate::error::ApiError::internal("Created harvest lot has no valid id")
                    })?
            };
            line["lot"] = json!(lot_id);
        }
        if source == "purchase_receipt"
            && let Ok(product_id) = Uuid::parse_str(&product)
            && tx
                .query_opt(
                    "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product_id],
                )
                .await?
                .is_some_and(|row| row.get::<_, bool>(0))
        {
            let code = line
                .get("lot_code")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Lot-tracked receipts require a supplier lot code".into()],
                    )
                })?;
            let expiry = line
                .get("expiry")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            let lock_key = format!("inventory.lot-code:{}:{}:{}", tenant.id, product_id, code);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let lot_id = if let Some(row) = tx
                .query_opt(
                    "SELECT id, expiry::text FROM inventory__lot WHERE tenant_id = $1 AND product = $2 AND code = $3 FOR SHARE",
                    &[&tenant.id, &product_id, &code],
                )
                .await?
            {
                let existing_expiry: Option<String> = row.get(1);
                if expiry
                    .as_deref()
                    .is_some_and(|value| Some(value) != existing_expiry.as_deref())
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Supplier lot code already exists with a different expiry date".into()],
                    ));
                }
                row.get::<_, Uuid>(0)
            } else {
                let mut lot_data = Map::new();
                lot_data.insert("product".into(), json!(product_id));
                lot_data.insert("code".into(), json!(code));
                if let Some(expiry) = &expiry {
                    lot_data.insert("expiry".into(), json!(expiry));
                }
                let lot = kernel
                    .create_in(
                        tx,
                        &Actor::System,
                        tenant,
                        lot_entity.as_ref().ok_or_else(|| {
                            crate::error::ApiError::internal(
                                "Inventory lot entity is unavailable for a purchase receipt",
                            )
                        })?,
                        lot_data,
                        &opts,
                    )
                    .await?;
                lot.get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok())
                    .ok_or_else(|| {
                        crate::error::ApiError::internal("Created receipt lot has no valid id")
                    })?
            };
            line["lot"] = json!(lot_id);
            if let Some(receipt_id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            {
                let lot_id_text = lot_id.to_string();
                tx.execute(
                    "UPDATE purchasing__purchase_receipt AS receipt SET lines = (SELECT jsonb_agg(CASE WHEN item->>'product' = $3 AND btrim(item->>'lot_code') = $4 THEN jsonb_set(item, '{lot}', to_jsonb($5::text), true) ELSE item END) FROM jsonb_array_elements(COALESCE(receipt.lines, '[]'::jsonb)) AS receipt_line(item)) WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &receipt_id, &product, &code, &lot_id_text],
                )
                .await?;
            }
        }
        let line_direction = if source == "stock_count" {
            line.get("direction")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        } else {
            direction.to_owned()
        };
        let line_source_id = if source == "quality_return" {
            document.get("inspection").cloned().ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Quality return requires an inspection id".into()],
                )
            })?
        } else {
            movement_source_id.clone()
        };
        let allocations = if line_direction == "in"
            && matches!(source, "pos_return" | "sales_return")
        {
            if let Some(lot_allocations) = line.get("lot_allocations").and_then(Value::as_array) {
                lot_allocations
                    .iter()
                    .map(|lot_allocation| -> R<Value> {
                        let lot = lot_allocation
                            .get("lot")
                            .and_then(Value::as_str)
                            .ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    event_type,
                                    vec!["Return lot allocation requires a valid lot".into()],
                                )
                            })?;
                        let qty = lot_allocation
                            .get("qty")
                            .and_then(money::decimal)
                            .filter(|qty| *qty > Decimal::ZERO)
                            .ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    event_type,
                                    vec![
                                        "Return lot allocation requires a positive quantity".into(),
                                    ],
                                )
                            })?;
                        let mut allocated = line.clone();
                        let quantity = money::json_number(qty).ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec!["Return lot quantity exceeds the supported range".into()],
                            )
                        })?;
                        allocated["qty"] = quantity.clone();
                        allocated["base_qty"] = quantity;
                        allocated["lot"] = json!(lot);
                        Ok(allocated)
                    })
                    .collect::<R<Vec<_>>>()?
            } else {
                vec![line]
            }
        } else if line_direction == "in" && source == "pos_order_refund" {
            let product_id = Uuid::parse_str(&product).map_err(|_| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["POS refund line requires a valid product id".into()],
                )
            })?;
            let lot_tracked = tx
                .query_opt(
                    "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product_id],
                )
                .await?
                .is_some_and(|row| row.get::<_, bool>(0));
            if !lot_tracked {
                vec![line]
            } else {
                let order_id = movement_source_id.as_str().ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Full POS refund requires its original order id".into()],
                    )
                })?;
                let Some(mut remaining) = line
                    .get("qty")
                    .and_then(money::decimal)
                    .filter(|qty| *qty > Decimal::ZERO)
                else {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Full POS refund requires a positive base quantity".into()],
                    ));
                };
                let sold_lots = tx
                    .query(
                        "SELECT lot::text, SUM(qty::numeric)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'pos_order' AND source_id = $2 AND product = $3 AND direction = 'out' GROUP BY lot ORDER BY lot NULLS LAST",
                        &[&tenant.id, &order_id, &product_id],
                    )
                    .await?;
                let mut restored = Vec::new();
                for row in sold_lots {
                    let lot = row
                        .get::<_, Option<String>>(0)
                        .and_then(|value| Uuid::parse_str(&value).ok())
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec!["Lot-tracked POS refund has a sale line without a valid original lot".into()],
                            )
                        })?;
                    let sold = row
                        .get::<_, String>(1)
                        .parse::<Decimal>()
                        .unwrap_or_default();
                    let key = (product_id, lot);
                    let already_restored = refunded_lot_quantities
                        .get(&key)
                        .copied()
                        .unwrap_or_default();
                    let available = sold.checked_sub(already_restored).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec![
                                "Refunded quantity by lot exceeds its original sale quantity"
                                    .into(),
                            ],
                        )
                    })?;
                    if available < Decimal::ZERO {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec![
                                "Refunded quantity by lot exceeds its original sale quantity"
                                    .into(),
                            ],
                        ));
                    }
                    let allocated = remaining.min(available);
                    if allocated <= Decimal::ZERO {
                        continue;
                    }
                    let updated = already_restored.checked_add(allocated).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["POS refund lot quantity exceeds the supported range".into()],
                        )
                    })?;
                    refunded_lot_quantities.insert(key, updated);
                    remaining = remaining.checked_sub(allocated).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["POS refund lot allocation exceeds the supported range".into()],
                        )
                    })?;
                    let mut allocation = line.clone();
                    let quantity = money::json_number(allocated).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["POS refund lot quantity cannot be serialized".into()],
                        )
                    })?;
                    allocation["qty"] = quantity.clone();
                    allocation["base_qty"] = quantity;
                    allocation["lot"] = json!(lot);
                    restored.push(allocation);
                    if remaining == Decimal::ZERO {
                        break;
                    }
                }
                if remaining > Decimal::ZERO {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Full POS refund quantity exceeds the original lot-tracked sale".into(),
                        ],
                    ));
                }
                restored
            }
        } else if line_direction == "out" && source != "quality_return" {
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
            move_data.insert("product".into(), json!(product));
            if let Some(warehouse) = &warehouse {
                move_data.insert("warehouse".into(), warehouse.clone());
            }
            if let Some(qty) = allocation.get("qty") {
                move_data.insert("qty".into(), qty.clone());
            }
            if let Some(lot) = allocation.get("lot").or_else(|| {
                (source == "harvest")
                    .then(|| allocation.get("lot_code"))
                    .flatten()
            }) {
                move_data.insert("lot".into(), lot.clone());
            }
            if source == "stock_count"
                && let Some(location) = allocation.get("location")
            {
                move_data.insert("location".into(), location.clone());
            }
            if matches!(
                source,
                "purchase_order" | "purchase_receipt" | "purchase_return" | "quality_return"
            ) {
                if let Some(price) = allocation
                    .get("base_price")
                    .or_else(|| allocation.get("price"))
                {
                    move_data.insert("unit_cost".into(), price.clone());
                }
            }
            move_data.insert("direction".into(), json!(line_direction));
            move_data.insert("source".into(), json!(source));
            move_data.insert("source_id".into(), line_source_id.clone());
            if source == "production_concession"
                && let Some(acceptance_id) = allocation.get("conditional_acceptance")
            {
                move_data.insert("conditional_acceptance".into(), acceptance_id.clone());
            }
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, move_data, &opts)
                .await?;
        }
    }
    Ok(true)
}
