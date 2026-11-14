//! Pure hrm rules and lifecycle policies.
use crate::money;
use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value;
fn validate_period(document: &Value) -> Vec<String> {
    let start = document
        .get("start_date")
        .and_then(Value::as_str)
        .and_then(|value| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
        });
    let end = document
        .get("end_date")
        .and_then(Value::as_str)
        .and_then(|value| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
        });
    match (start, end) {
        (Some(start), Some(end)) if end < start => {
            vec!["Ngày kết thúc phải từ ngày bắt đầu trở đi".into()]
        }
        _ => Vec::new(),
    }
}

fn validate_leave_allocation(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if !document
        .get("employee")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        errors.push("Chọn nhân viên cho hạn mức nghỉ".into());
    }
    if !document
        .get("year")
        .and_then(Value::as_i64)
        .is_some_and(|year| (1900..=9999).contains(&year))
    {
        errors.push("Năm hạn mức phải là số nguyên từ 1900 đến 9999".into());
    }
    if !matches!(
        document.get("kind").and_then(Value::as_str),
        Some("annual" | "sick" | "unpaid" | "maternity" | "other")
    ) {
        errors.push("Chọn loại nghỉ hợp lệ cho hạn mức".into());
    }
    if !document
        .get("entitled_days")
        .and_then(money::decimal)
        .is_some_and(|days| days >= Decimal::ZERO)
    {
        errors.push("Số ngày nghỉ được hưởng phải là số không âm".into());
    }
    errors
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "employee" => validate_employment_dates(document),
        "leave_request" => validate_leave_request(document),
        "leave_allocation" => validate_leave_allocation(document),
        "salary_revision" => validate_salary_revision(document),
        "holiday" => {
            let mut errors = Vec::new();
            if document
                .get("pay_treatment")
                .and_then(Value::as_str)
                .is_some_and(|value| !matches!(value, "paid" | "unpaid"))
            {
                errors.push("Ngày lễ phải khai báo hưởng lương hoặc không hưởng lương".into());
            }
            errors
        }
        "attendance" => {
            let parse = |field: &str| {
                document
                    .get(field)
                    .and_then(Value::as_str)
                    .and_then(|value| {
                        DateTime::parse_from_rfc3339(value)
                            .map(|date| (date.timestamp_millis(), date.date_naive()))
                            .or_else(|_| {
                                NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
                                    .map(|date| (date.and_utc().timestamp_millis(), date.date()))
                            })
                            .or_else(|_| {
                                NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")
                                    .map(|date| (date.and_utc().timestamp_millis(), date.date()))
                            })
                            .ok()
                    })
            };
            let check_in = parse("check_in");
            let check_out = parse("check_out");
            let attendance_date = document
                .get("date")
                .and_then(Value::as_str)
                .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
            let mut errors = Vec::new();
            if check_in
                .zip(check_out)
                .is_some_and(|((start, _), (end, _))| end <= start)
            {
                errors.push("Giờ kết thúc phải sau giờ bắt đầu".into());
            }
            if check_out.is_some() && check_in.is_none() {
                errors.push("Cần ghi nhận giờ vào trước giờ ra".into());
            }
            let now = Utc::now().timestamp_millis();
            if check_in.is_some_and(|(timestamp, _)| timestamp > now)
                || check_out.is_some_and(|(timestamp, _)| timestamp > now)
            {
                errors.push("Không thể ghi nhận giờ chấm công trong tương lai".into());
            }
            if check_in
                .zip(attendance_date)
                .is_some_and(|((_, local_date), work_date)| local_date != work_date)
            {
                errors.push("Ngày chấm công phải trùng ngày địa phương của giờ vào".into());
            }
            errors
        }
        _ => Vec::new(),
    }
}

fn validate_leave_request(document: &Value) -> Vec<String> {
    let mut errors = validate_period(document);
    let partial_day = document
        .get("partial_day")
        .and_then(Value::as_str)
        .unwrap_or("full");
    if !matches!(partial_day, "full" | "morning" | "afternoon") {
        errors.push("Leave partial_day must be full, morning, or afternoon".into());
    }
    if partial_day != "full"
        && document.get("start_date").and_then(Value::as_str)
            != document.get("end_date").and_then(Value::as_str)
    {
        errors.push("Half-day leave must start and end on the same date".into());
    }
    errors
}

fn validate_employment_dates(document: &Value) -> Vec<String> {
    let parse = |field: &str| {
        document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|value| {
                NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
            })
    };
    let mut errors = Vec::new();
    if document
        .get("hire_date")
        .is_some_and(|value| !value.is_null())
        && parse("hire_date").is_none()
    {
        errors.push("Hire date must use YYYY-MM-DD".into());
    }
    if document
        .get("termination_date")
        .is_some_and(|value| !value.is_null())
        && parse("termination_date").is_none()
    {
        errors.push("Termination date must use YYYY-MM-DD".into());
    }
    if let (Some(hire), Some(termination)) = (parse("hire_date"), parse("termination_date"))
        && termination < hire
    {
        errors.push("Termination date cannot be before the hire date".into());
    }
    if document
        .get("tax_residency")
        .and_then(Value::as_str)
        .is_some_and(|residency| !matches!(residency, "resident" | "nonresident" | "exempt"))
    {
        errors.push("Tax residency must be resident, nonresident, or exempt".into());
    }
    if document
        .get("dependent_count")
        .is_some_and(|value| !value.is_null())
        && !document
            .get("dependent_count")
            .and_then(Value::as_i64)
            .is_some_and(|count| (0..=1000).contains(&count))
    {
        errors.push("Dependent count must be a whole number from 0 to 1000".into());
    }
    errors
}

fn validate_salary_revision(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let effective_from = document
        .get("effective_from")
        .and_then(Value::as_str)
        .and_then(|value| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
        });
    if effective_from.is_none() {
        errors.push("Cần nhập ngày hiệu lực hợp lệ cho điều chỉnh lương".into());
    }
    if effective_from.is_some_and(|date| date.day() != 1) {
        errors.push("Mức lương mới phải có hiệu lực từ ngày đầu tháng".into());
    }
    if !document
        .get("base_salary")
        .and_then(money::decimal)
        .is_some_and(|salary| salary > Decimal::ZERO)
    {
        errors.push("Mức lương mới phải lớn hơn 0".into());
    }
    if document
        .get("reason")
        .and_then(Value::as_str)
        .is_some_and(|reason| reason.trim().is_empty())
    {
        errors.push("Cần ghi lý do điều chỉnh lương".into());
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "employee"
        && current.get("status").and_then(Value::as_str) == Some("terminated")
        && ["hire_date", "termination_date"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec!["Employment dates are immutable after termination".into()]
    } else if entity == "salary_revision"
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
        && ["employee", "effective_from", "base_salary", "reason"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec![
            "Điều chỉnh lương đã gửi duyệt hoặc được duyệt không thể sửa thông tin nghiệp vụ"
                .into(),
        ]
    } else if entity == "employee"
        && (patch.get("source").is_some() || patch.get("source_id").is_some())
    {
        vec!["Nguồn tạo hồ sơ nhân viên do hệ thống quản lý và không được sửa".into()]
    } else if entity == "leave_request"
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
        && [
            "employee",
            "start_date",
            "end_date",
            "kind",
            "reason",
            "pay_treatment",
            "partial_day",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        vec!["Đơn nghỉ đã gửi duyệt hoặc được duyệt không thể sửa thông tin nghiệp vụ".into()]
    } else if entity == "leave_request"
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
        && patch.get("pay_treatment").is_some()
    {
        vec!["Đơn nghỉ đã gửi duyệt hoặc được duyệt không thể sửa thông tin nghiệp vụ".into()]
    } else if entity == "leave_allocation"
        && ["employee", "year", "kind"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec!["Không thể đổi nhân viên, năm hoặc loại nghỉ của hạn mức đã tạo".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "salary_revision"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
    {
        vec![
            "Điều chỉnh lương đã gửi duyệt hoặc được duyệt phải được giữ làm lịch sử kiểm toán"
                .into(),
        ]
    } else if entity == "leave_request"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
    {
        vec!["Đơn nghỉ đã gửi duyệt hoặc được duyệt phải được giữ làm lịch sử kiểm toán".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "employee" && action == "terminated" {
        let mut errors = validate_employment_dates(document);
        if document
            .get("termination_date")
            .and_then(Value::as_str)
            .is_none()
        {
            errors
                .push("Set the employee's termination date before terminating the employee".into());
        }
        errors
    } else if entity == "salary_revision" && matches!(action, "submitted" | "approved") {
        let mut errors = validate_salary_revision(document);
        if document.get("employee").and_then(Value::as_str).is_none() {
            errors.push("Cần chọn nhân viên cho điều chỉnh lương".into());
        }
        if document
            .get("effective_from")
            .and_then(Value::as_str)
            .is_none()
        {
            errors.push("Cần nhập ngày hiệu lực điều chỉnh lương".into());
        }
        errors
    } else if entity == "leave_request" && action == "submitted" {
        let mut errors = validate_leave_request(document);
        if document.get("start_date").and_then(Value::as_str).is_none()
            || document.get("end_date").and_then(Value::as_str).is_none()
        {
            errors.push("Cần nhập ngày bắt đầu và ngày kết thúc".into());
        }
        errors
    } else {
        Vec::new()
    }
}
