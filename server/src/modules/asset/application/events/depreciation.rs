//! Posted depreciation journals and carrying-value updates.
use super::super::shared::{
    account_id, asset_amount_error, decimal_column, decimal_json, line, post_journal,
};
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
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
    let depreciation_id = document.get("id").and_then(Value::as_str).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Posted depreciation requires an id".into()],
        )
    })?;
    let asset_id = document
        .get("asset")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Posted depreciation requires a valid asset".into()],
            )
        })?;
    let amount = document
        .get("amount")
        .and_then(money::decimal)
        .filter(|amount| *amount > Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Depreciation amount must be positive".into()],
            )
        })?;
    let asset = tx
                .query_opt(
                    "SELECT id, cost::text, COALESCE(accumulated_depreciation, 0)::text FROM asset__asset WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &asset_id],
                )
                .await?;
    let Some(asset) = asset else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Depreciated asset was not found for this tenant".into()],
        ));
    };
    let cost = decimal_column(&asset, 1, "cost")?;
    let accumulated = decimal_column(&asset, 2, "accumulated depreciation")?;
    let next_accumulated = accumulated
        .checked_add(amount)
        .ok_or_else(asset_amount_error)?;
    let book_value = cost
        .checked_sub(next_accumulated)
        .ok_or_else(asset_amount_error)?;
    if book_value < -Decimal::new(5, 3) {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Depreciation exceeds the remaining asset basis".into()],
        ));
    }
    let asset_entity = kernel.ent(tenant, "asset.asset")?;
    let mut patch = Map::new();
    patch.insert(
        "book_value".into(),
        decimal_json(book_value.max(Decimal::ZERO))?,
    );
    patch.insert(
        "accumulated_depreciation".into(),
        decimal_json(next_accumulated)?,
    );
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &asset_entity,
            &asset_id.to_string(),
            patch,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    let expense = account_id(tx, tenant, "642").await?;
    let accumulated_account = account_id(tx, tenant, "214").await?;
    post_journal(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Fixed asset depreciation",
        amount,
        "asset_depreciation",
        depreciation_id,
        vec![
            line(expense, amount, Decimal::ZERO)?,
            line(accumulated_account, Decimal::ZERO, amount)?,
        ],
    )
    .await?;
    Ok(true)
}
