//! Tenant-scoped fixed-asset forecasts.
use super::domain::monthly_depreciation;
use crate::{
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
    money,
};
use chrono::{Datelike, Months, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::{Value, json};

fn report_decimal(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        ApiError::validation(
            "asset.depreciation_schedule",
            vec![format!(
                "Stored asset {field} is not a valid decimal amount"
            )],
        )
    })
}

fn report_amount(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        ApiError::validation(
            "asset.depreciation_schedule",
            vec!["Projected asset amount exceeds the supported decimal range".into()],
        )
    })
}

impl Kernel {
    /// Forecast monthly depreciation for active assets without creating documents or journals.
    pub async fn asset_depreciation_schedule(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        months: Option<&str>,
    ) -> R<Value> {
        self.ent(tenant, "asset.asset")?;
        self.authorize(tenant, actor, "asset.asset.read")?;
        let months = match months {
            None => 12,
            Some(value) => value
                .parse::<u32>()
                .ok()
                .filter(|months| (1..=36).contains(months))
                .ok_or_else(|| {
                    ApiError::new(
                        422,
                        "INVALID_HORIZON",
                        "Số tháng dự báo phải nằm trong khoảng 1–36",
                    )
                })?,
        };
        let as_of = Utc::now().date_naive();
        let current_month = NaiveDate::from_ymd_opt(as_of.year(), as_of.month(), 1)
            .ok_or_else(|| ApiError::internal("Invalid current month"))?;
        let first_period = current_month
            .checked_add_months(Months::new(1))
            .ok_or_else(|| ApiError::internal("Depreciation forecast date is out of range"))?;
        let last_period = first_period
            .checked_add_months(Months::new(months - 1))
            .ok_or_else(|| ApiError::internal("Depreciation forecast date is out of range"))?;

        let mut conn = self.pool.get().await?;
        let tx = crate::db::Tx::begin(&mut conn, &tenant.id, false).await?;
        let rows = tx
            .query(
                "SELECT a.id, a.code, a.name, a.cost::text, COALESCE(a.salvage_value, 0)::text, a.useful_life_months::text, a.in_service_date, COALESCE(a.depreciation_method, 'straight_line'), COALESCE(a.declining_balance_factor, 2)::text, COALESCE(a.accumulated_depreciation, 0)::text, a.status, COALESCE((SELECT jsonb_agg(to_char(date_trunc('month', d.period::timestamp), 'YYYY-MM-DD') ORDER BY d.period) FROM asset__depreciation d WHERE d.tenant_id = a.tenant_id AND d.asset = a.id AND d.status = 'draft'), '[]'::jsonb) FROM asset__asset a WHERE a.tenant_id = $1 AND a.status = 'active' ORDER BY a.code, a.id",
                &[&tenant.id],
            )
            .await?;
        let mut assets = Vec::new();
        let mut total_projected = Decimal::ZERO;
        let mut schedule_rows = 0_u64;

        for row in rows {
            let cost = report_decimal(&row, 3, "cost")?;
            let salvage = report_decimal(&row, 4, "salvage value")?;
            let useful_life = report_decimal(&row, 5, "useful life")?;
            let in_service_date: NaiveDate = row.get(6);
            let method: String = row.get(7);
            let factor = report_decimal(&row, 8, "declining balance factor")?;
            let mut accumulated = report_decimal(&row, 9, "accumulated depreciation")?;
            let draft_periods: Vec<String> = row
                .get::<_, Value>(11)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            let depreciable_basis = cost.checked_sub(salvage).ok_or_else(|| {
                ApiError::validation(
                    "asset.depreciation_schedule",
                    vec!["Asset depreciable basis exceeds the supported range".into()],
                )
            })?;
            let maximum_accumulated = depreciable_basis
                .checked_add(Decimal::new(5, 3))
                .ok_or_else(|| {
                    ApiError::validation(
                        "asset.depreciation_schedule",
                        vec!["Asset depreciable basis exceeds the supported range".into()],
                    )
                })?;
            if useful_life < Decimal::ONE
                || useful_life.fract() != Decimal::ZERO
                || cost <= Decimal::ZERO
                || salvage < Decimal::ZERO
                || salvage > cost
                || accumulated < Decimal::ZERO
                || accumulated > maximum_accumulated
            {
                return Err(ApiError::validation(
                    "asset.depreciation_schedule",
                    vec![format!(
                        "Asset {} has inconsistent depreciation data",
                        row.get::<_, String>(1)
                    )],
                ));
            }
            let current_book_value = cost
                .checked_sub(accumulated)
                .ok_or_else(|| ApiError::internal("Asset book value exceeds Decimal range"))?
                .max(Decimal::ZERO);
            let mut projected_total = Decimal::ZERO;
            let mut schedule = Vec::new();

            for offset in 0..months {
                let period = first_period
                    .checked_add_months(Months::new(offset))
                    .ok_or_else(|| {
                        ApiError::internal("Depreciation forecast date is out of range")
                    })?;
                let month_offset = (period.year() - in_service_date.year()) * 12
                    + period.month() as i32
                    - in_service_date.month() as i32;
                if month_offset < 0 {
                    continue;
                }
                if Decimal::from(month_offset) >= useful_life {
                    break;
                }
                let amount = monthly_depreciation(
                    cost,
                    salvage,
                    useful_life,
                    month_offset,
                    accumulated,
                    &method,
                    factor,
                )
                .ok_or_else(|| {
                    ApiError::validation(
                        "asset.depreciation_schedule",
                        vec![format!(
                            "Asset {} has an unsupported depreciation method",
                            row.get::<_, String>(1)
                        )],
                    )
                })?;
                if amount <= Decimal::new(5, 3) {
                    break;
                }
                accumulated = accumulated.checked_add(amount).ok_or_else(|| {
                    ApiError::validation(
                        "asset.depreciation_schedule",
                        vec![
                            "Projected accumulated depreciation exceeds the supported range".into(),
                        ],
                    )
                })?;
                projected_total = projected_total.checked_add(amount).ok_or_else(|| {
                    ApiError::validation(
                        "asset.depreciation_schedule",
                        vec!["Projected depreciation total exceeds the supported range".into()],
                    )
                })?;
                let book_value = cost
                    .checked_sub(accumulated)
                    .ok_or_else(|| {
                        ApiError::internal("Projected book value exceeds Decimal range")
                    })?
                    .max(Decimal::ZERO);
                schedule.push(json!({
                    "period": period,
                    "amount": report_amount(amount)?,
                    "accumulatedDepreciation": report_amount(accumulated)?,
                    "bookValue": report_amount(book_value)?,
                    "draftExists": draft_periods.iter().any(|draft| draft == &period.to_string()),
                }));
            }

            schedule_rows += schedule.len() as u64;
            total_projected = total_projected
                .checked_add(projected_total)
                .ok_or_else(|| {
                    ApiError::validation(
                        "asset.depreciation_schedule",
                        vec!["Projected depreciation total exceeds the supported range".into()],
                    )
                })?;
            assets.push(json!({
                "assetId": row.get::<_, uuid::Uuid>(0),
                "code": row.get::<_, String>(1),
                "name": row.get::<_, String>(2),
                "status": row.get::<_, String>(10),
                "cost": report_amount(cost)?,
                "currentAccumulatedDepreciation": report_amount(report_decimal(&row, 9, "accumulated depreciation")?)?,
                "currentBookValue": report_amount(current_book_value)?,
                "projectedTotal": report_amount(projected_total)?,
                "endingAccumulatedDepreciation": report_amount(accumulated)?,
                "endingBookValue": report_amount(cost.checked_sub(accumulated).ok_or_else(|| ApiError::internal("Projected book value exceeds Decimal range"))?.max(Decimal::ZERO))?,
                "schedule": schedule,
            }));
        }

        Ok(json!({
            "asOf": as_of,
            "from": first_period,
            "to": last_period,
            "months": months,
            "assetCount": assets.len(),
            "scheduleRows": schedule_rows,
            "totalProjected": report_amount(total_projected)?,
            "assets": assets,
        }))
    }
}
