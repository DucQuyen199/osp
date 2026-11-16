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
            "production_rework" => {
                if let Some(rework_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "WITH RECURSIVE repair_chain AS ( \
                           SELECT ro.id, ro.inspection, ro.production_order, ro.qty::numeric AS qty \
                           FROM manufacturing__rework_order ro WHERE ro.tenant_id = $1 AND ro.id = $2 \
                           UNION ALL \
                           SELECT prior.id, prior.inspection, prior.production_order, prior.qty::numeric \
                           FROM repair_chain child \
                           JOIN quality__inspection inspected ON inspected.tenant_id = $1 AND inspected.id = child.inspection \
                           JOIN manufacturing__rework_order prior ON prior.tenant_id = $1 AND prior.id::text = inspected.rework_order AND prior.production_order = child.production_order \
                         ), order_context AS ( \
                           SELECT po.id, po.scrap_cost_method, po.qty, COALESCE(po.good_qty, po.qty) AS good_qty \
                           FROM manufacturing__production_order po \
                           JOIN repair_chain current_repair ON current_repair.production_order = po.id \
                           WHERE po.tenant_id = $1 AND current_repair.id = $2 \
                         ), base_cost AS ( \
                           SELECT COALESCE(SUM(sm.total_cost::numeric), 0) AS amount \
                           FROM order_context po \
                           LEFT JOIN inventory__stock_move sm ON sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = po.id::text AND sm.direction = 'out' \
                         ), repair_cost AS ( \
                           SELECT COALESCE(SUM(cost.amount / NULLIF(chain.qty, 0)), 0) AS amount \
                           FROM repair_chain chain \
                           LEFT JOIN LATERAL (SELECT COALESCE(SUM(sm.total_cost::numeric), 0) AS amount FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = chain.id::text AND sm.direction = 'out') cost ON TRUE \
                         ) \
                         SELECT (base_cost.amount / NULLIF(CASE WHEN po.scrap_cost_method = 'expense' THEN po.qty ELSE po.good_qty END::numeric, 0) + repair_cost.amount)::text \
                         FROM order_context po CROSS JOIN base_cost CROSS JOIN repair_cost",
                        &[&tenant.id, &rework_id],
                    ).await? {
                        unit_cost = optional_decimal_column(&row, 0, "reworked production unit cost")?
                            .unwrap_or(standard_cost);
                    }
                }
            }
            "production_concession" => {
                if let (Some(order_id), Some(acceptance_id)) = (
                    source_id,
                    document
                        .get("conditional_acceptance")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok()),
                ) {
                    if let Some(row) = tx.query_opt(
                        "WITH RECURSIVE repair_chain AS ( \
                           SELECT ro.id, ro.inspection, ro.production_order, ro.qty::numeric AS qty \
                           FROM manufacturing__conditional_acceptance ca \
                           JOIN quality__inspection failed ON failed.tenant_id = ca.tenant_id AND failed.id = ca.inspection \
                           JOIN manufacturing__rework_order ro ON ro.tenant_id = failed.tenant_id AND ro.id::text = failed.rework_order \
                           WHERE ca.tenant_id = $1 AND ca.id = $2 \
                           UNION ALL \
                           SELECT prior.id, prior.inspection, prior.production_order, prior.qty::numeric \
                           FROM repair_chain child \
                           JOIN quality__inspection inspected ON inspected.tenant_id = $1 AND inspected.id = child.inspection \
                           JOIN manufacturing__rework_order prior ON prior.tenant_id = $1 AND prior.id::text = inspected.rework_order AND prior.production_order = child.production_order \
                         ) \
                         SELECT (COALESCE((SELECT SUM(sm.total_cost::numeric) FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = po.id::text AND sm.direction = 'out'), 0) / NULLIF(CASE WHEN po.scrap_cost_method = 'expense' THEN po.qty ELSE COALESCE(po.good_qty, po.qty) END::numeric, 0) + COALESCE((SELECT SUM(cost.amount / NULLIF(chain.qty, 0)) FROM repair_chain chain LEFT JOIN LATERAL (SELECT COALESCE(SUM(sm.total_cost::numeric), 0) AS amount FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = chain.id::text AND sm.direction = 'out') cost ON TRUE), 0))::text \
                         FROM manufacturing__production_order po WHERE po.tenant_id = $1 AND po.id = $3",
                        &[&tenant.id, &acceptance_id, &order_id],
                    ).await? {
                        unit_cost = optional_decimal_column(&row, 0, "conditionally accepted production unit cost")?
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
                            "SELECT (SUM(sm.total_cost::numeric) / NULLIF(SUM(sm.qty::numeric), 0))::text FROM inventory__stock_move sm LEFT JOIN pos__pos_return pr ON pr.tenant_id = sm.tenant_id AND pr.id::text = $2 WHERE sm.tenant_id = $1 AND sm.source = 'pos_order' AND sm.source_id = COALESCE(pr.pos_order::text, $2) AND sm.product = $3 AND sm.direction = 'out'",
                            &[&tenant.id, &source_id.to_string(), &product_id],
                        )
                        .await?
                    {
                        let prior = optional_decimal_column(&row, 0, "POS refund unit cost")?;
                        unit_cost = prior.unwrap_or(standard_cost);
                    }
                }
            }
            "pos_return" => {
                if let Some(source_id) = source_id {
                    if let Some(row) = tx.query_opt(
                        "SELECT (SUM(sm.total_cost::numeric) / NULLIF(SUM(sm.qty::numeric), 0))::text FROM inventory__stock_move sm JOIN pos__pos_return pr ON pr.tenant_id = sm.tenant_id AND pr.pos_order::text = sm.source_id WHERE sm.tenant_id = $1 AND pr.id = $2 AND sm.source = 'pos_order' AND sm.product = $3 AND sm.direction = 'out'",
                        &[&tenant.id, &source_id, &product_id],
                    ).await? {
                        let prior = optional_decimal_column(&row, 0, "POS partial-return unit cost")?;
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
            if tenant.setting_str("inventoryCostMethod") == Some("moving_average")
                && on_hand > Decimal::new(1, 6)
            {
                unit_cost = inventory_value
                    .filter(|value| *value >= Decimal::ZERO)
                    .and_then(|value| value.checked_div(on_hand))
                    .filter(|average| *average >= Decimal::ZERO)
                    .unwrap_or(standard_cost);
            } else if let Some(cost) = document.get("unit_cost").and_then(money::decimal) {
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
