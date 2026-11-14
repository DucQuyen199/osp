//! Asset disposal journal and gain/loss accounting.
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
    let id = document.get("id").and_then(Value::as_str).ok_or_else(|| {
        crate::error::ApiError::validation(event_type, vec!["Disposed asset requires an id".into()])
    })?;
    let cost = optional_decimal(document, "cost").ok_or_else(asset_amount_error)?;
    let accumulated =
        optional_decimal(document, "accumulated_depreciation").ok_or_else(asset_amount_error)?;
    let book_value = optional_decimal(document, "book_value").ok_or_else(asset_amount_error)?;
    let proceeds =
        optional_decimal(document, "disposal_proceeds").ok_or_else(asset_amount_error)?;
    let disposal_method = document
        .get("disposal_method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let balanced_book_value = accumulated.checked_add(book_value);
    if cost <= Decimal::ZERO
        || accumulated < Decimal::ZERO
        || book_value < Decimal::ZERO
        || proceeds < Decimal::ZERO
        || !balanced_book_value
            .is_some_and(|sum| money::within_tolerance(sum, cost, Decimal::new(5, 3)))
        || (proceeds > Decimal::ZERO && !matches!(disposal_method, "cash" | "bank"))
    {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Asset cost, accumulated depreciation and book value do not balance".into()],
        ));
    }
    let fixed_asset = account_id(tx, tenant, "211").await?;
    let mut lines = Vec::new();
    if accumulated > Decimal::new(5, 3) {
        let accumulated_account = account_id(tx, tenant, "214").await?;
        lines.push(line(accumulated_account, accumulated, Decimal::ZERO)?);
    }
    if proceeds > Decimal::new(5, 3) {
        let cash_code = match disposal_method {
            "cash" => "111",
            "bank" => "112",
            _ => {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Disposal proceeds require cash or bank method".into()],
                ));
            }
        };
        let cash_account = account_id(tx, tenant, cash_code).await?;
        lines.push(line(cash_account, proceeds, Decimal::ZERO)?);
    }
    let gain = proceeds
        .checked_sub(book_value)
        .ok_or_else(asset_amount_error)?
        .max(Decimal::ZERO);
    let loss = book_value
        .checked_sub(proceeds)
        .ok_or_else(asset_amount_error)?
        .max(Decimal::ZERO);
    if loss > Decimal::new(5, 3) {
        let loss_account = account_id(tx, tenant, "642").await?;
        lines.push(line(loss_account, loss, Decimal::ZERO)?);
    }
    lines.push(line(fixed_asset, Decimal::ZERO, cost)?);
    if gain > Decimal::new(5, 3) {
        let gain_account = account_id(tx, tenant, "711").await?;
        lines.push(line(gain_account, Decimal::ZERO, gain)?);
    }
    post_journal(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Fixed asset disposal",
        cost,
        "fixed_asset_disposal",
        id,
        lines,
    )
    .await?;
    Ok(true)
}
