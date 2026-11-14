//! Pure enrollment, grading, and tuition lifecycle policies.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn positive_integer(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_i64)
        .is_some_and(|value| value >= 1)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "student" => {
            if document.get("dob").is_some_and(|value| {
                !value.is_null() && {
                    value
                        .as_str()
                        .filter(|date| date.len() == 10)
                        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                        .is_none_or(|date| date > chrono::Utc::now().date_naive())
                }
            }) {
                errors.push("Ngày sinh học viên phải hợp lệ và không ở tương lai".into());
            }
        }
        "course_class" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Lớp học cần có tên".into());
            }
            if document
                .get("capacity")
                .is_some_and(|value| !value.is_null())
                && !positive_integer(document.get("capacity"))
            {
                errors.push("Sức chứa lớp phải là số nguyên dương".into());
            }
            if document.get("tuition").is_some_and(|value| {
                !value.is_null() && {
                    !money::decimal(value).is_some_and(|tuition| tuition > Decimal::ZERO)
                }
            }) {
                errors.push("Học phí lớp phải lớn hơn 0".into());
            }
            if document.get("start_date").is_some_and(|value| {
                !value.is_null() && {
                    value
                        .as_str()
                        .filter(|date| date.len() == 10)
                        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                        .is_none()
                }
            }) {
                errors.push("Ngày bắt đầu lớp không hợp lệ".into());
            }
        }
        "grade" => {
            if document.get("score").is_some_and(|value| !value.is_null())
                && !document
                    .get("score")
                    .and_then(money::decimal)
                    .is_some_and(|score| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&score))
            {
                errors.push("Điểm phải nằm trong khoảng từ 0 đến 100".into());
            }
            for field in ["term", "subject"] {
                if document
                    .get(field)
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                {
                    errors.push(format!("Điểm cần có {field}"));
                }
            }
        }
        "fee" => {
            if !document
                .get("amount")
                .and_then(money::decimal)
                .is_some_and(|amount| amount > Decimal::ZERO)
            {
                errors.push("Học phí phải lớn hơn 0".into());
            }
            if document
                .get("enrollment")
                .is_some_and(|value| !value.is_null())
                && document
                    .get("period")
                    .and_then(Value::as_str)
                    .is_none_or(|period| period.trim().is_empty())
            {
                errors.push("Học phí gắn với lớp cần kỳ thu học phí".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "fee" && action == "issued" {
        return if document
            .get("amount")
            .and_then(money::decimal)
            .is_some_and(|amount| amount > Decimal::ZERO)
        {
            Vec::new()
        } else {
            vec!["Chỉ phát hành học phí có số tiền lớn hơn 0".into()]
        };
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    match entity {
        "class_enrollment" => {
            vec!["Ghi danh chỉ được thay đổi qua action hoàn tất hoặc thôi học".into()]
        }
        "fee" if current.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Học phí đã phát hành hoặc thanh toán không thể sửa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("class_enrollment", _) => vec!["Ghi danh phải được giữ làm lịch sử đào tạo".into()],
        ("fee", Some("issued" | "paid")) => {
            vec!["Học phí đã phát hành không thể xóa khỏi lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
