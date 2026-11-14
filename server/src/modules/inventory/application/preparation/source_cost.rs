use super::stock_move::{decimal_column, optional_decimal_column};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

pub(super) async fn resolve_unit_cost(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Map<String, Value>,
    product_id: Uuid,
    source_id: Option<Uuid>,
    source: &str,
    direction: &str,
    standard_cost: Decimal,
    on_hand: Decimal,
    inventory_value: Option<Decimal>,
) -> R<Decimal> {
    let mut unit_cost = standard_cost;
    if direction == "in" {
        match source {
            "production_order" => {
                if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (SUM(sm.total_cost::numeric) / NULLIF(CASE WHEN po.scrap_cost_method = 'expense' THEN po.qty ELSE COALESCE(po.good_qty, po.qty) END::numeric, 0))::text FROM manufacturing__production_order po LEFT JOIN inventory__stock_move sm ON sm.tenant_id = po.tenant_id AND sm.source = 'production_order_bom' AND sm.source_id = po.id::text AND sm.direction = 'out' WHERE po.tenant_id = $1 AND po.id = $2 GROUP BY po.scrap_cost_method, po.good_qty, po.qty",
                        &[&tenant.id, &source_id],
                    ).await? {
                        unit_cost = optional_decimal_column(&row, 0, "production unit cost")?
                            .unwrap_or(standard_cost);
                    }
                }
            }
            "purchase_order_qc" => {
                if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                    unit_cost = cost;
                }
            }
            "purchase_receipt" => {
                if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                    unit_cost = cost;
                } else if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (line->>'price')::numeric::text FROM purchasing__purchase_receipt r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) line WHERE r.tenant_id = $1 AND r.id = $2 AND line->>'product' = $3 LIMIT 1",
                        &[&tenant.id, &source_id, &product_id.to_string()],
                    ).await? {
                        unit_cost = decimal_column(&row, 0, "receipt unit cost")?;
                    }
                }
            }
            "purchase_order" => {
                if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                    unit_cost = cost;
                } else if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (line->>'price')::numeric::text FROM purchasing__purchase_order p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.lines, '[]'::jsonb)) line WHERE p.tenant_id = $1 AND p.id = $2 AND line->>'product' = $3 LIMIT 1",
                        &[&tenant.id, &source_id, &product_id.to_string()],
                    ).await? {
                        unit_cost = decimal_column(&row, 0, "purchase unit cost")?;
                    }
                }
            }
            "stock_transfer_in" => {
                if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                    unit_cost = cost;
                } else if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (SUM(total_cost::numeric) / NULLIF(SUM(qty::numeric), 0))::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'stock_transfer_out' AND source_id = $2 AND product = $3 AND direction = 'out'",
                        &[&tenant.id, &source_id.to_string(), &product_id],
                    ).await? {
                        let prior = optional_decimal_column(&row, 0, "transfer unit cost")?;
                        unit_cost = prior.unwrap_or(standard_cost);
                    }
                }
            }
            "sales_return" => {
                if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (SUM(sm.total_cost::numeric) / NULLIF(SUM(sm.qty::numeric), 0))::text FROM sales__sales_return sr JOIN inventory__stock_move sm ON sm.tenant_id = sr.tenant_id AND sm.source = 'sales_order' AND sm.source_id = sr.sales_order::text WHERE sr.tenant_id = $1 AND sr.id = $2 AND sm.product = $3 AND sm.direction = 'out'",
                        &[&tenant.id, &source_id, &product_id],
                    ).await? {
                        let prior = optional_decimal_column(&row, 0, "sales return unit cost")?;
                        unit_cost = prior.unwrap_or(standard_cost);
                    }
                }
            }
            "pos_order_refund" => {
                if let Some(source_id) = source_id {
                    if let Some(row) = tx
                        .query_opt(
                            "SELECT (SUM(total_cost::numeric) / NULLIF(SUM(qty::numeric), 0))::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'pos_order' AND source_id = $2 AND product = $3 AND direction = 'out'",
                            &[&tenant.id, &source_id.to_string(), &product_id],
                        )
                        .await?
                    {
                        let prior = optional_decimal_column(&row, 0, "POS refund unit cost")?;
                        unit_cost = prior.unwrap_or(standard_cost);
                    }
                }
            }
            "stock_count" if on_hand > Decimal::new(1, 6) => {
                unit_cost = inventory_value
                    .filter(|value| *value >= Decimal::ZERO)
                    .and_then(|value| value.checked_div(on_hand))
                    .filter(|average| *average >= Decimal::ZERO)
                    .unwrap_or(standard_cost);
            }
            _ => {}
        }
    } else if direction == "out" {
        if source == "purchase_return" {
            if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                unit_cost = cost;
            } else if let Some(source_id) = source_id {
                if let Some(row) = tx
                    .query_opt(
                        "SELECT (line->>'price')::numeric::text FROM purchasing__purchase_return r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) line WHERE r.tenant_id = $1 AND r.id = $2 AND line->>'product' = $3 LIMIT 1",
                        &[&tenant.id, &source_id, &product_id.to_string()],
                    )
                    .await?
                {
                    unit_cost = decimal_column(&row, 0, "purchase return unit cost")?;
                }
            }
        } else if source == "quality_return" {
            if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
                unit_cost = cost;
            }
        } else if on_hand > Decimal::new(1, 6) {
            unit_cost = inventory_value
                .filter(|value| *value >= Decimal::ZERO)
                .and_then(|value| value.checked_div(on_hand))
                .filter(|average| *average >= Decimal::ZERO)
                .unwrap_or(standard_cost);
        }
    }
    Ok(unit_cost)
}
