use super::*;
use rust_decimal::RoundingStrategy;
use rust_decimal::prelude::ToPrimitive;

fn payroll_amount_error() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "payroll.payslip",
        vec!["Calculated payroll amount exceeds the supported decimal range".into()],
    )
}

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "payroll.payslip",
            vec![format!(
                "Stored payroll {field} exceeds the supported decimal range"
            )],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(payroll_amount_error)
}

/// Creates draft payslips from attendance, approved leave, holidays and overtime.
/// Monthly base salary is prorated by paid weekday-equivalent days in the month.
/// Insurance and jurisdiction-specific policies remain explicit inputs.
pub(super) async fn calculate_from_attendance(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let Some(run_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    let Some(period) = document.get("period").and_then(Value::as_str) else {
        return Ok(false);
    };
    let Some(first_day) = NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d").ok()
    else {
        return Ok(false);
    };
    let (next_year, next_month) = if first_day.month() == 12 {
        (first_day.year() + 1, 1)
    } else {
        (first_day.year(), first_day.month() + 1)
    };
    let Some(next_month_start) = NaiveDate::from_ymd_opt(next_year, next_month, 1) else {
        return Ok(false);
    };
    // Lock the payroll run before checking for existing slips. This serializes
    // calculate requests with payslip creation and submission.
    let run = tx
        .query_opt(
            "SELECT status, COALESCE(hours_per_day, 8)::text, COALESCE(working_weekdays, '[1,2,3,4,5]'::jsonb)::text FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &run_id],
        )
        .await?;
    if !run
        .as_ref()
        .is_some_and(|row| row.get::<_, String>(0) == "draft")
        || tx
            .query_opt(
                "SELECT 1 FROM payroll__payslip WHERE tenant_id = $1 AND run = $2 LIMIT 1",
                &[&tenant.id, &run_id],
            )
            .await?
            .is_some()
    {
        return Ok(false);
    }
    let hours_per_day = run
        .as_ref()
        .map(|row| decimal_column(row, 1, "hours per day"))
        .transpose()?
        .unwrap_or(Decimal::from(8));
    let working_weekdays_json = run
        .as_ref()
        .map(|row| row.get::<_, String>(2))
        .unwrap_or_else(|| "[1,2,3,4,5]".into());
    let _working_weekdays: Vec<u8> =
        serde_json::from_str(&working_weekdays_json).map_err(|_| {
            crate::error::ApiError::validation(
                "payroll.payroll_run",
                vec!["working_weekdays must contain ISO weekdays from 1 to 7".into()],
            )
        })?;
    if !(Decimal::ONE..=Decimal::from(24)).contains(&hours_per_day) {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec!["hours_per_day must be between 1 and 24".into()],
        ));
    }
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("payroll-calendar:{}:{period}", tenant.id)],
    )
    .await?;
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("payroll-policy-calendar:{}", tenant.id)],
    )
    .await?;
    let tax_policy = load_tax_policy(tx, tenant, first_day).await?;
    let contribution_policy = load_contribution_policy(tx, tenant, first_day).await?;

    // HRM attendance writes, leave approvals, and termination take row locks;
    // payroll locks the full roster before taking the employment snapshot.
    tx.query(
        "SELECT id FROM hrm__employee WHERE tenant_id = $1 AND status IN ('active', 'terminated') ORDER BY id FOR SHARE",
        &[&tenant.id],
    )
    .await?;
    let rows = tx
        .query(
            "WITH eligible AS ( \
               SELECT e.id, revision.id AS salary_revision, \
                 COALESCE(revision.base_salary::numeric, e.base_salary::numeric, 0) AS salary, \
                 COALESCE(adjustment.additions, 0) AS additions, \
                 COALESCE(adjustment.taxable_additions, 0) AS taxable_additions, \
                 COALESCE(adjustment.deductions, 0) AS deductions, \
                 COALESCE(overtime.hours, 0)::numeric AS overtime_hours, \
                 COALESCE(overtime.weighted_hours, 0)::numeric AS overtime_weighted_hours, \
                 COALESCE(e.tax_residency, 'resident')::text AS tax_residency, \
                 COALESCE(e.dependent_count, 0)::numeric AS dependent_count, \
                 COALESCE(e.contribution_exempt, false) AS contribution_exempt, \
                 COALESCE(e.work_weekdays, $5::jsonb) AS work_weekdays, \
                 COALESCE(e.standard_hours_per_day::numeric, $4::numeric) AS standard_hours_per_day, \
                 e.hire_date, e.termination_date \
               FROM hrm__employee e \
               LEFT JOIN LATERAL (SELECT sr.id, sr.base_salary FROM hrm__salary_revision sr \
                 WHERE sr.tenant_id = e.tenant_id AND sr.employee = e.id AND sr.status = 'approved' \
                   AND sr.effective_from <= $2 ORDER BY sr.effective_from DESC LIMIT 1) revision ON TRUE \
               LEFT JOIN LATERAL (SELECT \
                 COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'addition'), 0)::numeric AS additions, \
                 COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'addition' AND COALESCE(pa.taxable, true)), 0)::numeric AS taxable_additions, \
                 COALESCE(sum(pa.amount) FILTER (WHERE pa.kind = 'deduction'), 0)::numeric AS deductions \
                 FROM payroll__payroll_adjustment pa WHERE pa.tenant_id = e.tenant_id \
                   AND pa.employee = e.id AND pa.period = to_char($2, 'YYYY-MM') \
                   AND pa.status = 'approved') adjustment ON TRUE \
               LEFT JOIN LATERAL (SELECT \
                 COALESCE(sum(oe.hours), 0)::numeric AS hours, \
                 COALESCE(sum(oe.hours * oe.multiplier), 0)::numeric AS weighted_hours \
                 FROM payroll__overtime_entry oe WHERE oe.tenant_id = e.tenant_id \
                   AND oe.employee = e.id AND oe.date >= $2 AND oe.date < $3 \
                   AND oe.status = 'approved') overtime ON TRUE \
               WHERE e.tenant_id = $1 AND e.status IN ('active', 'terminated') \
                 AND (e.hire_date IS NULL OR e.hire_date < $3) \
                 AND (e.termination_date IS NULL OR e.termination_date >= $2) \
             ), work_calendar AS ( \
               SELECT sal.id AS employee, work_day.work_date::date AS work_date, \
                 CASE WHEN ws.id IS NULL THEN sal.standard_hours_per_day \
                   ELSE EXTRACT(EPOCH FROM (ws.end_at - ws.start_at))::numeric / 3600 - COALESCE(ws.break_minutes, 0)::numeric / 60 \
                 END AS expected_hours \
               FROM eligible sal CROSS JOIN LATERAL generate_series($2::date, $3::date - 1, interval '1 day') AS work_day(work_date) \
               LEFT JOIN hrm__work_schedule_entry ws ON ws.tenant_id = $1 AND ws.employee = sal.id AND ws.work_date = work_day.work_date::date \
               WHERE (ws.id IS NULL AND EXTRACT(ISODOW FROM work_day.work_date)::int IN (SELECT value::int FROM jsonb_array_elements_text(sal.work_weekdays) AS selected(value))) \
                 OR (ws.id IS NOT NULL AND ws.is_working) \
             ), working_days AS ( \
               SELECT employee, count(*)::numeric AS working_days FROM work_calendar GROUP BY employee \
             ), counted_days AS ( \
               SELECT a.employee, a.date AS work_date, \
                 LEAST(1::numeric, GREATEST(0::numeric, round( \
                   EXTRACT(EPOCH FROM (a.check_out - a.check_in))::numeric / 3600 / cal.expected_hours, 6 \
                 ))) AS day_fraction \
               FROM work_calendar cal JOIN hrm__attendance a ON a.tenant_id = $1 AND a.employee = cal.employee AND a.date = cal.work_date \
               JOIN hrm__employee e ON e.tenant_id = a.tenant_id AND e.id = a.employee \
               JOIN eligible sal ON sal.id = e.id AND sal.salary > 0 \
               WHERE a.date >= $2 AND a.date < $3 \
                 AND a.date >= COALESCE(e.hire_date, $2) \
                 AND a.date <= COALESCE(e.termination_date, $3 - 1) \
                 AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL \
               UNION ALL \
               SELECT lr.employee, leave_day.work_date::date AS work_date, \
                 CASE WHEN lr.partial_day IN ('morning', 'afternoon') THEN 0.5 ELSE 1 END::numeric AS day_fraction \
               FROM hrm__leave_request lr \
               JOIN hrm__employee e ON e.tenant_id = lr.tenant_id AND e.id = lr.employee \
               JOIN eligible sal ON sal.id = e.id \
               CROSS JOIN LATERAL generate_series( \
                 GREATEST(lr.start_date, $2::date, COALESCE(e.hire_date, $2::date))::timestamp, \
                 LEAST(lr.end_date, $3::date - 1, COALESCE(e.termination_date, $3::date - 1))::timestamp, interval '1 day' \
               ) AS leave_day(work_date) \
               WHERE lr.tenant_id = $1 AND sal.salary > 0 \
                 AND lr.status = 'approved' \
                 AND COALESCE(lr.pay_treatment, CASE WHEN lr.kind = 'unpaid' THEN 'unpaid' ELSE 'paid' END) = 'paid' \
                 AND lr.start_date < $3 AND lr.end_date >= $2 \
                 AND lr.end_date >= COALESCE(e.hire_date, $2) \
                 AND lr.start_date <= COALESCE(e.termination_date, $3 - 1) \
                 AND EXISTS (SELECT 1 FROM work_calendar cal WHERE cal.employee = lr.employee AND cal.work_date = leave_day.work_date::date) \
               UNION ALL \
               SELECT e.id, h.date AS work_date, 1::numeric AS day_fraction \
               FROM hrm__holiday h \
               JOIN hrm__employee e ON e.tenant_id = h.tenant_id \
               JOIN eligible sal ON sal.id = e.id \
               JOIN work_calendar cal ON cal.employee = e.id AND cal.work_date = h.date \
               WHERE h.tenant_id = $1 AND sal.salary > 0 \
                 AND h.date >= $2 AND h.date < $3 \
                 AND h.date >= COALESCE(e.hire_date, $2) \
                 AND h.date <= COALESCE(e.termination_date, $3 - 1) \
                 AND h.pay_treatment = 'paid' \
             ), paid_days AS ( \
               SELECT employee, work_date, LEAST(1::numeric, round(sum(day_fraction), 6)) AS day_fraction \
               FROM counted_days GROUP BY employee, work_date \
             ) \
             SELECT e.id, e.salary::text, e.salary_revision, e.additions::text, e.taxable_additions::text, e.deductions::text, \
               e.overtime_hours::text, e.overtime_weighted_hours::text, e.tax_residency, e.dependent_count::text, \
               e.contribution_exempt, COALESCE(sum(d.day_fraction), 0)::text AS paid_days, \
               e.standard_hours_per_day::text, wd.working_days::text, e.work_weekdays::text \
             FROM eligible e LEFT JOIN paid_days d ON e.id = d.employee \
             JOIN working_days wd ON wd.employee = e.id \
             WHERE e.salary > 0 \
             GROUP BY e.id, e.salary, e.salary_revision, e.additions, e.taxable_additions, e.deductions, \
               e.overtime_hours, e.overtime_weighted_hours, e.tax_residency, e.dependent_count, \
               e.contribution_exempt, e.standard_hours_per_day, wd.working_days \
             HAVING COALESCE(sum(d.day_fraction), 0) > 0 OR e.overtime_hours > 0 ORDER BY e.id",
            &[
                &tenant.id,
                &first_day,
                &next_month_start,
                &hours_per_day.to_string(),
                &working_weekdays_json,
            ],
        )
        .await?;
    if rows.is_empty() {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec![
                "Không có ngày công hợp lệ hoặc giờ làm thêm đã duyệt để tạo phiếu lương trong kỳ"
                    .into(),
            ],
        ));
    }

    let entity = kernel.ent(tenant, "payroll.payslip")?;
    let mut created = 0usize;
    for row in rows {
        let employee: Uuid = row.get(0);
        let salary = decimal_column(&row, 1, "salary basis")?;
        let salary_revision: Option<Uuid> = row.get(2);
        let additions = decimal_column(&row, 3, "additions")?;
        let taxable_additions = decimal_column(&row, 4, "taxable additions")?;
        let manual_deductions = decimal_column(&row, 5, "manual deductions")?;
        let overtime_hours = decimal_column(&row, 6, "overtime hours")?;
        let overtime_weighted_hours = decimal_column(&row, 7, "weighted overtime hours")?;
        let tax_residency: String = row.get(8);
        let dependent_count_value = decimal_column(&row, 9, "dependent count")?;
        let contribution_exempt: bool = row.get(10);
        let paid_days = decimal_column(&row, 11, "paid days")?;
        let employee_hours_per_day = decimal_column(&row, 12, "employee standard hours per day")?;
        let working_days = decimal_column(&row, 13, "employee working days")?;
        let work_weekdays: Value =
            serde_json::from_str(&row.get::<_, String>(14)).map_err(|_| {
                crate::error::ApiError::validation(
                    "hrm.employee",
                    vec!["Employee work_weekdays must contain ISO weekdays from 1 to 7".into()],
                )
            })?;
        if salary <= Decimal::ZERO || paid_days < Decimal::ZERO {
            continue;
        }
        if manual_deductions < Decimal::ZERO
            || taxable_additions < Decimal::ZERO
            || overtime_hours < Decimal::ZERO
            || overtime_weighted_hours < Decimal::ZERO
            || dependent_count_value < Decimal::ZERO
            || dependent_count_value > Decimal::from(1000)
            || dependent_count_value.fract() != Decimal::ZERO
        {
            continue;
        }
        let dependent_count = dependent_count_value.to_i32().ok_or_else(|| {
            crate::error::ApiError::validation(
                "payroll.payslip",
                vec!["Employee dependent count must be a whole number from 0 to 1000".into()],
            )
        })?;
        let base_gross = salary
            .checked_mul(paid_days)
            .and_then(|amount| amount.checked_div(working_days))
            .map(|amount| amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
            .map(money::round_money)
            .ok_or_else(payroll_amount_error)?;
        let overtime_pay = if overtime_weighted_hours > Decimal::ZERO {
            calculate_overtime_pay(
                salary,
                working_days,
                employee_hours_per_day,
                overtime_weighted_hours,
            )?
        } else {
            Decimal::ZERO
        };
        let total_additions = additions
            .checked_add(overtime_pay)
            .map(money::round_money)
            .ok_or_else(payroll_amount_error)?;
        let gross = base_gross
            .checked_add(total_additions)
            .map(money::round_money)
            .ok_or_else(payroll_amount_error)?;
        if gross <= Decimal::ZERO {
            continue;
        }
        let (
            contribution_base_decimal,
            employee_contribution_decimal,
            employer_contribution_decimal,
        ) = if let Some(policy) = &contribution_policy {
            calculate_contributions(policy, contribution_exempt, base_gross, gross)?
        } else {
            (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO)
        };
        let mut taxable_gross = base_gross
            .checked_add(taxable_additions)
            .and_then(|amount| amount.checked_add(overtime_pay))
            .ok_or_else(payroll_amount_error)?;
        if contribution_policy
            .as_ref()
            .is_some_and(|policy| policy.employee_deductible_for_tax)
        {
            taxable_gross = taxable_gross
                .checked_sub(employee_contribution_decimal)
                .ok_or_else(payroll_amount_error)?;
        }
        taxable_gross = taxable_gross.max(Decimal::ZERO);
        let (taxable_income, income_tax) = if let Some(policy) = &tax_policy {
            calculate_income_tax(policy, &tax_residency, dependent_count, taxable_gross)?
        } else {
            (Decimal::ZERO, Decimal::ZERO)
        };
        let deductions = manual_deductions
            .checked_add(income_tax)
            .and_then(|amount| amount.checked_add(employee_contribution_decimal))
            .map(money::round_money)
            .ok_or_else(payroll_amount_error)?;
        if gross <= deductions {
            return Err(crate::error::ApiError::validation(
                "payroll.payslip",
                vec!["Payroll deductions and income tax cannot equal or exceed gross pay".into()],
            ));
        }
        let gross_decimal = money::round_money(gross);
        let deductions_decimal = money::round_money(deductions);
        let net_decimal = gross_decimal
            .checked_sub(deductions_decimal)
            .map(money::round_money)
            .ok_or_else(payroll_amount_error)?;
        let mut data = Map::new();
        data.insert("run".into(), json!(run_id.to_string()));
        data.insert("employee".into(), json!(employee.to_string()));
        data.insert("salary_basis".into(), decimal_json(salary)?);
        data.insert("paid_days".into(), decimal_json(paid_days)?);
        data.insert("working_days".into(), decimal_json(working_days)?);
        data.insert("work_weekdays".into(), work_weekdays);
        data.insert(
            "standard_hours_per_day".into(),
            decimal_json(employee_hours_per_day)?,
        );
        data.insert("additions".into(), decimal_json(total_additions)?);
        data.insert("overtime_hours".into(), decimal_json(overtime_hours)?);
        data.insert("overtime_pay".into(), decimal_json(overtime_pay)?);
        data.insert("gross".into(), decimal_json(gross_decimal)?);
        data.insert("deductions".into(), decimal_json(deductions_decimal)?);
        data.insert("net".into(), decimal_json(net_decimal)?);
        data.insert("taxable_income".into(), decimal_json(taxable_income)?);
        data.insert("income_tax".into(), decimal_json(income_tax)?);
        if let Some(revision_id) = salary_revision {
            data.insert("salary_revision".into(), json!(revision_id.to_string()));
        }
        data.insert(
            "contribution_base".into(),
            money::json_number(contribution_base_decimal).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "payroll.payslip",
                    vec!["Contribution base exceeds supported financial limits".into()],
                )
            })?,
        );
        data.insert(
            "employee_contribution".into(),
            money::json_number(employee_contribution_decimal).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "payroll.payslip",
                    vec!["Employee contribution exceeds supported financial limits".into()],
                )
            })?,
        );
        data.insert(
            "employer_contribution".into(),
            money::json_number(employer_contribution_decimal).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "payroll.payslip",
                    vec!["Employer contribution exceeds supported financial limits".into()],
                )
            })?,
        );
        if let Some(policy) = &contribution_policy {
            data.insert("contribution_policy".into(), json!(policy.id.to_string()));
        }
        if let Some(policy) = &tax_policy {
            data.insert("tax_policy".into(), json!(policy.id.to_string()));
        }
        kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                data,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        created += 1;
    }
    if created == 0 {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec![
                "Không tính được phiếu lương có số tiền dương từ ngày công và lương cơ bản".into(),
            ],
        ));
    }
    Ok(true)
}
