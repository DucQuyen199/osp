//! Per-day work schedule overrides used by attendance and payroll.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::NaiveDate;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "created" | "updated" | "removed") {
        return Ok(Vec::new());
    }
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or(Uuid::nil());
    let old = if matches!(action, "updated" | "removed") && id != Uuid::nil() {
        tx.query_opt(
            "SELECT employee, work_date FROM hrm__work_schedule_entry WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?
    } else {
        None
    };
    let employee = if action == "removed" {
        old.as_ref().map(|row| row.get::<_, Uuid>(0))
    } else {
        document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    };
    let work_date = if action == "removed" {
        old.as_ref().map(|row| row.get::<_, NaiveDate>(1))
    } else {
        document
            .get("work_date")
            .and_then(Value::as_str)
            .and_then(|value| {
                NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
            })
    };
    let (Some(employee), Some(work_date)) = (employee, work_date) else {
        return Ok(vec![
            "Work schedule requires a valid employee and work_date".into(),
        ]);
    };
    let period = work_date.format("%Y-%m").to_string();
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("payroll-calendar:{}:{period}", tenant.id)],
    )
    .await?;
    let mut errors = Vec::new();
    if action != "removed" {
        let employee_row = tx
            .query_opt(
                "SELECT status, hire_date, termination_date FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?;
        if !employee_row.is_some_and(|row| {
            let status: String = row.get(0);
            let hire_date: Option<NaiveDate> = row.get(1);
            let termination_date: Option<NaiveDate> = row.get(2);
            status == "active"
                && hire_date.is_none_or(|date| work_date >= date)
                && termination_date.is_none_or(|date| work_date <= date)
        }) {
            errors.push("Work schedule can only be set for an active employee during their employment dates".into());
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__work_schedule_entry WHERE tenant_id = $1 AND employee = $2 AND work_date = $3 AND id <> $4 LIMIT 1",
                &[&tenant.id, &employee, &work_date, &id],
            )
            .await?
            .is_some()
        {
            errors.push("Employee already has a work schedule entry for this date".into());
        }
    }
    if tx
        .query_opt(
            "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = $2 AND r.period = $3 LIMIT 1",
            &[&tenant.id, &employee, &period],
        )
        .await?
        .is_some()
    {
        errors.push(format!("Work schedule entries for {period} are locked because a payslip already exists"));
    }
    Ok(errors)
}
