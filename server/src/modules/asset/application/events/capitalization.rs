//! Capitalization and opening-balance journals.
use super::super::shared::{account_id, asset_amount_error, line, optional_decimal, post_journal};
use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn handle(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let method = document
        .get("acquisition_method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let offset_code = match (event_type, method) {
        ("asset.asset.activated", "cash") => "111",
        ("asset.asset.activated", "bank") => "112",
        ("asset.asset.activated", "opening_balance")
        | ("asset.asset.opening_balance_recorded", "opening_balance") => "411",
        _ => return Ok(false),
    };
    let id = document.get("id").and_then(Value::as_str).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Asset capitalization requires an id".into()],
        )
    })?;
    let amount = document
        .get("cost")
        .and_then(money::decimal)
        .filter(|amount| *amount > Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Asset capitalization cost must be positive".into()],
            )
        })?;
    if tx
                .query_opt(
                    "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'fixed_asset' AND source_id = $2 LIMIT 1",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Asset already has a capitalization journal entry".into()],
                ));
            }
    let fixed_asset = account_id(tx, tenant, "211").await?;
    let offset = account_id(tx, tenant, offset_code).await?;
    let mut lines = vec![line(fixed_asset, amount, Decimal::ZERO)?];
    if method == "opening_balance" {
        let accumulated =
            optional_decimal(document, "accumulated_depreciation").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Opening accumulated depreciation must be a valid amount".into()],
                )
            })?;
        if accumulated > Decimal::new(5, 3) {
            let accumulated_account = account_id(tx, tenant, "214").await?;
            lines.push(line(accumulated_account, Decimal::ZERO, accumulated)?);
        }
        let net_book_value = amount
            .checked_sub(accumulated)
            .ok_or_else(asset_amount_error)?;
        if net_book_value > Decimal::new(5, 3) {
            lines.push(line(offset, Decimal::ZERO, net_book_value)?);
        }
    } else {
        lines.push(line(offset, Decimal::ZERO, amount)?);
    }
    post_journal(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Fixed asset capitalization",
        amount,
        "fixed_asset",
        id,
        lines,
    )
    .await?;
    Ok(true)
}
