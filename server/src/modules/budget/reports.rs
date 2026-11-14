//! Budget-versus-actual read model sourced from Rust-maintained ledger actuals.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Default)]
struct PeriodTotals {
    expense_planned: Decimal,
    expense_actual: Decimal,
    revenue_planned: Decimal,
    revenue_actual: Decimal,
    unfavorable_lines: usize,
    line_count: usize,
}

fn decimal_field(document: &Value, field: &str) -> R<Decimal> {
    document.get(field).and_then(money::decimal).ok_or_else(|| {
        ApiError::validation(
            "budget.report",
            vec![format!("Report field {field} is not a valid decimal value")],
        )
    })
}

fn checked_add(left: Decimal, right: Decimal, field: &str) -> R<Decimal> {
    left.checked_add(right).ok_or_else(|| {
        ApiError::validation(
            "budget.report",
            vec![format!(
                "Report total {field} exceeds the supported decimal range"
            )],
        )
    })
}

fn checked_sub(left: Decimal, right: Decimal, field: &str) -> R<Decimal> {
    left.checked_sub(right).ok_or_else(|| {
        ApiError::validation(
            "budget.report",
            vec![format!(
                "Report variance {field} exceeds the supported decimal range"
            )],
        )
    })
}

fn json_decimal(value: Decimal, field: &str) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        ApiError::validation(
            "budget.report",
            vec![format!(
                "Report field {field} exceeds the supported decimal range"
            )],
        )
    })
}

fn json_optional_decimal(value: Option<Decimal>, field: &str) -> R<Value> {
    value
        .map(|value| json_decimal(value, field))
        .unwrap_or(Ok(Value::Null))
}

impl Kernel {
    /// Returns approved budget lines with current actuals and favorable variance.
    pub async fn budget_variance_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        period: Option<&str>,
    ) -> R<Value> {
        if !tenant.has_module("budget") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module budget is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "budget.budget.read")?;
        if let Some(period) = period
            && super::domain::period_end(period).is_none()
        {
            return Err(ApiError::new(
                422,
                "INVALID_PERIOD",
                "period must use YYYY or YYYY-MM",
            ));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let mut lines = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'budgetId', b.id, 'budget', b.name, 'period', b.period, 'budgetStatus', b.status, \
                   'lineId', bl.id, 'accountId', account.id, 'accountCode', account.code, 'account', account.name, 'accountKind', account.kind, \
                   'departmentId', department.id, 'department', department.name, \
                   'planned', bl.planned, 'actual', COALESCE(bl.actual, 0) \
                 ) FROM budget__budget b \
                 JOIN budget__budget_line bl ON bl.tenant_id = b.tenant_id AND bl.budget = b.id \
                 JOIN accounting__account account ON account.tenant_id = bl.tenant_id AND account.id = bl.account \
                 LEFT JOIN hrm__department department ON department.tenant_id = bl.tenant_id AND department.id = bl.department \
                 WHERE b.tenant_id = $1 AND b.status IN ('approved', 'closed') \
                   AND ($2::text IS NULL OR b.period = $2) \
                 ORDER BY b.period, b.name, department.name NULLS FIRST, account.code, bl.id",
                &[&tenant.id, &period],
            )
            .await?;
        let mut planned_total = Decimal::ZERO;
        let mut actual_total = Decimal::ZERO;
        let mut expense_planned_total = Decimal::ZERO;
        let mut expense_actual_total = Decimal::ZERO;
        let mut revenue_planned_total = Decimal::ZERO;
        let mut revenue_actual_total = Decimal::ZERO;
        let mut over_budget_lines = 0;
        let mut period_totals = BTreeMap::<String, PeriodTotals>::new();
        for line in &mut lines {
            let planned = decimal_field(line, "planned")?;
            let actual = decimal_field(line, "actual")?;
            let period_key = line
                .get("period")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "budget.report",
                        vec!["Budget report line has no period".into()],
                    )
                })?
                .to_owned();
            let account_kind =
                line.get("accountKind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        ApiError::validation(
                            "budget.report",
                            vec!["Budget report line has no account kind".into()],
                        )
                    })?;
            let is_revenue = account_kind == "revenue";
            let variance = if is_revenue {
                checked_sub(actual, planned, "revenue")?
            } else {
                checked_sub(planned, actual, "expense")?
            };
            let utilization = if planned > Decimal::ZERO {
                actual
                    .checked_mul(Decimal::ONE_HUNDRED)
                    .and_then(|value| value.checked_div(planned))
                    .map(|value| {
                        value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                    })
                    .ok_or_else(|| {
                        ApiError::validation(
                            "budget.report",
                            vec!["Budget utilization exceeds the supported decimal range".into()],
                        )
                    })?
            } else {
                Decimal::ZERO
            };
            let object = line.as_object_mut().ok_or_else(|| {
                ApiError::validation(
                    "budget.report",
                    vec!["Budget report returned a malformed line".into()],
                )
            })?;
            object.insert("variance".into(), json_decimal(variance, "variance")?);
            object.insert(
                "utilization".into(),
                json_decimal(utilization, "utilization")?,
            );

            if period.is_some() {
                planned_total = checked_add(planned_total, planned, "planned")?;
                actual_total = checked_add(actual_total, actual, "actual")?;
            }
            if is_revenue {
                if period.is_some() {
                    revenue_planned_total =
                        checked_add(revenue_planned_total, planned, "revenue planned")?;
                    revenue_actual_total =
                        checked_add(revenue_actual_total, actual, "revenue actual")?;
                }
                let totals = period_totals.entry(period_key).or_default();
                totals.revenue_planned =
                    checked_add(totals.revenue_planned, planned, "period revenue planned")?;
                totals.revenue_actual =
                    checked_add(totals.revenue_actual, actual, "period revenue actual")?;
                totals.line_count += 1;
                if variance < Decimal::new(-5, 3) {
                    totals.unfavorable_lines += 1;
                }
            } else {
                if period.is_some() {
                    expense_planned_total =
                        checked_add(expense_planned_total, planned, "expense planned")?;
                    expense_actual_total =
                        checked_add(expense_actual_total, actual, "expense actual")?;
                }
                let totals = period_totals.entry(period_key).or_default();
                totals.expense_planned =
                    checked_add(totals.expense_planned, planned, "period expense planned")?;
                totals.expense_actual =
                    checked_add(totals.expense_actual, actual, "period expense actual")?;
                totals.line_count += 1;
                if variance < Decimal::new(-5, 3) {
                    totals.unfavorable_lines += 1;
                }
            }
            if variance < Decimal::new(-5, 3) {
                over_budget_lines += 1;
            }
        }
        let (planned_total, actual_total, variance_total) = if period.is_some() {
            (
                Some(planned_total),
                Some(actual_total),
                Some(checked_sub(planned_total, actual_total, "total")?),
            )
        } else {
            (None, None, None)
        };
        let (expense_planned_total, expense_actual_total, expense_variance_total) =
            if period.is_some() {
                (
                    Some(expense_planned_total),
                    Some(expense_actual_total),
                    Some(checked_sub(
                        expense_planned_total,
                        expense_actual_total,
                        "expense",
                    )?),
                )
            } else {
                (None, None, None)
            };
        let (revenue_planned_total, revenue_actual_total, revenue_variance_total) =
            if period.is_some() {
                (
                    Some(revenue_planned_total),
                    Some(revenue_actual_total),
                    Some(checked_sub(
                        revenue_actual_total,
                        revenue_planned_total,
                        "revenue",
                    )?),
                )
            } else {
                (None, None, None)
            };
        let period_summaries = period_totals
            .into_iter()
            .map(|(period, totals)| {
                let expense_variance = checked_sub(
                    totals.expense_planned,
                    totals.expense_actual,
                    "period expense",
                )?;
                let revenue_variance = checked_sub(
                    totals.revenue_actual,
                    totals.revenue_planned,
                    "period revenue",
                )?;
                Ok(json!({
                    "period": period,
                    "lineCount": totals.line_count,
                    "unfavorableLines": totals.unfavorable_lines,
                    "expensePlannedTotal": json_decimal(totals.expense_planned, "period expense planned")?,
                    "expenseActualTotal": json_decimal(totals.expense_actual, "period expense actual")?,
                    "expenseVarianceTotal": json_decimal(expense_variance, "period expense variance")?,
                    "revenuePlannedTotal": json_decimal(totals.revenue_planned, "period revenue planned")?,
                    "revenueActualTotal": json_decimal(totals.revenue_actual, "period revenue actual")?,
                    "revenueVarianceTotal": json_decimal(revenue_variance, "period revenue variance")?
                }))
            })
            .collect::<R<Vec<_>>>()?;
        Ok(json!({
            "period": period,
            "lines": lines,
            "periodSummaries": period_summaries,
            "lineCount": lines.len(),
            "overBudgetLines": if period.is_some() { json!(over_budget_lines) } else { Value::Null },
            "unfavorableLines": if period.is_some() { json!(over_budget_lines) } else { Value::Null },
            "plannedTotal": json_optional_decimal(planned_total, "plannedTotal")?,
            "actualTotal": json_optional_decimal(actual_total, "actualTotal")?,
            "varianceTotal": json_optional_decimal(variance_total, "varianceTotal")?,
            "expensePlannedTotal": json_optional_decimal(expense_planned_total, "expensePlannedTotal")?,
            "expenseActualTotal": json_optional_decimal(expense_actual_total, "expenseActualTotal")?,
            "expenseVarianceTotal": json_optional_decimal(expense_variance_total, "expenseVarianceTotal")?,
            "revenuePlannedTotal": json_optional_decimal(revenue_planned_total, "revenuePlannedTotal")?,
            "revenueActualTotal": json_optional_decimal(revenue_actual_total, "revenueActualTotal")?,
            "revenueVarianceTotal": json_optional_decimal(revenue_variance_total, "revenueVarianceTotal")?
        }))
    }
}
