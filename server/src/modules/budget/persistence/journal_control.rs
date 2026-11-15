//! Optional hard budget control for expense journals.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

type BudgetKey = (Uuid, Option<Uuid>);

fn posting_date(document: &Value, tenant: &Tenant) -> NaiveDate {
    document
        .get("posting_date")
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .unwrap_or_else(|| tenant.business_today())
}

fn period_keys(date: NaiveDate) -> Vec<String> {
    vec![
        date.format("%Y").to_string(),
        date.format("%Y-%m").to_string(),
    ]
}

pub(super) async fn lock_control_period(tx: &Tx<'_>, tenant: &Tenant, period: &str) -> R<()> {
    let year = period.get(..4).unwrap_or(period);
    let mut periods = vec![year.to_owned()];
    if period.len() == 7 {
        periods.push(period.to_owned());
    }
    lock_periods(tx, tenant, &periods).await
}

async fn lock_periods(tx: &Tx<'_>, tenant: &Tenant, periods: &[String]) -> R<()> {
    for period in periods {
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("budget.control:{}:{period}", tenant.id)],
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn validate_journal_posting(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    if !tenant.has_module("budget") || !tenant.setting_bool("enforceBudgetControl") {
        return Ok(Vec::new());
    }
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let date = posting_date(document, tenant);
    let periods = period_keys(date);
    lock_periods(tx, tenant, &periods).await?;

    let mut activity = BTreeMap::<BudgetKey, Decimal>::new();
    for line in lines {
        let Some(account) = line
            .get("account")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let department = line
            .get("department")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let debit = line
            .get("debit")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let credit = line
            .get("credit")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let amount = debit.checked_sub(credit).ok_or_else(|| {
            crate::error::ApiError::validation(
                "budget.control",
                vec!["Journal expense amount exceeds the supported decimal range".into()],
            )
        })?;
        let total = activity
            .get(&(account, department))
            .copied()
            .unwrap_or(Decimal::ZERO)
            .checked_add(amount)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "budget.control",
                    vec!["Journal expense total exceeds the supported decimal range".into()],
                )
            })?;
        activity.insert((account, department), total);
    }

    let active_period = tx
        .query_opt(
            "SELECT 1 FROM budget__budget WHERE tenant_id = $1 AND period = ANY($2) AND status IN ('approved', 'closed') LIMIT 1 FOR SHARE",
            &[&tenant.id, &periods],
        )
        .await?
        .is_some();
    let mut errors = Vec::new();
    for ((account, department), amount) in activity {
        if amount <= Decimal::ZERO {
            continue;
        }
        let account_row = tx
            .query_opt(
                "SELECT code, kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &account],
            )
            .await?;
        let Some(account_row) = account_row else {
            continue;
        };
        let account_code: String = account_row.get(0);
        if account_row.get::<_, String>(1) != "expense" {
            continue;
        }
        if !active_period {
            errors.push(format!(
                "No approved annual or monthly budget covers expense account {account_code} for {}",
                date.format("%Y-%m")
            ));
            continue;
        }

        let rows = tx
            .query(
                "SELECT b.period, bl.planned::text, COALESCE(( \
                   SELECT sum(COALESCE((entry.value->>'debit')::numeric, 0) - COALESCE((entry.value->>'credit')::numeric, 0)) \
                   FROM accounting__journal_entry j \
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.lines, '[]'::jsonb)) AS entry(value) \
                   WHERE j.tenant_id = bl.tenant_id AND j.status IN ('posted', 'reversed') \
                     AND entry.value->>'account' = bl.account::text \
                     AND (entry.value->>'department') IS NOT DISTINCT FROM bl.department::text \
                     AND ((b.period ~ '^[0-9]{4}$' AND to_char(COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 'YYYY') = b.period) \
                       OR (b.period ~ '^[0-9]{4}-[0-9]{2}$' AND to_char(COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM') = b.period)) \
                 ), 0)::text \
                 FROM budget__budget b \
                 JOIN budget__budget_line bl ON bl.tenant_id = b.tenant_id AND bl.budget = b.id \
                 WHERE b.tenant_id = $1 AND b.period = ANY($2) AND b.status IN ('approved', 'closed') \
                   AND bl.account = $3 AND bl.department IS NOT DISTINCT FROM $4 \
                 ORDER BY b.period FOR UPDATE OF b, bl",
                &[&tenant.id, &periods, &account, &department],
            )
            .await?;
        if rows.is_empty() {
            errors.push(format!(
                "Expense account {account_code} has no approved budget allocation for its department in {} or {}",
                periods[0], periods[1]
            ));
            continue;
        }
        for row in rows {
            let period: String = row.get(0);
            let planned_text: String = row.get(1);
            let actual_text: String = row.get(2);
            let planned = money::decimal_str(&planned_text).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "budget.control",
                    vec!["Stored planned budget amount is not a valid decimal".into()],
                )
            })?;
            let actual = money::decimal_str(&actual_text).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "budget.control",
                    vec!["Stored budget actual is not a valid decimal".into()],
                )
            })?;
            let projected = actual.checked_add(amount).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "budget.control",
                    vec!["Projected budget actual exceeds the supported decimal range".into()],
                )
            })?;
            if !money::within_tolerance(projected, planned, Decimal::new(5, 3)) {
                errors.push(format!(
                    "Expense account {account_code} would exceed the {period} budget: {projected} against {planned}"
                ));
            }
        }
    }
    Ok(errors)
}
