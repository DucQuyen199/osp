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
