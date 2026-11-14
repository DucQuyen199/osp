//! Leave allocation and request entitlement checks.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::Value;

async fn validate_leave_allocation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "created" | "updated" | "removed") {
        return Ok(Vec::new());
    }
    let Some(employee) = document
        .get("employee")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Hạn mức nghỉ cần nhân viên hợp lệ".into()]);
    };
    let employee_exists = tx
        .query_opt(
            "SELECT id FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &employee],
        )
        .await?
        .is_some();
    if !employee_exists {
        return Ok(vec!["Không tìm thấy nhân viên trong doanh nghiệp".into()]);
    }
    let Some(year) = document
        .get("year")
        .and_then(Value::as_i64)
        .filter(|year| (1900..=9999).contains(year))
        .map(|year| year as i32)
    else {
        return Ok(vec!["Hạn mức nghỉ cần năm hợp lệ".into()]);
    };
    let Some(kind) = document.get("kind").and_then(Value::as_str) else {
        return Ok(vec!["Hạn mức nghỉ cần loại nghỉ hợp lệ".into()]);
    };
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .unwrap_or(uuid::Uuid::nil());
    if matches!(action, "created" | "updated")
        && tx
            .query_opt(
                "SELECT 1 FROM hrm__leave_allocation WHERE tenant_id = $1 AND employee = $2 AND year = $3 AND kind = $4 AND id <> $5 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &employee, &year, &kind, &id],
            )
            .await?
            .is_some()
    {
        return Ok(vec!["Mỗi nhân viên chỉ có một hạn mức cho mỗi loại nghỉ và năm".into()]);
    }
    let used_days_text: String = tx
        .query_one_row(
            "SELECT COALESCE(SUM((SELECT count(*)::numeric FROM generate_series(GREATEST(lr.start_date, make_date($3, 1, 1))::timestamp, LEAST(lr.end_date, make_date($3, 12, 31))::timestamp, interval '1 day') AS leave_day(work_date) \
               JOIN hrm__employee e ON e.tenant_id = lr.tenant_id AND e.id = lr.employee \
               LEFT JOIN hrm__work_schedule_entry ws ON ws.tenant_id = e.tenant_id AND ws.employee = e.id AND ws.work_date = leave_day.work_date::date \
               WHERE CASE WHEN ws.id IS NULL THEN EXTRACT(ISODOW FROM leave_day.work_date)::int IN (SELECT value::int FROM jsonb_array_elements_text(COALESCE(e.work_weekdays, '[1,2,3,4,5]'::jsonb)) AS selected(value)) ELSE ws.is_working END \
                 AND NOT EXISTS (SELECT 1 FROM hrm__holiday h WHERE h.tenant_id = lr.tenant_id AND h.date = leave_day.work_date::date)) \
               * CASE WHEN lr.partial_day IN ('morning', 'afternoon') THEN 0.5::numeric ELSE 1::numeric END), 0)::text \
             FROM hrm__leave_request lr WHERE lr.tenant_id = $1 AND lr.employee = $2 AND lr.kind = $4 AND lr.status IN ('submitted', 'approved') \
               AND lr.start_date <= make_date($3, 12, 31) AND lr.end_date >= make_date($3, 1, 1)",
            &[&tenant.id, &employee, &year, &kind],
        )
        .await?
        .get(0);
    let used_days = money::decimal_str(&used_days_text).ok_or_else(|| {
        ApiError::validation(
            "hrm.leave_allocation.used_days",
            vec!["Reserved leave days are not a valid decimal amount".into()],
        )
    })?;
    if action == "removed" {
        if used_days > Decimal::ZERO {
            return Ok(vec![
                "Không thể xóa hạn mức đã được đơn nghỉ đang chờ hoặc đã duyệt sử dụng".into(),
            ]);
        }
    } else if let Some(entitled_days) = document.get("entitled_days").and_then(money::decimal)
        && used_days
            .checked_sub(entitled_days)
            .is_some_and(|excess| excess > Decimal::new(5, 3))
    {
        return Ok(vec![format!(
            "Hạn mức không thể thấp hơn số ngày đã đặt trước hoặc duyệt ({used_days:.2})"
        )]);
    }
    Ok(Vec::new())
}

async fn validate_leave_entitlement(
    tx: &Tx<'_>,
    tenant: &Tenant,
    employee: uuid::Uuid,
    request_id: uuid::Uuid,
    start: NaiveDate,
    end: NaiveDate,
    document: &Value,
) -> R<Vec<String>> {
    let Some(kind) = document.get("kind").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let rows = tx
        .query(
            "SELECT allocation.year::int, allocation.entitled_days::text, \
               (SELECT count(*)::numeric FROM generate_series(GREATEST($7::date, make_date(allocation.year::int, 1, 1))::timestamp, LEAST($8::date, make_date(allocation.year::int, 12, 31))::timestamp, interval '1 day') AS requested(work_date) \
                JOIN hrm__employee e ON e.tenant_id = allocation.tenant_id AND e.id = allocation.employee \
                LEFT JOIN hrm__work_schedule_entry ws ON ws.tenant_id = e.tenant_id AND ws.employee = e.id AND ws.work_date = requested.work_date::date \
                WHERE CASE WHEN ws.id IS NULL THEN EXTRACT(ISODOW FROM requested.work_date)::int IN (SELECT value::int FROM jsonb_array_elements_text(COALESCE(e.work_weekdays, '[1,2,3,4,5]'::jsonb)) AS selected(value)) ELSE ws.is_working END \
                  AND NOT EXISTS (SELECT 1 FROM hrm__holiday h WHERE h.tenant_id = allocation.tenant_id AND h.date = requested.work_date::date)) \
                * CASE WHEN $9::text IN ('morning', 'afternoon') THEN 0.5::numeric ELSE 1::numeric END)::text, \
               (SELECT COALESCE(SUM((SELECT count(*)::numeric FROM generate_series(GREATEST(lr.start_date, make_date(allocation.year::int, 1, 1))::timestamp, LEAST(lr.end_date, make_date(allocation.year::int, 12, 31))::timestamp, interval '1 day') AS reserved(work_date) \
                   JOIN hrm__employee e ON e.tenant_id = lr.tenant_id AND e.id = lr.employee \
                   LEFT JOIN hrm__work_schedule_entry ws ON ws.tenant_id = e.tenant_id AND ws.employee = e.id AND ws.work_date = reserved.work_date::date \
                   WHERE CASE WHEN ws.id IS NULL THEN EXTRACT(ISODOW FROM reserved.work_date)::int IN (SELECT value::int FROM jsonb_array_elements_text(COALESCE(e.work_weekdays, '[1,2,3,4,5]'::jsonb)) AS selected(value)) ELSE ws.is_working END \
                     AND NOT EXISTS (SELECT 1 FROM hrm__holiday h WHERE h.tenant_id = allocation.tenant_id AND h.date = reserved.work_date::date)) \
                   * CASE WHEN lr.partial_day IN ('morning', 'afternoon') THEN 0.5::numeric ELSE 1::numeric END), 0)::text \
                FROM hrm__leave_request lr WHERE lr.tenant_id = allocation.tenant_id AND lr.employee = allocation.employee AND lr.kind = allocation.kind \
                  AND lr.status IN ('submitted', 'approved') AND lr.id <> $4 AND lr.start_date <= make_date(allocation.year::int, 12, 31) AND lr.end_date >= make_date(allocation.year::int, 1, 1)) \
             FROM hrm__leave_allocation allocation WHERE allocation.tenant_id = $1 AND allocation.employee = $2 AND allocation.kind = $3 \
               AND allocation.year::int BETWEEN $5 AND $6 ORDER BY allocation.year",
            &[
                &tenant.id,
                &employee,
                &kind,
                &request_id,
                &start.year(),
                &end.year(),
                &start,
                &end,
                &document
                    .get("partial_day")
                    .and_then(Value::as_str)
                    .unwrap_or("full"),
            ],
        )
        .await?;
    let mut errors = Vec::new();
    for row in rows {
        let year: i32 = row.get(0);
        let entitlement_text: String = row.get(1);
        let requested_text: String = row.get(2);
        let reserved_text: String = row.get(3);
        let parse_days = |value: &str, field: &str| {
            money::decimal_str(value).ok_or_else(|| {
                ApiError::validation(
                    "hrm.leave_request.entitlement",
                    vec![format!(
                        "Stored {field} leave days are not a valid decimal amount"
                    )],
                )
            })
        };
        let entitlement = parse_days(&entitlement_text, "entitled")?;
        let requested = parse_days(&requested_text, "requested")?;
        let reserved = parse_days(&reserved_text, "reserved")?;
        let total = reserved.checked_add(requested).ok_or_else(|| {
            ApiError::validation(
                "hrm.leave_request.entitlement",
                vec!["Combined leave days exceed the supported decimal range".into()],
            )
        })?;
        if total
            .checked_sub(entitlement)
            .is_some_and(|excess| excess > Decimal::new(5, 3))
        {
            errors.push(format!(
                "Hạn mức nghỉ {kind} năm {year} không đủ: đã đặt/duyệt {reserved:.2} ngày, yêu cầu thêm {requested:.2}, hạn mức {entitlement:.2}"
            ));
        }
    }
    Ok(errors)
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "leave_allocation" {
        return validate_leave_allocation(tx, tenant, action, document).await;
    }
    if entity == "leave_request" && matches!(action, "submitted" | "approved") {
        let Some(employee) = document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            return Ok(vec!["Đơn nghỉ phép cần nhân viên hợp lệ".into()]);
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
                "Đơn nghỉ phép cần ngày bắt đầu và kết thúc hợp lệ".into(),
            ]);
        };
        if end < start {
            return Ok(vec!["Ngày kết thúc phải từ ngày bắt đầu trở đi".into()]);
        }
        let employee_row = tx
            .query_opt(
                "SELECT status, hire_date, termination_date FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?;
        let Some(employee_row) = employee_row.filter(|row| row.get::<_, String>(0) == "active")
        else {
            return Ok(vec![
                "Leave can only be submitted or approved for an active employee".into(),
            ]);
        };
        let hire_date: Option<NaiveDate> = employee_row.get(1);
        let termination_date: Option<NaiveDate> = employee_row.get(2);
        if hire_date.is_some_and(|hire_date| start < hire_date)
            || termination_date.is_some_and(|termination_date| end > termination_date)
        {
            return Ok(vec![
                "Leave dates must fall inside the employee's employment period".into(),
            ]);
        }
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .unwrap_or(uuid::Uuid::nil());
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__leave_request WHERE tenant_id = $1 AND employee = $2 AND id <> $3 AND status NOT IN ('draft', 'rejected') AND start_date <= $5 AND end_date >= $4 LIMIT 1",
                &[&tenant.id, &employee, &id, &start, &end],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Nhân viên đã có đơn nghỉ đang gửi duyệt hoặc được duyệt trùng khoảng thời gian này".into()]);
        }
        if action == "approved"
            && document
                .get("partial_day")
                .and_then(Value::as_str)
                .unwrap_or("full")
                == "full"
            && tx
                .query_opt(
                    "SELECT 1 FROM hrm__attendance WHERE tenant_id = $1 AND employee = $2 AND date BETWEEN $3 AND $4 LIMIT 1",
                    &[&tenant.id, &employee, &start, &end],
                )
                .await?
                .is_some()
        {
            return Ok(vec![
                "Không thể duyệt ngày nghỉ đã có bản ghi chấm công".into(),
            ]);
        }
        return validate_leave_entitlement(tx, tenant, employee, id, start, end, document).await;
    }
    Ok(Vec::new())
}
