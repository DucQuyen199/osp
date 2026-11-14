//! Monthly depreciation document preparation.
use super::super::{
    domain::{date, monthly_depreciation},
    persistence,
};
use super::shared::{asset_amount_error, decimal_column, decimal_json};
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn prepare_depreciation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(asset_id) = document
        .get("asset")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Depreciation requires a valid asset".into()]);
    };
    let Some(period) = date(&Value::Object(document.clone()), "period") else {
        return Ok(vec!["Depreciation period must be a valid date".into()]);
    };
    if !persistence::lock_asset_financial(tx, tenant, asset_id).await? {
        return Ok(vec!["Asset was not found for this tenant".into()]);
    }
    let Some(row) = tx
        .query_opt(
            "SELECT cost::text, COALESCE(salvage_value, 0)::text, useful_life_months::text, in_service_date, status, COALESCE(depreciation_method, 'straight_line'), COALESCE(declining_balance_factor, 2)::text, COALESCE(accumulated_depreciation, 0)::text FROM asset__asset WHERE tenant_id = $1 AND id = $2",
            &[&tenant.id, &asset_id],
        )
        .await?
    else {
        return Ok(vec!["Asset was not found for this tenant".into()]);
    };
    let cost = decimal_column(&row, 0, "cost")?;
    let salvage = decimal_column(&row, 1, "salvage value")?;
    let life = decimal_column(&row, 2, "useful life")?;
    let service_date: NaiveDate = row.get(3);
    let status: String = row.get(4);
    let method: String = row.get(5);
    let declining_factor = decimal_column(&row, 6, "declining balance factor")?;
    let accumulated = decimal_column(&row, 7, "accumulated depreciation")?;
    if status != "active" {
        return Ok(vec![
            "Depreciation can only be prepared for active assets".into(),
        ]);
    }
    if life < Decimal::ONE || life.fract() != Decimal::ZERO {
        return Ok(vec![
            "Asset useful life must be a positive whole number of months".into(),
        ]);
    }
    let month_offset = (period.year() - service_date.year()) * 12
        + i32::from(period.month() as u16)
        - i32::from(service_date.month() as u16);
    if month_offset < 0 || Decimal::from(month_offset) >= life {
        return Ok(vec![
            "Depreciation period must fall within the asset useful life".into(),
        ]);
    }
    let month_start = NaiveDate::from_ymd_opt(period.year(), period.month(), 1)
        .ok_or_else(|| crate::error::ApiError::internal("Invalid depreciation period"))?;
    if tx
        .query_opt(
            "SELECT 1 FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND date_trunc('month', period::timestamp)::date = $3 LIMIT 1",
            &[&tenant.id, &asset_id, &month_start],
        )
        .await?
        .is_some()
    {
        return Ok(vec!["An asset depreciation record already exists for this month".into()]);
    }

    let amount = monthly_depreciation(
        cost,
        salvage,
        life,
        month_offset,
        accumulated,
        &method,
        declining_factor,
    )
    .ok_or_else(asset_amount_error)?;
    if amount <= Decimal::new(5, 3) {
        return Ok(vec!["The asset has no remaining depreciable basis".into()]);
    }
    document.insert("amount".into(), decimal_json(amount)?);
    Ok(Vec::new())
}
