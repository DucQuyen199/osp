//! Focused accounting settlement source-event handler.
use super::*;

pub(super) async fn handle_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    match event_type {
        "payroll.payroll_run.approved" | "expense.expense_claim.approved" => {
            let (amount_field, memo, source, debit_code, credit_code) =
                if event_type == "payroll.payroll_run.approved" {
                    ("total_net", "Chi phí lương", "payroll_run", "642", "334")
                } else {
                    ("total", "Chi phí nhân viên", "expense_claim", "642", "334")
                };
            let amount = decimal_field(event, amount_field).unwrap_or(Decimal::ZERO);
            let mut journal_amount = amount;
            let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let debit = account_id(tx, tenant, debit_code).await?;
            let credit = account_id(tx, tenant, credit_code).await?;
            let lines = if event_type == "expense.expense_claim.approved" {
                let source_id = Uuid::parse_str(id).map_err(|_| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Expense claim approval requires a valid id".into()],
                    )
                })?;
                let claim = tx
                    .query_opt(
                        "SELECT employee, items FROM expense__expense_claim WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &source_id],
                    )
                    .await?
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Approved expense claim was not found for this tenant".into()],
                        )
                    })?;
                let employee: Uuid = claim.get(0);
                let items: Option<Value> = claim.get(1);
                let department = tx
                    .query_opt(
                        "SELECT department FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &employee],
                    )
                    .await?
                    .map(|row| row.get::<_, Option<Uuid>>(0))
                    .flatten();
                let Some(items) = items.and_then(|value| value.as_array().cloned()) else {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Approved expense claim requires itemized expenses".into()],
                    ));
                };
                let mut by_account = std::collections::BTreeMap::<String, Decimal>::new();
                for item in items {
                    let line_amount = item
                        .get("amount")
                        .and_then(crate::money::decimal)
                        .filter(|value| *value > Decimal::ZERO)
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec!["Expense items must have a positive amount".into()],
                            )
                        })?;
                    let account_code = item
                        .get("account_code")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or("642")
                        .trim()
                        .to_ascii_uppercase();
                    let accumulated = by_account
                        .get(&account_code)
                        .copied()
                        .unwrap_or(Decimal::ZERO)
                        .checked_add(line_amount)
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec![
                                    "Expense item totals exceed the supported decimal range".into(),
                                ],
                            )
                        })?;
                    by_account.insert(account_code, accumulated);
                }
                let item_total = by_account
                    .values()
                    .try_fold(Decimal::ZERO, |total, amount| total.checked_add(*amount))
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Expense item totals exceed the supported decimal range".into()],
                        )
                    })?;
                if by_account.is_empty()
                    || !crate::money::within_tolerance(item_total, amount, amount_tolerance())
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Expense item amounts must equal the approved claim total".into()],
                    ));
                }
                let mut lines = Vec::with_capacity(by_account.len() + 1);
                for (code, line_amount) in by_account {
                    let expense = account_id(tx, tenant, &code).await?;
                    let kind: Option<String> = tx
                        .query_opt(
                            "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &expense],
                        )
                        .await?
                        .map(|row| row.get(0));
                    if kind.as_deref() != Some("expense") {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec![format!("Account {code} must be an expense account")],
                        ));
                    }
                    lines.push(journal_line_decimal_with_department(
                        expense,
                        line_amount,
                        Decimal::ZERO,
                        department,
                    )?);
                }
                lines.push(journal_line_decimal(credit, Decimal::ZERO, amount)?);
                lines
            } else {
                let run_id = Uuid::parse_str(id).map_err(|_| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Payroll approval requires a valid run id".into()],
                    )
                })?;
                let run_period = tx
                    .query_opt(
                        "SELECT period FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &run_id],
                    )
                    .await?
                    .map(|row| row.get::<_, String>(0))
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Approved payroll run was not found for this tenant".into()],
                        )
                    })?;
                let totals = tx
                    .query_one_row(
                        "SELECT COALESCE(sum(gross), 0)::text, COALESCE(sum(net), 0)::text, \
                           COALESCE(sum(income_tax), 0)::text, \
                           COALESCE(sum(employee_contribution), 0)::text, \
                           COALESCE(sum(employer_contribution), 0)::text, \
                           count(DISTINCT tax_policy), count(DISTINCT contribution_policy) \
                         FROM payroll__payslip WHERE tenant_id = $1 AND run = $2",
                        &[&tenant.id, &run_id],
                    )
                    .await?;
                let gross_total = decimal_column(&totals, 0)?;
                let net_total = decimal_column(&totals, 1)?;
                let income_tax_total = decimal_column(&totals, 2)?;
                let employee_contribution_total = decimal_column(&totals, 3)?;
                let employer_contribution_total = decimal_column(&totals, 4)?;
                let tax_policy_count: i64 = totals.get(5);
                let contribution_policy_count: i64 = totals.get(6);
                if gross_total <= Decimal::ZERO
                    || !crate::money::within_tolerance(net_total, amount, amount_tolerance())
                    || gross_total
                        .checked_add(amount_tolerance())
                        .is_none_or(|gross| gross < net_total)
                    || income_tax_total < Decimal::ZERO
                    || employee_contribution_total < Decimal::ZERO
                    || employer_contribution_total < Decimal::ZERO
                    || tax_policy_count > 1
                    || contribution_policy_count > 1
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Payroll gross and net snapshots do not reconcile to the run total"
                                .into(),
                        ],
                    ));
                }
                journal_amount = gross_total
                    .checked_add(employer_contribution_total)
                    .ok_or_else(|| crate::error::ApiError::validation(
                        event_type,
                        vec!["Payroll employer contribution total exceeds the supported amount range".into()],
                    ))?;
                let allocations = tx
                    .query(
                        "SELECT employee.department, COALESCE(sum(payslip.gross), 0)::text \
                         FROM payroll__payslip payslip \
                         JOIN hrm__employee employee ON employee.tenant_id = payslip.tenant_id AND employee.id = payslip.employee \
                         WHERE payslip.tenant_id = $1 AND payslip.run = $2 \
                         GROUP BY employee.department ORDER BY employee.department NULLS FIRST",
                        &[&tenant.id, &run_id],
                    )
                    .await?;
                let mut allocated = Decimal::ZERO;
                let mut lines = Vec::with_capacity(allocations.len() + 2);
                for row in allocations {
                    let department: Option<Uuid> = row.get(0);
                    let department_amount = decimal_column(&row, 1)?;
                    if department_amount < Decimal::ZERO {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec!["Payslip gross amounts must be finite and non-negative".into()],
                        ));
                    }
                    allocated = allocated.checked_add(department_amount).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec![
                                "Payroll department allocation exceeds the supported decimal range"
                                    .into(),
                            ],
                        )
                    })?;
                    if department_amount > Decimal::ZERO {
                        lines.push(journal_line_decimal_with_department(
                            debit,
                            department_amount,
                            Decimal::ZERO,
                            department,
                        )?);
                    }
                }
                if !crate::money::within_tolerance(allocated, gross_total, amount_tolerance()) {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Payroll department gross allocations must equal the payslip gross total"
                                .into(),
                        ],
                    ));
                }
                lines.push(journal_line_decimal(credit, Decimal::ZERO, net_total)?);
                if employee_contribution_total > amount_tolerance()
                    || employer_contribution_total > amount_tolerance()
                {
                    let contribution_accounts = tx
                        .query_opt(
                            "SELECT policy.liability_account, policy.employer_expense_account FROM payroll__payslip payslip JOIN payroll__contribution_policy policy ON policy.tenant_id = payslip.tenant_id AND policy.id = payslip.contribution_policy WHERE payslip.tenant_id = $1 AND payslip.run = $2 AND payslip.contribution_policy IS NOT NULL LIMIT 1 FOR SHARE OF policy",
                            &[&tenant.id, &run_id],
                        )
                        .await?
                        .map(|row| (row.get::<_, Uuid>(0), row.get::<_, Uuid>(1)))
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec!["Payroll contributions require an approved contribution policy and accounts".into()],
                            )
                        })?;
                    let (liability_account, employer_expense_account) = contribution_accounts;
                    let liability_kind = tx
                        .query_opt(
                            "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &liability_account],
                        )
                        .await?
                        .map(|row| row.get::<_, String>(0));
                    let expense_kind = tx
                        .query_opt(
                            "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &employer_expense_account],
                        )
                        .await?
                        .map(|row| row.get::<_, String>(0));
                    if liability_kind.as_deref() != Some("liability")
                        || expense_kind.as_deref() != Some("expense")
                    {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec!["Contribution liability and employer expense accounts must retain their configured account kinds".into()],
                        ));
                    }
                    if employer_contribution_total > amount_tolerance() {
                        lines.push(journal_line_decimal(
                            employer_expense_account,
                            employer_contribution_total,
                            Decimal::ZERO,
                        )?);
                    }
                    let contribution_liability_total = employee_contribution_total
                        .checked_add(employer_contribution_total)
                        .ok_or_else(|| crate::error::ApiError::validation(
                            event_type,
                            vec!["Payroll contribution liability exceeds the supported decimal range".into()],
                        ))?;
                    if contribution_liability_total > amount_tolerance() {
                        lines.push(journal_line_decimal(
                            liability_account,
                            Decimal::ZERO,
                            contribution_liability_total,
                        )?);
                    }
                }
                if income_tax_total > amount_tolerance() {
                    let tax_account = tx
                        .query_opt(
                            "SELECT policy.tax_account FROM payroll__payslip payslip JOIN payroll__tax_policy policy ON policy.tenant_id = payslip.tenant_id AND policy.id = payslip.tax_policy WHERE payslip.tenant_id = $1 AND payslip.run = $2 AND payslip.tax_policy IS NOT NULL LIMIT 1 FOR SHARE OF policy",
                            &[&tenant.id, &run_id],
                        )
                        .await?
                        .map(|row| row.get::<_, Uuid>(0))
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                event_type,
                                vec!["Payroll income tax requires its approved tax policy liability account".into()],
                            )
                        })?;
                    let account_kind = tx
                        .query_opt(
                            "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &tax_account],
                        )
                        .await?
                        .map(|row| row.get::<_, String>(0));
                    if account_kind.as_deref() != Some("liability") {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec!["Payroll tax account must remain a liability account".into()],
                        ));
                    }
                    lines.push(journal_line_decimal(
                        tax_account,
                        Decimal::ZERO,
                        income_tax_total,
                    )?);
                }
                let deduction_rows = tx
                    .query(
                        "SELECT adjustment.account, sum(adjustment.amount)::text \
                         FROM payroll__payroll_adjustment adjustment \
                         WHERE adjustment.tenant_id = $1 AND adjustment.period = $2 \
                           AND adjustment.kind = 'deduction' AND adjustment.status = 'approved' \
                           AND EXISTS (SELECT 1 FROM payroll__payslip payslip \
                             WHERE payslip.tenant_id = adjustment.tenant_id \
                               AND payslip.employee = adjustment.employee AND payslip.run = $3) \
                         GROUP BY adjustment.account ORDER BY adjustment.account",
                        &[&tenant.id, &run_period, &run_id],
                    )
                    .await?;
                let mut deduction_total = Decimal::ZERO;
                for row in deduction_rows {
                    let deduction_account: Uuid = row.get(0);
                    let deduction_amount = decimal_column(&row, 1)?;
                    let account_kind: Option<String> = tx
                        .query_opt(
                            "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &deduction_account],
                        )
                        .await?
                        .map(|row| row.get(0));
                    if !matches!(account_kind.as_deref(), Some("asset" | "liability"))
                        || deduction_amount <= Decimal::ZERO
                    {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec!["Payroll deduction accounts must remain active asset or liability accounts with positive totals".into()],
                        ));
                    }
                    deduction_total =
                        deduction_total
                            .checked_add(deduction_amount)
                            .ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    event_type,
                                    vec![
                                    "Payroll deduction total exceeds the supported decimal range"
                                        .into(),
                                ],
                                )
                            })?;
                    lines.push(journal_line_decimal(
                        deduction_account,
                        Decimal::ZERO,
                        deduction_amount,
                    )?);
                }
                let expected_deduction = gross_total
                    .checked_sub(net_total)
                    .and_then(|value| value.checked_sub(income_tax_total))
                    .and_then(|value| value.checked_sub(employee_contribution_total))
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Payroll deductions exceed the supported decimal range".into()],
                        )
                    })?;
                if !crate::money::within_tolerance(
                    deduction_total,
                    expected_deduction,
                    amount_tolerance(),
                ) {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Approved payroll deductions must reconcile to gross pay less net pay"
                                .into(),
                        ],
                    ));
                }
                lines
            };
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                memo,
                journal_amount,
                source,
                id,
                lines,
            )
            .await?;
            Ok(Some(true))
        }
        _ => Ok(None),
    }
}
