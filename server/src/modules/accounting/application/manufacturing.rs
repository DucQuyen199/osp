use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

use super::{create_posted_journal_decimal, journal_line_decimal};

fn stored_decimal(value: &str, field: &str) -> R<Decimal> {
    money::decimal_str(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec![format!("Stored {field} is not a valid decimal")],
        )
    })
}

/// Expense the material share assigned to abnormal production scrap. Stock
/// issue events must have completed first so the recorded inventory cost is
/// authoritative for this journal.
pub async fn post_abnormal_scrap_cost(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    order: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if order.get("scrap_cost_method").and_then(Value::as_str) != Some("expense") {
        return Ok(false);
    }
    let Some(order_id) = order
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Err(crate::error::ApiError::validation(
            "manufacturing.production_order",
            vec!["Abnormal scrap posting requires a valid production order id".into()],
        ));
    };
    let planned = order
        .get("qty")
        .and_then(money::decimal)
        .filter(|qty| *qty > Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_order",
                vec!["Abnormal scrap posting requires a positive planned quantity".into()],
            )
        })?;
    let scrap = order
        .get("scrap_qty")
        .and_then(money::decimal)
        .filter(|qty| *qty > Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_order",
                vec!["Abnormal scrap posting requires a positive scrap quantity".into()],
            )
        })?;
    let expense_account_id = order
        .get("scrap_expense_account")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_order",
                vec!["Abnormal scrap posting requires an expense account".into()],
            )
        })?;
    let material_cost_row = tx
        .query_one_row(
            "SELECT COALESCE(SUM(total_cost), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'production_order_bom' AND source_id = $2 AND direction = 'out'",
            &[&tenant.id, &order_id.to_string()],
        )
        .await?;
    let material_cost_text: String = material_cost_row.get(0);
    let material_cost = money::decimal_str(&material_cost_text).ok_or_else(|| {
        crate::error::ApiError::validation(
            "manufacturing.production_order",
            vec!["Stored production material cost exceeds the supported decimal range".into()],
        )
    })?;
    let scrap_cost = material_cost
        .checked_mul(scrap)
        .and_then(|value| value.checked_div(planned))
        .map(money::round_money)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_order",
                vec!["Calculated abnormal scrap cost exceeds the supported decimal range".into()],
            )
        })?;
    if scrap_cost < Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "manufacturing.production_order",
            vec!["Calculated abnormal scrap cost is invalid".into()],
        ));
    }
    if scrap_cost <= Decimal::new(5, 3) {
        return Ok(false);
    }
    let expense = tx
        .query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
            &[&tenant.id, &expense_account_id],
        )
        .await?
        .map(|row| row.get::<_, Uuid>(0))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_order",
                vec!["Abnormal scrap account must be an expense account in this tenant".into()],
            )
        })?;
    let wip = tx
        .query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = '154' FOR SHARE",
            &[&tenant.id],
        )
        .await?
        .map(|row| row.get::<_, Uuid>(0))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.journal_entry",
                vec!["Missing work-in-progress account 154".into()],
            )
        })?;
    create_posted_journal_decimal(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Abnormal production scrap expense",
        scrap_cost,
        "production_scrap",
        &order_id.to_string(),
        vec![
            journal_line_decimal(expense, scrap_cost, Decimal::ZERO)?,
            journal_line_decimal(wip, Decimal::ZERO, scrap_cost)?,
        ],
    )
    .await?;
    Ok(true)
}

/// Expense the remaining WIP share for a failed finished-goods quantity that
/// manufacturing has explicitly dispositioned as scrap.
pub async fn post_production_qc_scrap_cost(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    disposition: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let disposition_id = disposition
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Production disposition requires a valid id".into()],
            )
        })?;
    let inspection_id = disposition
        .get("inspection")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Production disposition requires a quality inspection".into()],
            )
        })?;
    let qty = disposition
        .get("qty")
        .and_then(money::decimal)
        .filter(|qty| *qty > Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Production disposition requires a positive quantity".into()],
            )
        })?;
    let expense_id = disposition
        .get("expense_account")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Production disposition requires an expense account".into()],
            )
        })?;
    let inspection = tx
        .query_opt(
            "SELECT source, source_id, status, rework_order FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &inspection_id],
        )
        .await?
        .ok_or_else(|| crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec!["Production inspection was not found".into()],
        ))?;
    let order_id = inspection
        .get::<_, String>(1)
        .parse::<Uuid>()
        .map_err(|_| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Inspection source is not a valid production order".into()],
            )
        })?;
    if inspection.get::<_, String>(2) != "failed"
        || !matches!(
            inspection.get::<_, String>(0).as_str(),
            "production_order" | "production_rework"
        )
    {
        return Err(crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec!["Only failed production inspections can be scrapped".into()],
        ));
    }
    let order = tx
        .query_opt(
            "SELECT qty::text, COALESCE(good_qty, qty)::text, scrap_cost_method, id FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 AND status = 'done' FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?
        .ok_or_else(|| crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec!["Completed production order was not found".into()],
        ))?;
    let planned_qty = stored_decimal(&order.get::<_, String>(0), "production quantity")?;
    let good_qty = stored_decimal(&order.get::<_, String>(1), "accepted production quantity")?;
    if planned_qty <= Decimal::ZERO || good_qty <= Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec!["Production order has no accepted output to disposition".into()],
        ));
    }
    let source = inspection.get::<_, String>(0);
    let unit_cost = if source == "production_order" {
        let row = tx.query_one_row(
            "SELECT (COALESCE(SUM(sm.total_cost::numeric), 0) / NULLIF(CASE WHEN po.scrap_cost_method = 'expense' THEN po.qty ELSE COALESCE(po.good_qty, po.qty) END::numeric, 0))::text FROM manufacturing__production_order po LEFT JOIN inventory__stock_move sm ON sm.tenant_id = po.tenant_id AND sm.source = 'production_order_bom' AND sm.source_id = po.id::text AND sm.direction = 'out' WHERE po.tenant_id = $1 AND po.id = $2 GROUP BY po.scrap_cost_method, po.good_qty, po.qty",
            &[&tenant.id, &order_id],
        ).await?;
        stored_decimal(&row.get::<_, String>(0), "production unit cost")?
    } else {
        let rework_id = inspection
            .get::<_, Option<String>>(3)
            .and_then(|value| Uuid::parse_str(&value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "manufacturing.production_disposition",
                    vec!["Reworked inspection is missing its rework-order link".into()],
                )
            })?;
        let row = tx.query_one_row(
            "WITH RECURSIVE repair_chain AS ( \
               SELECT ro.id, ro.inspection, ro.production_order, ro.qty::numeric AS qty FROM manufacturing__rework_order ro WHERE ro.tenant_id = $1 AND ro.id = $2 \
               UNION ALL \
               SELECT prior.id, prior.inspection, prior.production_order, prior.qty::numeric FROM repair_chain child JOIN quality__inspection inspected ON inspected.tenant_id = $1 AND inspected.id = child.inspection JOIN manufacturing__rework_order prior ON prior.tenant_id = $1 AND prior.id::text = inspected.rework_order AND prior.production_order = child.production_order \
             ), order_context AS (SELECT po.id, po.scrap_cost_method, po.qty, COALESCE(po.good_qty, po.qty) AS good_qty FROM manufacturing__production_order po JOIN repair_chain current_repair ON current_repair.production_order = po.id WHERE po.tenant_id = $1 AND current_repair.id = $2), \
             base_cost AS (SELECT COALESCE(SUM(sm.total_cost::numeric), 0) AS amount FROM order_context po LEFT JOIN inventory__stock_move sm ON sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = po.id::text AND sm.direction = 'out'), \
             repair_cost AS (SELECT COALESCE(SUM(cost.amount / NULLIF(chain.qty, 0)), 0) AS amount FROM repair_chain chain LEFT JOIN LATERAL (SELECT COALESCE(SUM(sm.total_cost::numeric), 0) AS amount FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.source = 'production_order_bom' AND sm.source_id = chain.id::text AND sm.direction = 'out') cost ON TRUE) \
             SELECT (base_cost.amount / NULLIF(CASE WHEN po.scrap_cost_method = 'expense' THEN po.qty ELSE po.good_qty END::numeric, 0) + repair_cost.amount)::text FROM order_context po CROSS JOIN base_cost CROSS JOIN repair_cost",
            &[&tenant.id, &rework_id],
        ).await?;
        stored_decimal(&row.get::<_, String>(0), "reworked production unit cost")?
    };
    let amount = unit_cost
        .checked_mul(qty)
        .map(money::round_money)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "manufacturing.production_disposition",
                vec!["Calculated scrap cost exceeds the supported financial range".into()],
            )
        })?;
    if amount < Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "manufacturing.production_disposition",
            vec!["Calculated scrap cost cannot be negative".into()],
        ));
    }
    if amount <= Decimal::new(5, 3) {
        return Ok(false);
    }
    let expense = tx.query_opt(
        "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
        &[&tenant.id, &expense_id],
    ).await?.map(|row| row.get::<_, Uuid>(0)).ok_or_else(|| crate::error::ApiError::validation(
        "manufacturing.production_disposition",
        vec!["Scrap account must be an expense account in this tenant".into()],
    ))?;
    let wip = tx
        .query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = '154' FOR SHARE",
            &[&tenant.id],
        )
        .await?
        .map(|row| row.get::<_, Uuid>(0))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.journal_entry",
                vec!["Missing work-in-progress account 154".into()],
            )
        })?;
    let note = disposition
        .get("note")
        .and_then(Value::as_str)
        .unwrap_or("Production QC scrap");
    create_posted_journal_decimal(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        note,
        amount,
        "production_qc_scrap",
        &disposition_id.to_string(),
        vec![
            journal_line_decimal(expense, amount, Decimal::ZERO)?,
            journal_line_decimal(wip, Decimal::ZERO, amount)?,
        ],
    )
    .await?;
    Ok(true)
}
