use super::*;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_count",
            vec![format!("Stored stock count {field} is not a valid decimal")],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "inventory.stock_count",
            vec!["Stock count quantity exceeds the supported decimal range".into()],
        )
    })
}

/// Snapshot book quantities at submission and freeze those SKU/warehouse
/// balances until the count is approved, rejected, or cancelled.
pub async fn prepare_stock_count(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(warehouse_id) = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Phiếu kiểm kê cần kho hợp lệ".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &warehouse_id],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Kho kiểm kê không tồn tại trong doanh nghiệp".into()]);
    }
    let count_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or(Uuid::nil());
    let Some(lines) = document
        .get_mut("adjustment_lines")
        .and_then(Value::as_array_mut)
    else {
        return Ok(vec!["Phiếu kiểm kê cần có dòng số lượng thực tế".into()]);
    };
    let mut errors = Vec::new();
    let mut products = lines
        .iter()
        .filter_map(|line| {
            let product = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())?;
            line.get("counted_qty")
                .and_then(money::decimal)
                .filter(|qty| *qty >= Decimal::ZERO)
                .map(|_| product)
        })
        .collect::<Vec<_>>();
    products.sort_unstable();
    products.dedup();
    for product in products {
        let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse_id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM inventory__stock_count sc CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sc.adjustment_lines, '[]'::jsonb)) line WHERE sc.tenant_id = $1 AND sc.warehouse = $2 AND sc.status = 'submitted' AND sc.id <> $3 AND line.value->>'product' = $4 AND line.value ? 'counted_qty' LIMIT 1",
                &[&tenant.id, &warehouse_id, &count_id, &product.to_string()],
            )
            .await?
            .is_some()
        {
            errors.push(format!("Sản phẩm {product} đang có phiếu kiểm kê khác chờ duyệt tại kho này"));
            continue;
        }
        if tx
            .query_opt(
                "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product],
            )
            .await?
            .is_none()
        {
            errors.push(format!("Sản phẩm {product} không thuộc doanh nghiệp"));
            continue;
        }
        let lot_tracked = tx
            .query_opt(
                "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &product],
            )
            .await?
            .map(|row| row.get::<_, bool>(0))
            .unwrap_or(false);
        tx.query_opt(
            "SELECT id FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
            &[&tenant.id, &product, &warehouse_id],
        )
        .await?;
        let expected = tx
            .query_opt(
                "SELECT COALESCE(qty, 0)::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 LIMIT 1",
                &[&tenant.id, &product, &warehouse_id],
            )
            .await?
            .map(|row| decimal_column(&row, 0, "book quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let product_text = product.to_string();
        for line in lines.iter_mut().filter(|line| {
            line.get("product").and_then(Value::as_str) == Some(product_text.as_str())
                && line.get("counted_qty").and_then(money::decimal).is_some()
        }) {
            let location_id = line
                .get("location")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if line.get("location").is_some_and(|value| !value.is_null()) && location_id.is_none() {
                errors.push("Stock count location must be a valid warehouse location id".into());
                continue;
            }
            if let Some(location_id) = location_id
                && tx
                    .query_opt(
                        "SELECT id FROM inventory__warehouse_location WHERE tenant_id = $1 AND id = $2 AND warehouse = $3 AND COALESCE(active, true) = true FOR SHARE",
                        &[&tenant.id, &location_id, &warehouse_id],
                    )
                    .await?
                    .is_none()
            {
                errors.push(format!(
                    "Stock count location {location_id} is inactive or does not belong to the selected warehouse"
                ));
                continue;
            }
            let line_expected = if lot_tracked {
                let Some(lot_id) = line
                    .get("lot")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    errors.push(format!(
                        "Lot-tracked product {product} needs a valid lot on each count line"
                    ));
                    continue;
                };
                if tx
                    .query_opt(
                        "SELECT id FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 FOR SHARE",
                        &[&tenant.id, &lot_id, &product],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!(
                        "Lot on stock count line for product {product} does not belong to this product and company"
                    ));
                    continue;
                }
                let lot_text = lot_id.to_string();
                if let Some(location_id) = location_id {
                    tx.query_opt(
                        "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND lot = $4 AND location = $5",
                        &[&tenant.id, &product, &warehouse_id, &lot_text, &location_id],
                    )
                    .await?
                } else {
                    tx.query_opt(
                        "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND lot = $4 AND location IS NULL",
                        &[&tenant.id, &product, &warehouse_id, &lot_text],
                    )
                    .await?
                }
                .map(|row| decimal_column(&row, 0, "lot quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO)
            } else if let Some(location_id) = location_id {
                tx.query_opt(
                    "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND location = $4",
                    &[&tenant.id, &product, &warehouse_id, &location_id],
                )
                .await?
                .map(|row| decimal_column(&row, 0, "location quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO)
            } else {
                let assigned = tx
                    .query_opt(
                        "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty::numeric ELSE -qty::numeric END), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND location IS NOT NULL",
                        &[&tenant.id, &product, &warehouse_id],
                    )
                    .await?
                    .map(|row| decimal_column(&row, 0, "assigned quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                expected.checked_sub(assigned).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "inventory.stock_count",
                        vec!["Stock count quantity exceeds the supported decimal range".into()],
                    )
                })?
            };
            let counted = line
                .get("counted_qty")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            let variance = counted.checked_sub(line_expected).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "inventory.stock_count",
                    vec!["Stock count variance exceeds the supported decimal range".into()],
                )
            })?;
            if let Some(line) = line.as_object_mut() {
                line.insert("expected_qty".into(), decimal_json(line_expected)?);
                line.insert("variance_qty".into(), decimal_json(variance)?);
            }
        }
    }
    Ok(errors)
}
