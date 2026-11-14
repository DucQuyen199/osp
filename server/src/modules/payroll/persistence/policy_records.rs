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

    Ok(None)
}
