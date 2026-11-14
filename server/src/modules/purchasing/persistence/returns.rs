//! Purchase-return source, inspection, and cumulative-quantity checks.
use super::{decimal_column, purchasing_quantity_error};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

pub(super) async fn validate_return_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(order_id) = document
        .get("purchase_order")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec![
            "Purchase return requires a valid purchase order".into(),
        ]);
    };
    let inspection_id = document
        .get("inspection")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    // Keep the same inspection -> order -> SKU lock order as QC decisions.
    let inspection_record = if let Some(inspection_id) = inspection_id {
        tx.query_opt(
            "SELECT product, status, source, source_id, qty::text, unit_cost::text, warehouse, lot FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &inspection_id],
        )
        .await?
    } else {
        None
    };
    let order = tx
        .query_opt(
            "SELECT status, warehouse, lines FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?;
    let Some(order) = order else {
        return Ok(vec![
            "Source purchase order was not found for this tenant".into(),
        ]);
    };
    let status: String = order.get(0);
    let order_warehouse: Option<Uuid> = order.get(1);
    let order_lines: Value = order.get(2);
    let mut errors = Vec::new();
    if status != "received" {
        errors.push("Returns can only be created from a received purchase order".into());
    }
    let return_warehouse = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    if return_warehouse != order_warehouse {
        errors.push("Return warehouse must match the purchase order receiving warehouse".into());
    }
    let bought_lines = order_lines.as_array().cloned().unwrap_or_default();
    let return_lines = document
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(inspection_id) = inspection_id {
        let Some(inspection) = inspection_record else {
            errors.push("The linked quality inspection was not found".into());
            return Ok(errors);
        };
        let inspected_product: Uuid = inspection.get(0);
        let inspection_status: String = inspection.get(1);
        let inspection_source: String = inspection.get(2);
        let inspection_source_id: String = inspection.get(3);
        let inspected_qty_text: String = inspection.get(4);
        let inspected_qty = money::decimal_str(&inspected_qty_text).ok_or_else(|| {
            crate::error::ApiError::validation(
                "purchasing.return",
                vec!["Inspected quantity is not a valid decimal amount".into()],
            )
        })?;
        let prior_disposition_row = tx
            .query_opt(
                "SELECT COALESCE(SUM(qty), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                &[&tenant.id, &inspection_id],
            )
            .await?;
        let prior_dispositions = prior_disposition_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "prior inspection dispositions"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let inspected_cost = inspection
            .get::<_, Option<String>>(5)
            .as_deref()
            .and_then(money::decimal_str);
        let inspection_warehouse: Option<Uuid> = inspection.get(6);
        let inspection_lot: Option<Uuid> = inspection.get(7);
        let mut requested_inspection_qty = Decimal::ZERO;
        let mut all_lines_match = true;
        for line in &return_lines {
            let product_matches = line.get("product").and_then(Value::as_str)
                == Some(inspected_product.to_string().as_str());
            let cost_matches = line
                .get("price")
                .and_then(money::decimal)
                .zip(inspected_cost)
                .is_some_and(|(price, cost)| {
                    money::within_tolerance(price, cost, Decimal::new(5, 3))
                });
            let lot_matches = line.get("lot").and_then(Value::as_str)
                == inspection_lot.map(|id| id.to_string()).as_deref();
            if !(product_matches && cost_matches && lot_matches) {
                all_lines_match = false;
            } else {
                requested_inspection_qty = requested_inspection_qty
                    .checked_add(
                        line.get("qty")
                            .and_then(money::decimal)
                            .unwrap_or(Decimal::ZERO),
                    )
                    .ok_or_else(purchasing_quantity_error)?;
            }
        }
        let inspection_matches_order = if inspection_source == "purchase_order" {
            inspection_source_id == order_id.to_string()
        } else if inspection_source == "purchase_receipt" {
            let receipt_id = Uuid::parse_str(&inspection_source_id).unwrap_or_default();
            tx.query_opt(
                "SELECT id FROM purchasing__purchase_receipt WHERE tenant_id = $1 AND id = $2 AND purchase_order = $3",
                &[&tenant.id, &receipt_id, &order_id],
            )
            .await?
            .is_some()
        } else {
            false
        };
        if inspection_status != "failed"
            || !inspection_matches_order
            || inspection_warehouse != return_warehouse
            || inspection_warehouse != order_warehouse
        {
            errors.push(
                "The linked failed inspection must belong to the same purchase order and warehouse"
                    .into(),
            );
        }
        if requested_inspection_qty <= Decimal::ZERO || !all_lines_match {
            errors
                .push("Return lines must match the failed inspection product, cost and lot".into());
        }
        let current_return_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .unwrap_or_default();
        let prior_inspection_returns_row = tx
            .query_opt(
                "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM purchasing__purchase_return pr CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.lines, '[]'::jsonb)) AS item(line) WHERE pr.tenant_id = $1 AND pr.inspection = $2 AND pr.id <> $3 AND pr.status IN ('submitted', 'approved', 'dispatched')",
                &[&tenant.id, &inspection_id, &current_return_id],
            )
            .await?;
        let prior_inspection_returns = prior_inspection_returns_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "prior inspection return quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let total_inspection_disposition = prior_inspection_returns
            .checked_add(requested_inspection_qty)
            .and_then(|quantity| quantity.checked_add(prior_dispositions))
            .ok_or_else(purchasing_quantity_error)?;
        if inspected_qty
            .checked_add(Decimal::new(1, 6))
            .is_none_or(|maximum| total_inspection_disposition > maximum)
        {
            errors.push("Return quantity exceeds the failed inspection quantity".into());
        }
        if action == "dispatched" {
            let lock_key = format!(
                "inventory.stock:{}:{}:{}",
                tenant.id,
                inspected_product,
                return_warehouse
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "none".into())
            );
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
        }
    }

    let mut requested: HashMap<(String, Decimal), Decimal> = HashMap::new();
    for line in &return_lines {
        let Some(product) = line.get("product").and_then(Value::as_str) else {
            continue;
        };
        let Some(price) = line.get("price").and_then(money::decimal) else {
            continue;
        };
        let Some(qty) = line.get("qty").and_then(money::decimal) else {
            continue;
        };
        let requested_qty = requested
            .entry((product.to_string(), price))
            .or_insert(Decimal::ZERO);
        *requested_qty = requested_qty
            .checked_add(qty)
            .ok_or_else(purchasing_quantity_error)?;
    }
    let Some(return_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Could not identify the purchase return record".into()]);
    };
    for ((product, price), return_qty) in requested {
        let mut bought_qty = Decimal::ZERO;
        for line in &bought_lines {
            if line.get("product").and_then(Value::as_str) == Some(product.as_str())
                && line
                    .get("price")
                    .and_then(money::decimal)
                    .is_some_and(|bought_price| {
                        money::within_tolerance(bought_price, price, Decimal::new(5, 3))
                    })
            {
                bought_qty = bought_qty
                    .checked_add(
                        line.get("qty")
                            .and_then(money::decimal)
                            .unwrap_or(Decimal::ZERO),
                    )
                    .ok_or_else(purchasing_quantity_error)?;
            }
        }
        if bought_qty == Decimal::ZERO {
            errors.push(format!(
                "Product {product} at price {price} is not present in the source purchase order"
            ));
            continue;
        }
        let price_text = price.normalize().to_string();
        let prior_row = tx
            .query_opt(
                "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM purchasing__purchase_return pr CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.lines, '[]'::jsonb)) AS item(line) WHERE pr.tenant_id = $1 AND pr.purchase_order = $2 AND pr.id <> $3 AND pr.status IN ('submitted', 'approved', 'dispatched') AND item.line->>'product' = $4 AND abs((item.line->>'price')::numeric - $5::text::numeric) <= 0.005",
                &[&tenant.id, &order_id, &return_id, &product, &price_text],
            )
            .await?;
        let prior = prior_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "prior purchase return quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        if prior
            .checked_add(return_qty)
            .zip(bought_qty.checked_add(Decimal::new(1, 6)))
            .is_none_or(|(returned, maximum)| returned > maximum)
        {
            let remaining = bought_qty
                .checked_sub(prior)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            errors.push(format!(
                "Return quantity for {product} exceeds the remaining received quantity ({remaining})"
            ));
        }
    }
    if action == "approved" && tenant.has_module("workflow-approval") {
        let approved = tx
            .query_opt(
                "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'purchasing.purchase_return' AND record_id = $2 AND status = 'approved' LIMIT 1",
                &[&tenant.id, &return_id.to_string()],
            )
            .await?
            .is_some();
        if !approved {
            errors.push(
                "Purchase return approval requires an approved shared workflow request".into(),
            );
        }
    }
    Ok(errors)
}
