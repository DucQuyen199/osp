//! Employee identity, employment, and salary-history persistence rules.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use chrono::{Datelike, NaiveDate};
use serde_json::Value;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "employee" && action == "terminated" {
        let Some(employee) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            return Ok(vec![
                "Employee termination requires a valid employee".into(),
            ]);
        };
        let Some(termination_date) = document
            .get("termination_date")
            .and_then(Value::as_str)
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        else {
            return Ok(vec![
                "Set a valid termination date before terminating the employee".into(),
            ]);
        };
        let Some(row) = tx
            .query_opt(
                "SELECT hire_date, status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?
        else {
            return Ok(vec!["Employee does not belong to this tenant".into()]);
        };
        let hire_date: Option<NaiveDate> = row.get(0);
        let status: String = row.get(1);
        if status != "active" {
            return Ok(vec!["Only an active employee can be terminated".into()]);
        }
        if hire_date.is_some_and(|hire_date| termination_date < hire_date) {
            return Ok(vec![
                "Termination date cannot be before the hire date".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__attendance WHERE tenant_id = $1 AND employee = $2 AND date > $3 AND check_in IS NOT NULL AND check_out IS NOT NULL LIMIT 1",
                &[&tenant.id, &employee, &termination_date],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Resolve attendance recorded after the termination date before terminating the employee".into()]);
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__leave_request WHERE tenant_id = $1 AND employee = $2 AND status IN ('submitted', 'approved') AND end_date > $3 LIMIT 1",
                &[&tenant.id, &employee, &termination_date],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Resolve pending or approved leave after the termination date before terminating the employee".into()]);
        }
    }
    if entity == "salary_revision"
        && matches!(action, "created" | "updated" | "submitted" | "approved")
    {
        let Some(employee) = document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            return Ok(vec![
                "Điều chỉnh lương cần tham chiếu nhân viên hợp lệ".into(),
            ]);
        };
        let Some(effective_from) = document
            .get("effective_from")
            .and_then(Value::as_str)
            .and_then(|value| {
                NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
            })
        else {
            return Ok(vec!["Điều chỉnh lương cần ngày hiệu lực hợp lệ".into()]);
        };
        if action == "approved" {
            let revision_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .unwrap_or(uuid::Uuid::nil());
            let period = format!("{:04}-{:02}", effective_from.year(), effective_from.month());
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("payroll-calendar:{}:{period}", tenant.id)],
            )
            .await?;
            if tx.query_opt(
                "SELECT 1 FROM hrm__salary_revision WHERE tenant_id = $1 AND employee = $2 AND effective_from = $3 AND status = 'approved' AND id <> $4 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &employee, &effective_from, &revision_id],
            ).await?.is_some() {
                return Ok(vec!["Đã có điều chỉnh lương được duyệt cho nhân viên trong tháng hiệu lực này".into()]);
            }
            if tx.query_opt(
                "SELECT 1 FROM payroll__payslip p JOIN payroll__payroll_run r ON r.tenant_id = p.tenant_id AND r.id = p.run WHERE p.tenant_id = $1 AND p.employee = $2 AND to_date(r.period || '-01', 'YYYY-MM-DD') >= $3 LIMIT 1",
                &[&tenant.id, &employee, &effective_from],
            ).await?.is_some() {
                return Ok(vec!["Không thể duyệt điều chỉnh lương vì đã có phiếu lương trong tháng hiệu lực hoặc các tháng sau; hãy xử lý lại bảng lương trước".into()]);
            }
        }
        let employee_row = tx
            .query_opt(
                "SELECT status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?;
        if !employee_row.is_some_and(|row| row.get::<_, String>(0) == "active") {
            return Ok(vec![
                "Chỉ điều chỉnh lương cho nhân viên đang làm việc".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "employee" && action == "updated" {
        let Some(employee) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            return Ok(Vec::new());
        };
        let old = tx.query_opt(
            "SELECT base_salary::text, work_weekdays::text, standard_hours_per_day::text FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &employee],
        ).await?;
        let old_work_weekdays = old.as_ref().and_then(|row| {
            row.get::<_, Option<String>>(1)
                .as_deref()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
        });
        let old_hours_text = old.as_ref().and_then(|row| row.get::<_, Option<String>>(2));
        let old_salary_text = old.and_then(|row| row.get::<_, Option<String>>(0));
        let old_salary = old_salary_text
            .map(|value| {
                money::decimal_str(&value).ok_or_else(|| {
                    ApiError::validation(
                        "hrm.employee.base_salary",
                        vec!["Stored employee salary is not a valid decimal amount".into()],
                    )
                })
            })
            .transpose()?;
        let new_salary = document.get("base_salary").and_then(money::decimal);
        let salary_changed = old_salary != new_salary;
        if salary_changed {
            return Ok(vec!["Mức lương sau khi tạo hồ sơ phải được thay đổi bằng điều chỉnh lương có ngày hiệu lực; không sửa trực tiếp trên hồ sơ nhân viên".into()]);
        }
        let new_work_weekdays = document
            .get("work_weekdays")
            .filter(|value| !value.is_null());
        let old_work_weekdays = old_work_weekdays.as_ref().filter(|value| !value.is_null());
        let work_week_changed = old_work_weekdays != new_work_weekdays;
        let old_hours = old_hours_text.as_deref().and_then(money::decimal_str);
        let new_hours = document
            .get("standard_hours_per_day")
            .and_then(money::decimal);
        if (work_week_changed || old_hours != new_hours)
            && tx
                .query_opt(
                    "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = $2 AND r.status = 'draft' LIMIT 1",
                    &[&tenant.id, &employee],
                )
                .await?
                .is_some()
        {
            return Ok(vec!["Complete or cancel draft payroll runs with this employee's payslip before changing their work schedule".into()]);
        }
    }
    if entity == "employee" && matches!(action, "created" | "updated") {
        if let Some(code) = document
            .get("code")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|code| !code.is_empty())
        {
            let normalized = code.to_ascii_uppercase();
            let lock_key = format!("hrm:employee-code:{}:{normalized}", tenant.id);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .unwrap_or(uuid::Uuid::nil());
            if tx
                .query_opt(
                    "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND upper(btrim(code)) = $2 AND id <> $3 LIMIT 1",
                    &[&tenant.id, &normalized, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Employee code is already assigned to another employee in this company".into()]);
            }
        }
        let Some(email) = document
            .get("email")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|email| !email.is_empty())
        else {
            return Ok(Vec::new());
        };
        let key = format!("{}:{}", tenant.id, email.to_lowercase());
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&key],
        )
        .await?;
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .unwrap_or(uuid::Uuid::nil());
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND lower(btrim(email)) = lower(btrim($2)) AND id <> $3 LIMIT 1",
                &[&tenant.id, &email, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Email đã thuộc về nhân viên khác trong doanh nghiệp".into()]);
        }
        return Ok(Vec::new());
    }
    Ok(Vec::new())
}
