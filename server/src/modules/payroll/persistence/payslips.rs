//! Payslip creation persistence checks.
use super::*;

pub(super) async fn validate_created(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let run = document
        .get("run")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let Some(run) = run else {
        return Ok(vec![
            "Phiếu lương cần tham chiếu một bảng lương hợp lệ".into(),
        ]);
    };
    let run_row = tx
                .query_opt(
                    "SELECT status, period, COALESCE(hours_per_day, 8)::text, COALESCE(working_weekdays, '[1,2,3,4,5]'::jsonb)::text FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &run],
                )
                .await?;
    if !run_row
        .as_ref()
        .is_some_and(|row| row.get::<_, String>(0) == "draft")
    {
        errors.push("Chỉ được thêm phiếu lương vào bảng đang ở trạng thái nháp".into());
    }
    let period = run_row.as_ref().map(|row| row.get::<_, String>(1));
    let hours_per_day = run_row
        .as_ref()
        .map(|row| decimal_column(row, 2, "hours per day"))
        .transpose()?
        .unwrap_or(Decimal::from(8));
    let working_weekdays_json = run_row
        .as_ref()
        .map(|row| row.get::<_, String>(3))
        .unwrap_or_else(|| "[1,2,3,4,5]".into());
    let selected_weekdays: Vec<u8> =
        serde_json::from_str(&working_weekdays_json).unwrap_or_else(|_| vec![1, 2, 3, 4, 5]);
    if let Some(period) = period.as_deref() {
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("payroll-calendar:{}:{period}", tenant.id)],
        )
        .await?;
    }
    if let Some(employee) = document
        .get("employee")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    {
        let salary_revision = document
            .get("salary_revision")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let employee_row = if let Some(period) = period.as_deref() {
            tx.query_opt(
                        "SELECT e.status, COALESCE(revision.base_salary, e.base_salary, 0)::text, revision.id, \
                           COALESCE(adjustment.additions, 0)::text, COALESCE(adjustment.taxable_additions, 0)::text, \
                           COALESCE(adjustment.deductions, 0)::text, COALESCE(e.tax_residency, 'resident'), \
                           COALESCE(e.dependent_count, 0)::text, COALESCE(overtime.hours, 0)::text, \
                           COALESCE(overtime.weighted_hours, 0)::text, \
                           COALESCE(e.contribution_exempt, false) \
                         FROM hrm__employee e LEFT JOIN LATERAL (SELECT sr.id, sr.base_salary FROM hrm__salary_revision sr \
                           WHERE sr.tenant_id = e.tenant_id AND sr.employee = e.id AND sr.status = 'approved' \
                             AND sr.effective_from <= to_date($3 || '-01', 'YYYY-MM-DD') \
                           ORDER BY sr.effective_from DESC LIMIT 1) revision ON TRUE \
                         LEFT JOIN LATERAL (SELECT \
                           COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'addition'), 0)::numeric AS additions, \
                           COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'addition' AND COALESCE(pa.taxable, true)), 0)::numeric AS taxable_additions, \
                           COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'deduction'), 0)::numeric AS deductions \
                           FROM payroll__payroll_adjustment pa WHERE pa.tenant_id = e.tenant_id \
                             AND pa.employee = e.id AND pa.period = $3 AND pa.status = 'approved') adjustment ON TRUE \
                         LEFT JOIN LATERAL (SELECT COALESCE(sum(oe.hours), 0)::numeric AS hours, \
                           COALESCE(sum(oe.hours * oe.multiplier), 0)::numeric AS weighted_hours \
                           FROM payroll__overtime_entry oe WHERE oe.tenant_id = e.tenant_id \
                             AND oe.employee = e.id AND oe.date >= to_date($3 || '-01', 'YYYY-MM-DD') \
                             AND oe.date < (to_date($3 || '-01', 'YYYY-MM-DD') + interval '1 month')::date \
                             AND oe.status = 'approved') overtime ON TRUE \
                         WHERE e.tenant_id = $1 AND e.id = $2 FOR SHARE OF e",
                        &[&tenant.id, &employee, &period],
                    )
                    .await?
        } else {
            None
        };
        if !employee_row
            .as_ref()
            .is_some_and(|row| matches!(row.get::<_, String>(0).as_str(), "active" | "terminated"))
        {
            errors.push("Payslip chỉ được lập cho nhân viên đang hoặc đã làm việc trong kỳ".into());
        }
        if let Some(row) = employee_row {
            let expected_salary = decimal_column(&row, 1, "salary basis")?;
            let expected_revision: Option<Uuid> = row.get(2);
            let captured_salary = decimal_field(document, "salary_basis");
            let captured_additions = decimal_field(document, "additions");
            let expected_additions = decimal_column(&row, 3, "approved additions")?;
            let expected_taxable_additions = decimal_column(&row, 4, "taxable additions")?;
            let expected_manual_deductions = decimal_column(&row, 5, "manual deductions")?;
            let tax_residency: String = row.get(6);
            let dependent_count = decimal_column(&row, 7, "dependent count")?;
            let expected_overtime_hours = decimal_column(&row, 8, "approved overtime hours")?;
            let overtime_weighted_hours = decimal_column(&row, 9, "weighted overtime hours")?;
            let contribution_exempt: bool = row.get(10);
            let expected_overtime_pay = if overtime_weighted_hours > Decimal::ZERO {
                if let Some(first_day) = period.as_deref().and_then(|value| {
                    NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d").ok()
                }) {
                    let (year, month) = if first_day.month() == 12 {
                        (first_day.year() + 1, 1)
                    } else {
                        (first_day.year(), first_day.month() + 1)
                    };
                    if let Some(next_month) = NaiveDate::from_ymd_opt(year, month, 1) {
                        calculate_overtime_pay(
                            expected_salary,
                            working_weekdays(first_day, next_month, &selected_weekdays),
                            hours_per_day,
                            overtime_weighted_hours,
                        )?
                    } else {
                        Decimal::ZERO
                    }
                } else {
                    Decimal::ZERO
                }
            } else {
                Decimal::ZERO
            };
            let expected_total_additions = expected_additions
                .checked_add(expected_overtime_pay)
                .ok_or_else(payroll_amount_error)?;
            let captured_overtime_hours =
                decimal_field(document, "overtime_hours").unwrap_or(Decimal::ZERO);
            let captured_overtime_pay =
                decimal_field(document, "overtime_pay").unwrap_or(Decimal::ZERO);
            if !captured_salary.is_some_and(|value| {
                money::within_tolerance(value, expected_salary, Decimal::new(1, 4))
            }) || salary_revision != expected_revision
                || !captured_additions.is_some_and(|value| {
                    money::within_tolerance(value, expected_total_additions, Decimal::new(1, 4))
                })
                || !money::within_tolerance(
                    captured_overtime_hours,
                    expected_overtime_hours,
                    Decimal::new(1, 4),
                )
                || !money::within_tolerance(
                    captured_overtime_pay,
                    expected_overtime_pay,
                    Decimal::new(5, 3),
                )
            {
                errors.push(
                    "Payslip must snapshot the approved salary effective for its payroll month"
                        .into(),
                );
            }
            if let Some(period) = period.as_deref()
                && let Ok(first_day) =
                    NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d")
            {
                let policy = load_tax_policy(tx, tenant, first_day).await?;
                let gross = decimal_field(document, "gross").unwrap_or(Decimal::ZERO);
                let contribution_policy = load_contribution_policy(tx, tenant, first_day).await?;
                let paid_days = decimal_field(document, "paid_days").unwrap_or(Decimal::ZERO);
                let payslip_working_days =
                    decimal_field(document, "working_days").unwrap_or(Decimal::ZERO);
                let base_gross = if payslip_working_days > Decimal::ZERO {
                    expected_salary
                        .checked_mul(paid_days)
                        .and_then(|amount| amount.checked_div(payslip_working_days))
                        .map(|amount| {
                            amount.round_dp_with_strategy(
                                2,
                                rust_decimal::RoundingStrategy::MidpointAwayFromZero,
                            )
                        })
                        .map(money::round_money)
                        .ok_or_else(payroll_amount_error)?
                } else {
                    Decimal::ZERO
                };
                let (
                    expected_contribution_base,
                    expected_employee_contribution,
                    expected_employer_contribution,
                ) = if let Some(contribution_policy) = &contribution_policy {
                    calculate_contributions(
                        contribution_policy,
                        contribution_exempt,
                        base_gross,
                        gross,
                    )?
                } else {
                    (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO)
                };
                let contribution_policy_id = contribution_policy.as_ref().map(|p| p.id);
                let mut taxable_gross = base_gross
                    .checked_add(expected_taxable_additions)
                    .and_then(|amount| amount.checked_add(expected_overtime_pay))
                    .ok_or_else(payroll_amount_error)?;
                if contribution_policy
                    .as_ref()
                    .is_some_and(|policy| policy.employee_deductible_for_tax)
                {
                    taxable_gross = taxable_gross
                        .checked_sub(expected_employee_contribution)
                        .ok_or_else(payroll_amount_error)?;
                }
                taxable_gross = taxable_gross.max(Decimal::ZERO);
                let (expected_taxable_income, expected_income_tax, policy_id) =
                    if let Some(policy) = &policy {
                        if dependent_count < Decimal::ZERO
                            || dependent_count > Decimal::from(1000)
                            || dependent_count.fract() != Decimal::ZERO
                        {
                            errors.push(
                                "Employee dependent count must be a whole number from 0 to 1000"
                                    .into(),
                            );
                            (Decimal::ZERO, Decimal::ZERO, Some(policy.id))
                        } else {
                            let dependent_count = dependent_count.to_i32().ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    "hrm.employee",
                                    vec!["Dependent count exceeds the supported range".into()],
                                )
                            })?;
                            let (taxable_income, income_tax) = calculate_income_tax(
                                policy,
                                &tax_residency,
                                dependent_count,
                                taxable_gross,
                            )?;
                            (taxable_income, income_tax, Some(policy.id))
                        }
                    } else {
                        (Decimal::ZERO, Decimal::ZERO, None)
                    };
                let captured_policy = document
                    .get("tax_policy")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok());
                let captured_taxable_income =
                    decimal_field(document, "taxable_income").unwrap_or(Decimal::ZERO);
                let captured_income_tax =
                    decimal_field(document, "income_tax").unwrap_or(Decimal::ZERO);
                let captured_contribution_policy = document
                    .get("contribution_policy")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok());
                let captured_contribution_base =
                    decimal_field(document, "contribution_base").unwrap_or(Decimal::ZERO);
                let captured_employee_contribution =
                    decimal_field(document, "employee_contribution").unwrap_or(Decimal::ZERO);
                let captured_employer_contribution =
                    decimal_field(document, "employer_contribution").unwrap_or(Decimal::ZERO);
                let captured_deductions =
                    decimal_field(document, "deductions").unwrap_or(Decimal::ZERO);
                let expected_deductions = expected_manual_deductions
                    .checked_add(expected_employee_contribution)
                    .and_then(|amount| amount.checked_add(expected_income_tax))
                    .ok_or_else(payroll_amount_error)?;
                let tolerance = Decimal::new(5, 3);
                if captured_policy != policy_id
                    || captured_contribution_policy != contribution_policy_id
                    || !money::within_tolerance(
                        captured_contribution_base,
                        expected_contribution_base,
                        tolerance,
                    )
                    || !money::within_tolerance(
                        captured_employee_contribution,
                        expected_employee_contribution,
                        tolerance,
                    )
                    || !money::within_tolerance(
                        captured_employer_contribution,
                        expected_employer_contribution,
                        tolerance,
                    )
                    || !money::within_tolerance(
                        captured_taxable_income,
                        expected_taxable_income,
                        tolerance,
                    )
                    || !money::within_tolerance(captured_income_tax, expected_income_tax, tolerance)
                    || !money::within_tolerance(captured_deductions, expected_deductions, tolerance)
                {
                    errors.push("Payslip tax policy, taxable income, tax, and total deductions must match the effective approved policy and employee profile".into());
                }
            }
        }
        if let Some(period) = period.as_deref() {
            if let Some(first_day) =
                NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d").ok()
            {
                let (next_year, next_month) = if first_day.month() == 12 {
                    (first_day.year() + 1, 1)
                } else {
                    (first_day.year(), first_day.month() + 1)
                };
                if let Some(next_month_start) = NaiveDate::from_ymd_opt(next_year, next_month, 1) {
                    let working_days =
                        working_weekdays(first_day, next_month_start, &selected_weekdays);
                    let hours_per_day_text = hours_per_day.to_string();
                    let paid_days = counted_paid_days(
                        tx,
                        tenant,
                        employee,
                        first_day,
                        next_month_start,
                        &hours_per_day_text,
                        &working_weekdays_json,
                    )
                    .await?;
                    let captured_paid = decimal_field(document, "paid_days");
                    let captured_working = decimal_field(document, "working_days");
                    let day_tolerance = Decimal::new(1, 6);
                    if !captured_paid.is_some_and(|value| {
                        money::within_tolerance(value, paid_days, day_tolerance)
                    }) || !captured_working.is_some_and(|value| {
                        money::within_tolerance(value, working_days, day_tolerance)
                    }) {
                        errors.push("Payslip paid and working days must match the locked attendance and calendar for its month".into());
                    }
                }
            }
        }
        if tx
                    .query_opt(
                        "SELECT 1 FROM payroll__payslip WHERE tenant_id = $1 AND run = $2 AND employee = $3 LIMIT 1",
                        &[&tenant.id, &run, &employee],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Mỗi nhân viên chỉ được có một phiếu trong cùng bảng lương".into());
                }
    }
    Ok(errors)
}
