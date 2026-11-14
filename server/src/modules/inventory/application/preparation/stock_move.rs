use super::*;

pub(super) fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec![format!("Stored inventory {field} is not a valid decimal")],
        )
    })
}

pub(super) fn optional_decimal_column(
    row: &tokio_postgres::Row,
    column: usize,
    field: &str,
) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec![format!("Stored inventory {field} is not a valid decimal")],
                )
            })
        })
        .transpose()
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Inventory amount exceeds the supported decimal range".into()],
        )
    })
}

/// Snapshot the tenant's configured cost method on each immutable stock movement.
pub async fn prepare_stock_move(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(product_id) = document
        .get("product")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Phiếu kho cần sản phẩm hợp lệ để tính giá vốn".into()]);
    };
    let qty = document
        .get("qty")
        .and_then(money::decimal)
        .unwrap_or_default();
    let direction = document
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let source = document
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let source_id = document
        .get("source_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let warehouse_id = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if let Some(warehouse_id) = warehouse_id {
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &warehouse_id],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Kho của phiếu kho không tồn tại trong doanh nghiệp".into(),
            ]);
        }
    } else if matches!(
        source.as_str(),
        "purchase_order"
            | "quality_return"
            | "production_order"
            | "production_order_bom"
            | "maintenance"
            | "stock_transfer_out"
            | "stock_transfer_in"
            | "stock_count"
    ) {
        return Ok(vec!["Phiếu kho nghiệp vụ này cần chọn kho hợp lệ".into()]);
    }
    // Serialize every valuation/availability decision for the same SKU and
    // warehouse so concurrent receipts and issues cannot read the same balance.
    let stock_lock = format!(
        "inventory.stock:{}:{}:{}",
        tenant.id,
        product_id,
        warehouse_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "none".into())
    );
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&stock_lock],
    )
    .await?;
    if direction == "out"
        && source == "stock_transfer_out"
        && let (Some(warehouse_id), Some(location_id)) = (
            warehouse_id,
            document
                .get("location")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
        )
    {
        let lot = document.get("lot").and_then(Value::as_str);
        let bin_balance = tx
            .query_opt(
                "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND location = $4 AND lot IS NOT DISTINCT FROM $5",
                &[&tenant.id, &product_id, &warehouse_id, &location_id, &lot],
            )
            .await?
            .map(|row| decimal_column(&row, 0, "bin quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        if bin_balance
            .checked_add(Decimal::new(1, 6))
            .unwrap_or(bin_balance)
            < qty
        {
            return Ok(vec![
                "Selected source location has insufficient quantity for this transfer".into(),
            ]);
        }
    }
    let lot_tracked = tx
        .query_opt(
            "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        )
        .await?
        .map(|row| row.get::<_, bool>(0))
        .unwrap_or(false);
    if source != "stock_count"
        && let Some(warehouse_id) = warehouse_id
        && tx
            .query_opt(
                "SELECT 1 FROM inventory__stock_count sc CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sc.adjustment_lines, '[]'::jsonb)) line WHERE sc.tenant_id = $1 AND sc.warehouse = $2 AND sc.status = 'submitted' AND line.value->>'product' = $3 AND line.value ? 'counted_qty' LIMIT 1",
                &[&tenant.id, &warehouse_id, &product_id.to_string()],
            )
            .await?
            .is_some()
    {
        return Ok(vec![
            "Không thể phát sinh kho cho sản phẩm đang nằm trong phiếu kiểm kê chờ duyệt".into(),
        ]);
    }
    if direction == "out"
        && source != "quality_return"
        && document
            .get("lot")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        if let Some(warehouse_id) = warehouse_id {
            let allocations = valuation::allocate_fefo(
                tx,
                tenant,
                warehouse_id,
                &Value::Object(document.clone()),
            )
            .await?;
            if allocations.len() > 1 {
                return Ok(vec![
                    "This issue spans multiple lots; split it into one stock movement per lot"
                        .into(),
                ]);
            }
            if let Some(lot) = allocations
                .first()
                .and_then(|allocation| allocation.get("lot"))
            {
                document.insert("lot".into(), lot.clone());
            }
        }
    }
    if lot_tracked
        && document
            .get("lot")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
    {
        return Ok(vec![
            "This product is lot-tracked; select a valid lot for the stock movement".into(),
        ]);
    }
    let Some(product) = tx
        .query_opt(
            "SELECT COALESCE(cost, 0)::text FROM master_data__product WHERE tenant_id = $1 AND id = $2",
            &[&tenant.id, &product_id],
        )
        .await?
    else {
        return Ok(vec!["Không tìm thấy sản phẩm trong doanh nghiệp để tính giá vốn".into()]);
    };
    let standard_cost = decimal_column(&product, 0, "standard cost")?;
    let stock_level = tx
        .query_opt(
            "SELECT id, qty::text, value::text, held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse IS NOT DISTINCT FROM $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &product_id, &warehouse_id],
        )
        .await?;
    if let Some(lot_id) = document
        .get("lot")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .and_then(|value| Uuid::parse_str(value).ok())
    {
        let Some(warehouse_id) = warehouse_id else {
            return Ok(vec![
                "Lot-controlled stock movements require a warehouse".into(),
            ]);
        };
        let errors = lot_availability::validate(
            tx,
            tenant,
            product_id,
            warehouse_id,
            lot_id,
            &direction,
            &source,
            qty,
        )
        .await?;
        if !errors.is_empty() {
            return Ok(errors);
        }
    }
    let mut on_hand = Decimal::ZERO;
    let mut held = Decimal::ZERO;
    let mut inventory_value: Option<Decimal> = None;
    if let Some(level) = stock_level {
        let level_id: Uuid = level.get(0);
        on_hand = decimal_column(&level, 1, "on-hand quantity")?;
        inventory_value = optional_decimal_column(&level, 2, "stock value")?;
        held = optional_decimal_column(&level, 3, "held quantity")?.unwrap_or(Decimal::ZERO);
        if level.get::<_, Option<String>>(3).is_none() {
            tx.execute(
                "UPDATE inventory__stock_level SET held_qty = 0 WHERE tenant_id = $1 AND id = $2 AND held_qty IS NULL",
                &[&tenant.id, &level_id],
            )
            .await?;
        }
        if inventory_value.is_none() {
            let opening_value = on_hand.checked_mul(standard_cost).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_move",
                    vec!["Opening inventory value exceeds the supported decimal range".into()],
                )
            })?;
            let opening_value_text = opening_value.normalize().to_string();
            tx.execute(
                "UPDATE inventory__stock_level SET value = $3::text::numeric WHERE tenant_id = $1 AND id = $2 AND value IS NULL",
                &[&tenant.id, &level_id, &opening_value_text],
            )
            .await?;
            inventory_value = Some(opening_value);
        }
    }

    let mut unit_cost = source_cost::resolve_unit_cost(
        tx,
        tenant,
        document,
        product_id,
        source_id,
        &source,
        &direction,
        standard_cost,
        on_hand,
        inventory_value,
    )
    .await?;
    let mut total_cost = unit_cost.checked_mul(qty).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Inventory movement value exceeds the supported decimal range".into()],
        )
    })?;
    if unit_cost < Decimal::ZERO || qty <= Decimal::ZERO || total_cost < Decimal::ZERO {
        return Ok(vec![
            "Giá vốn và số lượng phiếu kho phải là số hữu hạn không âm/dương hợp lệ".into(),
        ]);
    }
    if direction == "out" {
        let insufficient = if source == "quality_return" {
            qty > held.checked_add(Decimal::new(1, 6)).unwrap_or(held)
        } else if tenant.setting_bool("allowNegativeStock") && held <= Decimal::new(1, 6) {
            false
        } else {
            let available = on_hand
                .checked_sub(held)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["Available stock quantity exceeds the supported decimal range".into()],
                    )
                })?
                .max(Decimal::ZERO);
            qty > available
                .checked_add(Decimal::new(1, 6))
                .unwrap_or(available)
        };
        if insufficient {
            return Ok(vec![if source == "quality_return" {
                "Số lượng trả nhà cung cấp vượt lượng hàng đang bị giữ theo phiếu QC".into()
            } else {
                "Không đủ tồn khả dụng sau khi loại trừ hàng đang chờ QC".into()
            }]);
        }
    }
    if direction == "out" && tenant.setting_str("inventoryCostMethod") == Some("fifo") {
        match valuation::fifo_cost_allocations(
            tx,
            tenant,
            product_id,
            warehouse_id,
            document
                .get("lot")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty()),
            qty,
            &source,
        )
        .await
        {
            Ok((fifo_unit_cost, allocations)) => {
                unit_cost = fifo_unit_cost;
                total_cost = fifo_unit_cost.checked_mul(qty).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "inventory.stock_move",
                        vec!["FIFO movement value exceeds the supported decimal range".into()],
                    )
                })?;
                document.insert("fifo_allocations".into(), allocations);
            }
            Err(error) => return Err(error),
        }
    } else {
        document.remove("fifo_allocations");
    }
    if direction == "in" && source != "stock_transfer_in" {
        document.remove("fifo_date");
        document.remove("fifo_origin_id");
    }
    document.insert("unit_cost".into(), decimal_json(unit_cost)?);
    document.insert("total_cost".into(), decimal_json(total_cost)?);
    Ok(Vec::new())
}
