//! Pure hrm rules and lifecycle policies.
use crate::money;
use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, NaiveTime, Utc};
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
        "work_schedule_entry" => validate_work_schedule_entry(document),
        "work_schedule_pattern" => validate_work_schedule_pattern(document),
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

fn validate_work_schedule_entry(document: &Value) -> Vec<String> {
    let Some(work_date) = document
        .get("work_date")
        .and_then(Value::as_str)
        .and_then(|value| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
        })
    else {
        return vec!["Work schedule requires a valid work_date".into()];
    };
    let is_working = document.get("is_working").and_then(Value::as_bool);
    let mut errors = Vec::new();
    if is_working.is_none() {
        errors.push("Work schedule requires is_working".into());
    }
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
    let start = parse("start_at");
    let end = parse("end_at");
    let break_minutes = document
        .get("break_minutes")
        .and_then(money::decimal)
        .unwrap_or(Decimal::ZERO);
    if break_minutes < Decimal::ZERO || break_minutes.fract() != Decimal::ZERO {
        errors.push("Work shift break_minutes must be a non-negative whole number".into());
    }
    match is_working {
        Some(true) => {
            let (Some((start_ms, start_date)), Some((end_ms, _))) = (start, end) else {
                errors.push("Working schedule entries require start_at and end_at".into());
                return errors;
            };
            if start_date != work_date {
                errors.push(
                    "Shift start_at must fall on work_date in the supplied local time zone".into(),
                );
            }
            let duration_ms = end_ms - start_ms;
            if duration_ms <= 0 || duration_ms > 24 * 60 * 60 * 1000 {
                errors.push(
                    "Shift end_at must be after start_at and no more than 24 hours later".into(),
                );
            } else if break_minutes * Decimal::from(60_000) >= Decimal::from(duration_ms) {
                errors.push("Shift break_minutes must be shorter than the scheduled shift".into());
            }
        }
        Some(false) => {
            if start.is_some() || end.is_some() || break_minutes > Decimal::ZERO {
                errors.push(
                    "Non-working schedule entries cannot include shift times or breaks".into(),
                );
            }
        }
        None => {}
    }
    errors
}

fn validate_work_schedule_pattern(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let parse_date = |field: &str| {
        document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|value| {
                NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
            })
    };
    let (Some(start), Some(end)) = (parse_date("start_date"), parse_date("end_date")) else {
        return vec!["Shift rotation requires valid start_date and end_date".into()];
    };
    if end < start {
        errors.push("Shift rotation end_date must be on or after start_date".into());
    } else if (end - start).num_days() > 365 {
        errors.push("A shift rotation can generate at most 366 calendar days at a time".into());
    }
    if document
        .get("timezone")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        errors.push("Shift rotation requires an IANA time zone".into());
    }
    let Some(cycle) = document.get("cycle").and_then(Value::as_array) else {
        return {
            errors.push("Shift rotation cycle must be a JSON array".into());
            errors
        };
    };
    if cycle.is_empty() || cycle.len() > 31 {
        errors.push("Shift rotation cycle must contain between 1 and 31 days".into());
    }
    for (index, day) in cycle.iter().enumerate() {
        let working = day.get("is_working").and_then(Value::as_bool);
        let start_time = day
            .get("start_time")
            .and_then(Value::as_str)
            .and_then(|value| NaiveTime::parse_from_str(value, "%H:%M").ok());
        let end_time = day
            .get("end_time")
            .and_then(Value::as_str)
            .and_then(|value| NaiveTime::parse_from_str(value, "%H:%M").ok());
        let break_minutes = day
            .get("break_minutes")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        if break_minutes < Decimal::ZERO || break_minutes.fract() != Decimal::ZERO {
            errors.push(format!(
                "Shift rotation day {} break must be a non-negative whole number of minutes",
                index + 1
            ));
        }
        match working {
            Some(true) => {
                let (Some(start_time), Some(end_time)) = (start_time, end_time) else {
                    errors.push(format!(
                        "Shift rotation day {} requires valid start_time and end_time",
                        index + 1
                    ));
                    continue;
                };
                let mut duration = (end_time - start_time).num_minutes();
                if duration <= 0 {
                    duration += 24 * 60;
                }
                if break_minutes >= Decimal::from(duration) {
                    errors.push(format!("Shift rotation day {} requires a whole-minute break shorter than its shift", index + 1));
                }
            }
            Some(false) => {
                if start_time.is_some() || end_time.is_some() || break_minutes > Decimal::ZERO {
                    errors.push(format!(
                        "Non-working rotation day {} cannot include times or a break",
                        index + 1
                    ));
                }
            }
            None => errors.push(format!(
                "Shift rotation day {} requires is_working",
                index + 1
            )),
        }
    }
    errors
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
    match document.get("work_weekdays") {
        None | Some(Value::Null) => {}
        Some(Value::Array(days)) => {
            let unique: std::collections::HashSet<_> =
                days.iter().filter_map(Value::as_u64).collect();
            if days.is_empty()
                || days.len() > 7
                || unique.len() != days.len()
                || days
                    .iter()
                    .any(|day| !day.as_u64().is_some_and(|day| (1..=7).contains(&day)))
            {
                errors.push("Employee work_weekdays must be a non-empty list of unique ISO weekdays from 1 to 7".into());
            }
        }
        _ => errors.push("Employee work_weekdays must be a JSON array of ISO weekdays".into()),
    }
    if document
        .get("standard_hours_per_day")
        .is_some_and(|value| !value.is_null())
        && !document
            .get("standard_hours_per_day")
            .and_then(money::decimal)
            .is_some_and(|hours| (Decimal::ONE..=Decimal::from(24)).contains(&hours))
    {
        errors.push("Employee standard_hours_per_day must be between 1 and 24".into());
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
    if entity == "work_schedule_entry"
        && ["employee", "work_date"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec!["A work schedule entry cannot be moved to another employee or date; remove it and create a new entry".into()]
    } else if entity == "work_schedule_pattern"
        && current.get("status").and_then(Value::as_str) == Some("applied")
    {
        vec![
            "An applied shift rotation is immutable; create a new rotation for a later period"
                .into(),
        ]
    } else if entity == "employee"
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
