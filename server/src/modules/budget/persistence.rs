//! Tenant-scoped budget checks and row locking.
use super::domain::{amount, budget_id, period_end};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

mod journal_control;

pub async fn refresh_actuals(tx: &Tx<'_>, tenant: &Tenant) -> R<()> {
    tx.execute(
        "UPDATE budget__budget_line bl SET actual = COALESCE((
            SELECT SUM(CASE WHEN budget_account.kind = 'revenue'
                       THEN COALESCE((line.value->>'credit')::numeric, 0) - COALESCE((line.value->>'debit')::numeric, 0)
                       ELSE COALESCE((line.value->>'debit')::numeric, 0) - COALESCE((line.value->>'credit')::numeric, 0) END)
            FROM accounting__journal_entry j
            CROSS JOIN LATERAL jsonb_array_elements(j.lines) AS line(value)
            JOIN accounting__account budget_account ON budget_account.tenant_id = j.tenant_id AND budget_account.id::text = line.value->>'account'
            JOIN budget__budget b ON b.tenant_id = bl.tenant_id AND b.id = bl.budget
            WHERE j.tenant_id = bl.tenant_id AND j.status IN ('posted', 'reversed')
              AND line.value->>'account' = bl.account::text
              AND budget_account.kind IN ('expense', 'revenue')
              AND (line.value->>'department') IS NOT DISTINCT FROM bl.department::text
              AND b.status IN ('approved', 'closed')
              AND ((b.period ~ '^[0-9]{4}$' AND to_char(COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 'YYYY') = b.period)
                OR (b.period ~ '^[0-9]{4}-[0-9]{2}$' AND to_char(COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM') = b.period))
        ), 0) WHERE bl.tenant_id = $1",
        &[&tenant.id],
    )
    .await?;
    Ok(())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match (entity, action) {
        ("budget", "created" | "updated") => {
            if action == "updated" {
                let Some(id) = budget_id(document, "id") else {
                    return Ok(vec!["Cannot identify the budget to update".into()]);
                };
                let row = tx
                    .query_opt(
                        "SELECT status FROM budget__budget WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &id],
                    )
                    .await?;
                if !row.is_some_and(|row| row.get::<_, String>(0) == "draft") {
                    errors.push("Only draft budgets can be updated".into());
                }
            }
            errors.extend(validate_adjustment_reference(tx, tenant, document).await?);
        }
        ("budget_line", "created" | "updated" | "removed") => {
            let Some(budget) = budget_id(document, "budget") else {
                return Ok(vec!["Budget line must reference a valid budget".into()]);
            };
            let parent = tx
                .query_opt(
                    "SELECT status FROM budget__budget WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &budget],
                )
                .await?;
            if !parent.is_some_and(|row| row.get::<_, String>(0) == "draft") {
                return Ok(vec![
                    "Budget lines can only change while the budget is draft".into(),
                ]);
            }
            if action == "removed" {
                return Ok(errors);
            }
            let Some(account) = budget_id(document, "account") else {
                return Ok(vec![
                    "Budget line must reference a valid expense or revenue account".into(),
                ]);
            };
            if tx.query_opt(
                "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind IN ('expense', 'revenue')",
                &[&tenant.id, &account],
            ).await?.is_none() {
                errors.push("Budget lines must use an expense or revenue account in this tenant".into());
            }
            let department = budget_id(document, "department");
            if let Some(department) = department {
                if !tenant.has_module("hrm")
                    || tx
                        .query_opt(
                            "SELECT 1 FROM hrm__department WHERE tenant_id = $1 AND id = $2",
                            &[&tenant.id, &department],
                        )
                        .await?
                        .is_none()
                {
                    errors.push("Budget line department must belong to this tenant".into());
                }
            }
            let id = budget_id(document, "id").unwrap_or(Uuid::nil());
            if tx.query_opt(
                "SELECT 1 FROM budget__budget_line WHERE tenant_id = $1 AND budget = $2 AND account = $3 AND department IS NOT DISTINCT FROM $4 AND id <> $5 LIMIT 1",
                &[&tenant.id, &budget, &account, &department, &id],
            ).await?.is_some() {
                errors.push("Each account and department pair may appear only once in a budget".into());
            }
        }
        ("budget", "approved") => {
            if tenant.setting_bool("enforceBudgetControl")
                && let Some(period) = document.get("period").and_then(Value::as_str)
            {
                journal_control::lock_control_period(tx, tenant, period).await?;
            }
            let Some(id) = budget_id(document, "id") else {
                return Ok(vec!["Cannot identify the budget to approve".into()]);
            };
            tx.query_opt(
                "SELECT id FROM budget__budget WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id],
            )
            .await?;
            errors.extend(validate_adjustment_reference(tx, tenant, document).await?);
            let row = tx.query_one_row(
                "SELECT count(*), COALESCE(sum(planned), 0)::text FROM budget__budget_line WHERE tenant_id = $1 AND budget = $2",
                &[&tenant.id, &id],
            ).await?;
            let count: i64 = row.get(0);
            let planned_text: String = row.get(1);
            let planned = money::decimal_str(&planned_text).ok_or_else(|| {
                ApiError::validation(
                    "budget.lines.planned",
                    vec!["Stored planned budget total is not a valid decimal amount".into()],
                )
            })?;
            let total = amount(document, "amount").ok_or_else(|| {
                ApiError::validation(
                    "budget.amount",
                    vec!["Budget approval requires a valid decimal amount".into()],
                )
            })?;
            if count == 0 || !money::within_tolerance(planned, total, Decimal::new(5, 3)) {
                errors.push("Budget lines must contain at least one expense or revenue account and sum to the budget total".into());
            }
            if tx.query_opt(
                "SELECT 1 FROM budget__budget_line current_line \
                 JOIN budget__budget current_budget ON current_budget.tenant_id = current_line.tenant_id AND current_budget.id = current_line.budget \
                 JOIN budget__budget_line approved_line ON approved_line.tenant_id = current_line.tenant_id AND approved_line.account = current_line.account \
                   AND approved_line.department IS NOT DISTINCT FROM current_line.department \
                 JOIN budget__budget approved_budget ON approved_budget.tenant_id = approved_line.tenant_id AND approved_budget.id = approved_line.budget \
                 WHERE current_line.tenant_id = $1 AND current_line.budget = $2 AND approved_line.budget <> current_line.budget \
                   AND ($3::uuid IS NULL OR approved_budget.id <> $3) \
                   AND approved_budget.status IN ('approved', 'closed') AND approved_budget.period = current_budget.period LIMIT 1",
                &[&tenant.id, &id, &budget_id(document, "adjustment_of")],
            ).await?.is_some() {
                errors.push("Another approved budget already covers one of these account/department pairs for this period".into());
            }
        }
        ("budget", "closed") => {
            let end = document
                .get("period")
                .and_then(Value::as_str)
                .and_then(period_end);
            if !end.is_some_and(|end| end < tenant.business_today()) {
                errors.push("A budget can only close after its period has ended".into());
            }
        }
        ("budget", "superseded") => {
            let Some(id) = budget_id(document, "id") else {
                return Ok(vec!["Cannot identify the budget to supersede".into()]);
            };
            if tx
                .query_opt(
                    "SELECT id FROM budget__budget WHERE tenant_id = $1 AND adjustment_of = $2 AND status = 'approved' LIMIT 1 FOR SHARE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_none()
            {
                errors.push("A budget can only be superseded by an approved replacement budget".into());
            }
        }
        ("budget", "removed") => {
            let Some(id) = budget_id(document, "id") else {
                return Ok(vec!["Cannot identify the budget to remove".into()]);
            };
            if tx.query_opt(
                "SELECT 1 FROM budget__budget_line WHERE tenant_id = $1 AND budget = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Remove the budget lines before removing a draft budget".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}

pub(super) async fn validate_journal_posting(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    journal_control::validate_journal_posting(tx, tenant, document).await
}

async fn validate_adjustment_reference(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(adjustment_of) = budget_id(document, "adjustment_of") else {
        if document
            .get("adjustment_of")
            .is_some_and(|value| !value.is_null())
        {
            return Ok(vec!["Adjustment source must be a valid budget id".into()]);
        }
        return Ok(Vec::new());
    };
    let current_id = budget_id(document, "id");
    let row = tx
        .query_opt(
            "SELECT status, period FROM budget__budget WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &adjustment_of],
        )
        .await?;
    let Some(row) = row else {
        return Ok(vec![
            "Adjustment source budget was not found in this tenant".into(),
        ]);
    };
    let status: String = row.get(0);
    let period: String = row.get(1);
    if !matches!(status.as_str(), "approved" | "closed")
        || document.get("period").and_then(Value::as_str) != Some(period.as_str())
    {
        return Ok(vec![
            "An adjustment must replace an approved or closed budget for the same period".into(),
        ]);
    }
    if tx
        .query_opt(
            "SELECT id FROM budget__budget WHERE tenant_id = $1 AND adjustment_of = $2 AND status IN ('draft', 'approved', 'closed') AND ($3::uuid IS NULL OR id <> $3) LIMIT 1",
            &[&tenant.id, &adjustment_of, &current_id],
        )
        .await?
        .is_some()
    {
        return Ok(vec![
            "The source budget already has a live adjustment or replacement".into(),
        ]);
    }
    Ok(Vec::new())
}
