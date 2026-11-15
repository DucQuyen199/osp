//! Pure case, time-entry, and billing invariants.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn max_case_money() -> Decimal {
    Decimal::from(999_999_999_999_999_i64)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    validate_at(entity, document, chrono::Utc::now().date_naive())
}

pub fn validate_at(entity: &str, document: &Value, today: chrono::NaiveDate) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "case" => {
            if document
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
            {
                errors.push("Vụ việc cần có tiêu đề".into());
            }
            if document
                .get("opened_on")
                .is_some_and(|value| !value.is_null())
                && document
                    .get("opened_on")
                    .and_then(Value::as_str)
                    .filter(|date| date.len() == 10)
                    .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                    .is_none_or(|date| date > today)
            {
                errors.push("Ngày mở vụ việc phải hợp lệ và không nằm trong tương lai".into());
            }
        }
        "case_note" => {
            if document
                .get("body")
                .and_then(Value::as_str)
                .is_none_or(|body| body.trim().is_empty())
            {
                errors.push("Ghi chú vụ việc không được để trống".into());
            }
        }
        "time_entry" => {
            if !document
                .get("hours")
                .and_then(money::decimal)
                .is_some_and(|hours| hours > Decimal::ZERO && hours <= Decimal::from(24))
            {
                errors.push("Giờ công phải lớn hơn 0 và không vượt quá 24 giờ".into());
            }
            if !document
                .get("rate")
                .and_then(money::decimal)
                .is_some_and(|rate| rate >= Decimal::ZERO && rate <= max_case_money())
            {
                errors.push("Đơn giá giờ công phải nằm trong giới hạn tiền tệ cho phép".into());
            }
            if document.get("date").is_some_and(|value| !value.is_null()) {
                match document
                    .get("date")
                    .and_then(Value::as_str)
                    .filter(|date| date.len() == 10)
                    .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                {
                    None => errors.push("Giờ công cần ngày làm việc hợp lệ".into()),
                    Some(date) if date > today => {
                        errors.push("Ngày giờ công không thể nằm trong tương lai".into());
                    }
                    _ => {}
                }
            }
            if document
                .get("who")
                .and_then(Value::as_str)
                .is_some_and(|who| who.trim().is_empty())
            {
                errors.push("Người thực hiện không được để trống".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "time_entry" && action == "billed" {
        let mut errors = Vec::new();
        if !document
            .get("amount")
            .and_then(money::decimal)
            .is_some_and(|amount| amount > Decimal::ZERO && amount <= max_case_money())
        {
            errors.push("Chỉ xuất hóa đơn giờ công có số tiền lớn hơn 0".into());
        }
        if document
            .get("who")
            .and_then(Value::as_str)
            .is_none_or(|who| who.trim().is_empty())
        {
            errors.push("Cần ghi nhận người thực hiện trước khi xuất hóa đơn".into());
        }
        if document
            .get("date")
            .and_then(Value::as_str)
            .filter(|date| date.len() == 10)
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
            .is_none()
        {
            errors.push("Giờ công cần ngày làm việc hợp lệ trước khi xuất hóa đơn".into());
        }
        return errors;
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    match entity {
        "case" if current.get("status").and_then(Value::as_str) == Some("closed") => {
            vec!["Vụ việc đã đóng không thể sửa".into()]
        }
        "case_note" => vec!["Ghi chú vụ việc đã lưu không thể sửa".into()],
        "time_entry" if current.get("status").and_then(Value::as_str) == Some("billed") => {
            vec!["Giờ công đã xuất hóa đơn không thể sửa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("case_note", _) => vec!["Ghi chú vụ việc không thể xóa khỏi lịch sử".into()],
        ("time_entry", Some("billed")) => {
            vec!["Giờ công đã xuất hóa đơn không thể xóa khỏi lịch sử".into()]
        }
        ("case", Some("closed")) => vec!["Vụ việc đã đóng không thể xóa khỏi hồ sơ".into()],
        _ => Vec::new(),
    }
}
