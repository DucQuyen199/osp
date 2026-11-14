//! Attendance date, employment, leave, and duplicate-record checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::NaiveDate;
use serde_json::Value;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "attendance" || !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    let Some(employee) = document
        .get("employee")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Chấm công cần tham chiếu nhân viên hợp lệ".into()]);
    };
    let Some(date) = document
        .get("date")
        .and_then(Value::as_str)
        .and_then(|value| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
        })
    else {
        return Ok(vec!["Chấm công cần ngày hợp lệ".into()]);
    };
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .unwrap_or(uuid::Uuid::nil());
    let employee_row = tx
        .query_opt(
            "SELECT status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &employee],
        )
        .await?
        .filter(|row| row.get::<_, String>(0) == "active");
    let mut errors = Vec::new();
    if employee_row.is_none() {
        errors.push("Chỉ chấm công cho nhân viên đang làm việc".into());
    }
    if tx
        .query_opt(
            "SELECT 1 FROM hrm__leave_request WHERE tenant_id = $1 AND employee = $2 AND status = 'approved' AND COALESCE(partial_day, 'full') = 'full' AND start_date <= $3 AND end_date >= $3 LIMIT 1",
            &[&tenant.id, &employee, &date],
        )
        .await?
        .is_some()
    {
        errors.push("Không thể chấm công trong ngày nghỉ phép đã được duyệt".into());
    }
    if tx
        .query_opt(
            "SELECT 1 FROM hrm__attendance WHERE tenant_id = $1 AND employee = $2 AND date = $3 AND id <> $4 LIMIT 1",
            &[&tenant.id, &employee, &date, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Nhân viên đã có bản ghi chấm công trong ngày này".into());
    }
    Ok(errors)
}
