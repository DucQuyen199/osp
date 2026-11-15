//! Tenant-scoped payroll and contribution policy checks.
use super::*;

pub(super) async fn validate_policy_records(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Option<Vec<String>>> {
    let mut errors = Vec::new();
    if entity == "tax_deduction" && action == "created" {
        if document
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status != "draft")
        {
            errors.push("Tax deduction claims must be created as drafts and submitted through the review workflow".into());
        }
        if document
            .get("approved_amount")
            .and_then(money::decimal)
            .is_some_and(|amount| amount > Decimal::ZERO)
        {
            errors.push("Approved deduction amounts can only be entered by a separate reviewer after submission".into());
        }
        return Ok(Some(errors));
    }
    if entity == "contribution_policy" && action == "approved" {
        let Some(policy_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(Some(vec![
                "Payroll contribution policy requires a valid record id".into(),
            ]));
        };
        let parse = |field: &str| {
            document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        };
        let (Some(start), Some(end)) = (
            parse("effective_from"),
            parse("effective_to").or(Some(NaiveDate::MAX)),
        ) else {
            return Ok(Some(vec![
                "Payroll contribution policy requires a valid effective date range".into(),
            ]));
        };
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("payroll-policy-calendar:{}", tenant.id)],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__contribution_policy WHERE tenant_id = $1 AND status = 'approved' AND id <> $2 AND effective_from <= $4 AND COALESCE(effective_to, '9999-12-31'::date) >= $3 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &policy_id, &start, &end],
            )
            .await?
            .is_some()
        {
            errors.push("Approved contribution policy date ranges cannot overlap".into());
        }
        for (field, expected_kind) in [
            ("liability_account", "liability"),
            ("employer_expense_account", "expense"),
        ] {
            let account_id = document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let account_kind = if let Some(account_id) = account_id {
                tx.query_opt(
                    "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &account_id],
                )
                .await?
                .map(|row| row.get::<_, String>(0))
            } else {
                None
            };
            if account_kind.as_deref() != Some(expected_kind) {
                errors.push(format!(
                    "Contribution policy {field} must be a tenant-owned {expected_kind} account"
                ));
            }
        }
        return Ok(Some(errors));
    }
    if entity == "contribution_remittance"
        && matches!(action, "created" | "submitted" | "approved" | "paid")
    {
        let remittance_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let policy_id = document
            .get("policy")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let period = document.get("period").and_then(Value::as_str);
        let Some((remittance_id, policy_id, period, period_start)) = remittance_id
            .zip(policy_id)
            .zip(period)
            .and_then(|((remittance, policy), period)| {
                NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d")
                    .ok()
                    .map(|start| (remittance, policy, period, start))
            })
        else {
            return Ok(Some(vec![
                "Contribution remittance requires an id, policy and valid period".into(),
            ]));
        };
        if matches!(action, "approved" | "paid") {
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!(
                    "payroll-contribution-remittance:{}:{period}",
                    tenant.id
                )],
            )
            .await?;
        }
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__contribution_policy WHERE tenant_id = $1 AND id = $2 AND status = 'approved' AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3) FOR SHARE",
                &[&tenant.id, &policy_id, &period_start],
            )
            .await?
            .is_none()
        {
            errors.push("Contribution remittance policy must be approved and effective for its payroll period".into());
        }
        let accrual = tx
            .query_opt(
                "SELECT count(*), COALESCE(sum(payslip.employee_contribution + payslip.employer_contribution), 0)::text FROM payroll__payslip payslip JOIN payroll__payroll_run run ON run.tenant_id = payslip.tenant_id AND run.id = payslip.run WHERE payslip.tenant_id = $1 AND run.period = $2 AND run.status IN ('approved', 'paid') AND payslip.contribution_policy = $3",
                &[&tenant.id, &period, &policy_id],
            )
            .await?;
        let (payslip_count, accrued_amount) = if let Some(row) = accrual {
            (
                row.get::<_, i64>(0),
                decimal_column(&row, 1, "contribution accrual")?,
            )
        } else {
            (0, Decimal::ZERO)
        };
        if payslip_count == 0 || accrued_amount <= Decimal::ZERO {
            errors.push(
                "No approved payroll contribution accrual exists for this period and policy".into(),
            );
        }
        let reserved_row = tx
            .query_one_row(
                "SELECT COALESCE(sum(amount), 0)::text FROM payroll__contribution_remittance WHERE tenant_id = $1 AND period = $2 AND policy = $3 AND status IN ('approved', 'paid') AND id <> $4",
                &[&tenant.id, &period, &policy_id, &remittance_id],
            )
            .await?;
        let reserved_amount = decimal_column(&reserved_row, 0, "reserved contributions")?;
        let amount = decimal_field(document, "amount").unwrap_or(Decimal::ZERO);
        if amount <= Decimal::ZERO
            || amount.checked_add(reserved_amount).is_none_or(|reserved| {
                reserved > accrued_amount
                    && !money::within_tolerance(reserved, accrued_amount, Decimal::new(5, 3))
            })
        {
            errors.push("Approved and paid remittances cannot exceed the accrued employee and employer contributions".into());
        }
        if action == "paid" {
            if !tenant.has_module("accounting") {
                errors.push(
                    "Accounting must be enabled to record contribution remittance payments".into(),
                );
            }
            let cash_code =
                if document.get("payment_method").and_then(Value::as_str) == Some("bank") {
                    "112"
                } else {
                    "111"
                };
            if tx
                .query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &cash_code],
                )
                .await?
                .is_none()
            {
                errors.push(format!(
                    "Missing accounting account {cash_code} for the remittance payment"
                ));
            }
        }
        return Ok(Some(errors));
    }
    if entity == "overtime_entry" && action == "approved" {
        let employee = document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let entry_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let submitted_hours = document
            .get("hours")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let date = document
            .get("date")
            .and_then(Value::as_str)
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
        let (Some(employee), Some(entry_id), Some(date)) = (employee, entry_id, date) else {
            return Ok(Some(vec![
                "Overtime approval requires a valid record, employee and date".into(),
            ]));
        };
        let period = format!("{:04}-{:02}", date.year(), date.month());
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("payroll-calendar:{}:{period}", tenant.id)],
        )
        .await?;
        let employee_row = tx
            .query_opt(
                "SELECT status, hire_date, termination_date FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?;
        if let Some(row) = employee_row {
            let status: String = row.get(0);
            let hire_date: Option<NaiveDate> = row.get(1);
            let termination_date: Option<NaiveDate> = row.get(2);
            if !matches!(status.as_str(), "active" | "terminated")
                || hire_date.is_some_and(|hire| date < hire)
                || termination_date.is_some_and(|end| date > end)
            {
                errors.push(
                    "Overtime date must fall within the employee's employment interval".into(),
                );
            }
        } else {
            errors.push("Overtime entry employee must belong to this tenant".into());
        }
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = $2 AND r.period = $3 LIMIT 1",
                &[&tenant.id, &employee, &period],
            )
            .await?
            .is_some()
        {
            errors.push("Cancel and recalculate the draft payroll before approving overtime for a month with payslips".into());
        }
        let approved_hours_row = tx
            .query_one_row(
                "SELECT COALESCE(sum(hours), 0)::text FROM payroll__overtime_entry WHERE tenant_id = $1 AND employee = $2 AND date = $3 AND id <> $4 AND status = 'approved'",
                &[&tenant.id, &employee, &date, &entry_id],
            )
            .await?;
        let approved_hours = decimal_column(&approved_hours_row, 0, "approved overtime hours")?;
        if approved_hours
            .checked_add(submitted_hours)
            .is_none_or(|hours| hours > Decimal::from(24))
        {
            errors.push("Approved overtime hours cannot exceed 24 per employee per day".into());
        }
        return Ok(Some(errors));
    }
    if entity == "tax_policy" && action == "approved" {
        let Some(policy_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(Some(vec![
                "Payroll tax policy requires a valid record id".into(),
            ]));
        };
        let parse = |field: &str| {
            document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        };
        let (Some(start), Some(end)) = (
            parse("effective_from"),
            parse("effective_to").or(Some(NaiveDate::MAX)),
        ) else {
            return Ok(Some(vec![
                "Payroll tax policy requires a valid effective date range".into(),
            ]));
        };
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("payroll-policy-calendar:{}", tenant.id)],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__tax_policy WHERE tenant_id = $1 AND status = 'approved' AND id <> $2 AND effective_from <= $4 AND COALESCE(effective_to, '9999-12-31'::date) >= $3 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &policy_id, &start, &end],
            )
            .await?
            .is_some()
        {
            errors.push("Approved payroll tax policy date ranges cannot overlap".into());
        }
        let account = document
            .get("tax_account")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let account_kind = if let Some(account) = account {
            tx.query_opt(
                "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &account],
            )
            .await?
            .map(|row| row.get::<_, String>(0))
        } else {
            None
        };
        if account_kind.as_deref() != Some("liability") {
            errors.push("Payroll tax account must be a tenant-owned liability account".into());
        }
        return Ok(Some(errors));
    }

    if entity == "tax_deduction" && action == "approved" {
        let Some(claim_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(Some(vec![
                "Tax deduction claim requires a valid record id".into(),
            ]));
        };
        let Some(employee_id) = document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(Some(vec![
                "Tax deduction claim requires a valid employee".into(),
            ]));
        };
        let Some(year) = document
            .get("tax_year")
            .and_then(Value::as_str)
            .and_then(|year| year.parse::<i32>().ok())
        else {
            return Ok(Some(vec![
                "Tax deduction claim requires a valid tax year".into(),
            ]));
        };
        let category = document
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let cap_field = match category {
            "medical" => "annual_medical_deduction_cap",
            "education" => "annual_education_deduction_cap",
            _ => return Ok(Some(vec!["Tax deduction category is invalid".into()])),
        };
        let year_start = chrono::NaiveDate::from_ymd_opt(year, 1, 1);
        let year_end = chrono::NaiveDate::from_ymd_opt(year, 12, 31);
        let (Some(year_start), Some(year_end)) = (year_start, year_end) else {
            return Ok(Some(vec![
                "Tax deduction year is outside the supported range".into(),
            ]));
        };
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!(
                "payroll-tax-deduction:{}:{}:{}",
                tenant.id, employee_id, year
            )],
        )
        .await?;

        let policy = tx
            .query_opt(
                &format!(
                    "SELECT min({cap_field})::text, max({cap_field})::text, count(*), count({cap_field}), bool_and(COALESCE(annual_deductions_require_resident, false)), bool_or(COALESCE(annual_deductions_require_resident, false)) FROM payroll__tax_policy WHERE tenant_id = $1 AND status = 'approved' AND effective_from <= $3 AND COALESCE(effective_to, '9999-12-31'::date) >= $2"
                ),
                &[&tenant.id, &year_start, &year_end],
            )
            .await?;
        let Some(policy) = policy else {
            return Ok(Some(vec!["Approve an effective tax policy with an annual deduction cap before approving claims".into()]));
        };
        let min_cap: Option<String> = policy.get(0);
        let max_cap: Option<String> = policy.get(1);
        let policy_count: i64 = policy.get(2);
        let configured_policy_count: i64 = policy.get(3);
        let require_resident_and = policy.get::<_, Option<bool>>(4).unwrap_or(false);
        let require_resident_or = policy.get::<_, Option<bool>>(5).unwrap_or(false);
        let Some(min_cap) = min_cap.and_then(|value| money::decimal_str(&value)) else {
            return Ok(Some(vec![
                "Tax deduction cap is not configured in an approved tax policy".into(),
            ]));
        };
        let Some(max_cap) = max_cap.and_then(|value| money::decimal_str(&value)) else {
            return Ok(Some(vec![
                "Tax deduction cap is not configured in an approved tax policy".into(),
            ]));
        };
        if policy_count == 0
            || configured_policy_count != policy_count
            || min_cap != max_cap
            || min_cap <= Decimal::ZERO
            || require_resident_and != require_resident_or
        {
            return Ok(Some(vec!["Approved tax policies for this year must configure one consistent positive annual cap for this deduction category".into()]));
        }
        if require_resident_and {
            let residency = tx
                .query_opt(
                    "SELECT tax_residency FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &employee_id],
                )
                .await?
                .map(|row| row.get::<_, Option<String>>(0))
                .flatten();
            if residency.as_deref().unwrap_or("resident") != "resident" {
                errors.push("Annual medical and education deduction claims are restricted to resident taxpayers under the configured tax policy".into());
            }
        }

        let receipt_number = document
            .get("receipt_number")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        let provider_name = document
            .get("provider_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__tax_deduction WHERE tenant_id = $1 AND id <> $2 AND employee = $3 AND tax_year = $4 AND lower(btrim(receipt_number)) = lower($5) AND lower(btrim(provider_name)) = lower($6) AND status = 'approved' LIMIT 1 FOR UPDATE",
                &[&tenant.id, &claim_id, &employee_id, &year.to_string(), &receipt_number, &provider_name],
            )
            .await?
            .is_some()
        {
            errors.push("This provider receipt has already been approved for the employee and tax year".into());
        }

        let approved_amount = document
            .get("approved_amount")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let current = tx
            .query_opt(
                "SELECT COALESCE(sum(approved_amount::numeric), 0)::text FROM payroll__tax_deduction WHERE tenant_id = $1 AND employee = $2 AND tax_year = $3 AND category = $4 AND status = 'approved' AND id <> $5",
                &[&tenant.id, &employee_id, &year.to_string(), &category, &claim_id],
            )
            .await?;
        let current_amount = current
            .as_ref()
            .and_then(|row| row.get::<_, Option<String>>(0))
            .and_then(|value| money::decimal_str(&value))
            .unwrap_or(Decimal::ZERO);
        if current_amount
            .checked_add(approved_amount)
            .is_none_or(|sum| sum > min_cap)
        {
            errors.push("Approved deductions for this employee exceed the annual category cap; reduce this claim to the remaining eligible amount".into());
        }
        return Ok(Some(errors));
    }

    Ok(None)
}
