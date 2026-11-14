//! Pure project and timesheet rules.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn number(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "project" => {
            if let Some(budget) = document.get("budget").filter(|budget| !budget.is_null()) {
                if !money::decimal(budget).is_some_and(|value| value >= Decimal::ZERO) {
                    errors.push("Ngân sách dự án phải là số không âm".into());
                }
            }
        }
        "timesheet" => {
            if !number(document, "hours")
                .is_some_and(|hours| hours > Decimal::ZERO && hours <= Decimal::new(24, 0))
            {
                errors.push("Số giờ phải lớn hơn 0 và không vượt 24 giờ trong một ngày".into());
            }
            if document.get("rate").is_some_and(|rate| {
                !rate.is_null() && {
                    !money::decimal(rate).is_some_and(|rate| rate >= Decimal::ZERO)
                }
            }) {
                errors.push("Đơn giá giờ công phải là số không âm".into());
            }
            if document
                .get("date")
                .and_then(Value::as_str)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .is_none()
            {
                errors.push("Timesheet cần ngày làm việc hợp lệ".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "timesheet" if patch.get("amount").is_some() => {
            vec!["Thành tiền timesheet được hệ thống tính từ số giờ và đơn giá".into()]
        }
        "project"
            if current.get("status").and_then(Value::as_str) != Some("planned")
                && ["name", "party", "budget"]
                    .iter()
                    .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Thông tin chính của dự án chỉ được sửa khi còn ở trạng thái dự kiến".into()]
        }
        "task" if patch.get("project").is_some() => {
            vec!["Không chuyển công việc sang dự án khác sau khi tạo".into()]
        }
        "task_dependency" => {
            vec!["Quan hệ phụ thuộc không thể sửa; hãy xóa và tạo lại quan hệ".into()]
        }
        "task" if current.get("status").and_then(Value::as_str) == Some("done") => {
            vec!["Công việc đã hoàn tất không được sửa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "project" if document.get("status").and_then(Value::as_str) != Some("planned") => {
            vec!["Dự án đã bắt đầu phải được giữ làm dấu vết nghiệp vụ".into()]
        }
        "task" if document.get("status").and_then(Value::as_str) == Some("done") => {
            vec!["Công việc đã hoàn tất phải được giữ làm dấu vết dự án".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(_entity: &str, _action: &str, _document: &Value) -> Vec<String> {
    Vec::new()
}
