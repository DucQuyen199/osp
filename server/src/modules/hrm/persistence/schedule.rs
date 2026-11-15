//! Per-day work schedule overrides used by attendance and payroll.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::{Datelike, NaiveDate};
use serde_json::Value;
use uuid::Uuid;

fn pattern_employees(document: &Value) -> Option<Vec<Uuid>> {
    if let Some(employees) = document.get("employees").and_then(Value::as_array) {
        let parsed = employees
            .iter()
            .map(|id| id.as_str().and_then(|value| Uuid::parse_str(value).ok()))
            .collect::<Option<Vec<_>>>()?;
        (!parsed.is_empty() && parsed.len() <= 50).then_some(parsed)
    } else {
        document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .map(|id| vec![id])
    }
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "work_schedule_pattern" {
        return validate_pattern(tx, tenant, action, document).await;
    }
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

async fn validate_pattern(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "created" | "updated" | "removed" | "applied") {
        return Ok(Vec::new());
    }
    let Some(employees) = pattern_employees(document) else {
        return Ok(vec![
            "Shift rotation requires one employee or a valid team of employees".into(),
        ]);
    };
    let parse_date = |field: &str| {
        document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|value| {
                NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
            })
    };
    let (Some(start), Some(end)) = (parse_date("start_date"), parse_date("end_date")) else {
        return Ok(vec![
            "Shift rotation requires valid start_date and end_date".into(),
        ]);
    };
    let days = (end - start).num_days() + 1;
    if days <= 0 {
        return Ok(vec![
            "Shift rotation end_date must be on or after start_date".into(),
        ]);
    }
    let rows = days.saturating_mul(employees.len() as i64);
    let mut errors = Vec::new();
    if days > super::super::MAX_ROTATION_DAYS {
        errors.push("Một đợt áp dụng lịch luân phiên tối đa 10 năm".into());
    }
    if rows > super::super::MAX_GENERATED_SCHEDULE_ROWS {
        errors.push("Một đợt không được sinh quá 40.000 dòng lịch cho toàn bộ nhân viên".into());
    }
    if !errors.is_empty() {
        return Ok(errors);
    }
    let Some(timezone) = document.get("timezone").and_then(Value::as_str) else {
        return Ok(vec!["Shift rotation requires an IANA time zone".into()]);
    };
    if tx
        .query_opt(
            "SELECT 1 FROM pg_timezone_names WHERE name = $1 LIMIT 1",
            &[&timezone],
        )
        .await?
        .is_none()
    {
        errors.push("Shift rotation time zone must be a supported IANA name".into());
    }
    if action == "removed" {
        if document.get("status").and_then(Value::as_str) == Some("applied") {
            errors.push("An applied shift rotation cannot be deleted; its generated schedule is retained for payroll history".into());
        }
        return Ok(errors);
    }
    if action == "updated" && document.get("status").and_then(Value::as_str) == Some("applied") {
        errors.push(
            "An applied shift rotation is immutable; create a new rotation for a later period"
                .into(),
        );
        return Ok(errors);
    }
    if action == "applied" {
        let mut month = start.with_day(1).unwrap_or(start);
        let final_month = end.with_day(1).unwrap_or(end);
        while month <= final_month {
            let period = month.format("%Y-%m").to_string();
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("payroll-calendar:{}:{period}", tenant.id)],
            )
            .await?;
            if month == final_month {
                break;
            }
            month = if month.month() == 12 {
                NaiveDate::from_ymd_opt(month.year() + 1, 1, 1).unwrap_or(final_month)
            } else {
                NaiveDate::from_ymd_opt(month.year(), month.month() + 1, 1).unwrap_or(final_month)
            };
        }
    }
    let employee_rows = tx
        .query(
            "SELECT status, hire_date, termination_date FROM hrm__employee WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE",
            &[&tenant.id, &employees],
        )
        .await?;
    let employees_valid = employee_rows.len() == employees.len()
        && employee_rows.iter().all(|row| {
            let status: String = row.get(0);
            let hire_date: Option<NaiveDate> = row.get(1);
            let termination_date: Option<NaiveDate> = row.get(2);
            status == "active"
                && hire_date.is_none_or(|date| start >= date)
                && termination_date.is_none_or(|date| end <= date)
        });
    if !employees_valid {
        errors.push(
            "Every employee in the rotation must be active for the full schedule period".into(),
        );
    }
    if action != "applied" || !errors.is_empty() {
        return Ok(errors);
    }
    if tx
        .query_opt(
            "SELECT 1 FROM hrm__work_schedule_entry WHERE tenant_id = $1 AND employee = ANY($2::uuid[]) AND work_date BETWEEN $3 AND $4 LIMIT 1",
            &[&tenant.id, &employees, &start, &end],
        )
        .await?
        .is_some()
    {
        errors.push("The rotation overlaps existing daily schedule entries; remove or adjust those entries first".into());
    }
    let pattern_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .unwrap_or(Uuid::nil());
    if tx
        .query_opt(
            "SELECT 1 FROM hrm__work_schedule_pattern p WHERE p.tenant_id = $1 AND p.status = 'applied' AND p.start_date <= $4 AND p.end_date >= $3 AND p.id <> $5 AND (p.employee = ANY($2::uuid[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.employees, '[]'::jsonb)) AS team(value) WHERE team.value::uuid = ANY($2::uuid[]))) LIMIT 1",
            &[&tenant.id, &employees, &start, &end, &pattern_id],
        )
        .await?
        .is_some()
    {
        errors.push("The rotation overlaps another applied rotation for this employee".into());
    }
    let first_period = start.format("%Y-%m").to_string();
    let last_period = end.format("%Y-%m").to_string();
    if tx
        .query_opt(
            "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = ANY($2::uuid[]) AND r.period BETWEEN $3 AND $4 LIMIT 1",
            &[&tenant.id, &employees, &first_period, &last_period],
        )
        .await?
        .is_some()
    {
        errors.push("A shift rotation cannot be applied to a month that already contains a payslip".into());
    }
    if !errors.is_empty() {
        return Ok(errors);
    }
    let cycle_json = serde_json::to_string(document.get("cycle").ok_or_else(|| {
        crate::error::ApiError::validation(
            "hrm.work_schedule_pattern",
            vec!["Shift rotation cycle is required".into()],
        )
    })?)
    .map_err(|_| {
        crate::error::ApiError::validation(
            "hrm.work_schedule_pattern",
            vec!["Shift rotation cycle is invalid".into()],
        )
    })?;
    tx.execute(
        "INSERT INTO hrm__work_schedule_entry (tenant_id, id, created_at, updated_at, employee, work_date, is_working, start_at, end_at, break_minutes) \
         SELECT $1, gen_random_uuid(), now(), now(), team.employee, days.work_date::date, (slot.day->>'is_working')::boolean, \
           CASE WHEN (slot.day->>'is_working')::boolean THEN ((days.work_date::date + (slot.day->>'start_time')::time) AT TIME ZONE $6::text) ELSE NULL END, \
           CASE WHEN (slot.day->>'is_working')::boolean THEN ((days.work_date::date + (slot.day->>'end_time')::time + CASE WHEN (slot.day->>'end_time')::time <= (slot.day->>'start_time')::time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE $6::text) ELSE NULL END, \
           COALESCE((slot.day->>'break_minutes')::int, 0) \
         FROM unnest($2::uuid[]) AS team(employee) \
         CROSS JOIN generate_series($3::date, $4::date, interval '1 day') AS days(work_date) \
         CROSS JOIN LATERAL (SELECT $5::jsonb -> (((days.work_date::date - $3::date)::int % jsonb_array_length($5::jsonb))::int) AS day) AS slot",
        &[&tenant.id, &employees, &start, &end, &cycle_json, &timezone],
    )
    .await?;
    Ok(Vec::new())
}
