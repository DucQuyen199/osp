//! Pure contract dates, terms, and lifecycle policy.
use crate::money;
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::Value;

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity != "contract" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if let Some(value) = document.get("value") {
        if !money::decimal(value).is_some_and(|amount| amount >= Decimal::ZERO) {
            errors.push("Giá trị hợp đồng phải là số không âm".into());
        }
    }
    if let (Some(start), Some(end)) = (date(document, "start_date"), date(document, "end_date")) {
        if end < start {
            errors.push("Ngày kết thúc hợp đồng phải từ ngày bắt đầu trở đi".into());
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "contract"
        && current.get("status").and_then(Value::as_str) != Some("draft")
        && ["title", "party", "start_date", "end_date", "value"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec!["Điều khoản chính của hợp đồng đã kích hoạt không được sửa; hãy lập phụ lục hoặc hợp đồng điều chỉnh".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "contract" && document.get("status").and_then(Value::as_str) != Some("draft") {
        vec!["Hợp đồng đã kích hoạt phải được giữ làm dấu vết pháp lý".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "contract" {
        return Vec::new();
    }
    match action {
        "activated" => {
            let mut errors = validate(entity, document);
            if date(document, "start_date").is_none() {
                errors.push("Cần ngày bắt đầu hiệu lực trước khi kích hoạt hợp đồng".into());
            }
            errors
        }
        "expired" => {
            if date(document, "end_date").is_some_and(|end| end < Utc::now().date_naive()) {
                Vec::new()
            } else {
                vec!["Chỉ được chuyển hợp đồng sang hết hạn sau ngày kết thúc".into()]
            }
        }
        _ => Vec::new(),
    }
}
