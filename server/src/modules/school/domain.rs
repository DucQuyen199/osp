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

fn datetime(document: &Value, field: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
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
        "class_session" => {
            if document
                .get("topic")
                .and_then(Value::as_str)
                .is_none_or(|topic| topic.trim().is_empty())
            {
                errors.push("Buổi học cần có nội dung hoặc chủ đề".into());
            }
            match (
                datetime(document, "starts_at"),
                datetime(document, "ends_at"),
            ) {
                (Some(start), Some(end)) if end > start => {}
                _ => errors.push("Buổi học cần giờ kết thúc sau giờ bắt đầu".into()),
            }
        }
        "attendance" => {
            if !matches!(
                document.get("status").and_then(Value::as_str),
                Some("present" | "absent" | "late" | "excused")
            ) {
                errors.push("Trạng thái điểm danh không hợp lệ".into());
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
    if entity == "class_session" && action == "completed" {
        if datetime(document, "ends_at").is_none_or(|end| end > chrono::Utc::now()) {
            return vec!["Chỉ xác nhận buổi học đã kết thúc theo lịch".into()];
        }
    }
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
        "class_session" => {
            if patch.get("class").is_some() {
                return vec!["Không thể chuyển buổi học sang lớp khác sau khi tạo".into()];
            }
            if current.get("status").and_then(Value::as_str) != Some("scheduled") {
                return vec!["Buổi học đã kết thúc hoặc hủy không thể sửa".into()];
            }
            Vec::new()
        }
        "attendance" => {
            if ["session", "enrollment"]
                .iter()
                .any(|field| patch.get(*field).is_some())
            {
                return vec![
                    "Không thể chuyển bản ghi điểm danh sang buổi hoặc ghi danh khác".into(),
                ];
            }
            Vec::new()
        }
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
        ("class_session", Some("completed" | "cancelled")) => {
            vec!["Buổi học đã xử lý phải được giữ trong lịch sử".into()]
        }
        ("class_enrollment", _) => vec!["Ghi danh phải được giữ làm lịch sử đào tạo".into()],
        ("fee", Some("issued" | "paid")) => {
            vec!["Học phí đã phát hành không thể xóa khỏi lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
