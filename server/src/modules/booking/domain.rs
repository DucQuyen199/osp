//! Pure booking validation and lifecycle rules.
use crate::money;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "service" => {
            let mut errors = Vec::new();
            if let Some(value) = document.get("duration_min") {
                if !money::decimal(value).is_some_and(|minutes| minutes > Decimal::ZERO) {
                    errors.push("duration_min phải lớn hơn 0".into());
                }
            }
            if let Some(value) = document.get("price") {
                if !money::decimal(value).is_some_and(|price| price >= Decimal::ZERO) {
                    errors.push("price không được âm".into());
                }
            }
            errors
        }
        "booking" => {
            let mut errors = Vec::new();
            let start = document
                .get("starts_at")
                .and_then(Value::as_str)
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok());
            let end_value = document.get("ends_at").and_then(Value::as_str);
            let end = end_value.and_then(|value| DateTime::parse_from_rfc3339(value).ok());
            if start.is_none() {
                errors.push("starts_at phải là thời gian ISO hợp lệ".into());
            }
            if end_value.is_some() && end.is_none() {
                errors.push("ends_at phải là thời gian ISO hợp lệ".into());
            }
            if let (Some(start), Some(end)) = (start, end) {
                if end <= start {
                    errors.push("ends_at phải sau starts_at".into());
                }
            }
            if document.get("price").is_some_and(|value| !value.is_null())
                && !document
                    .get("price")
                    .and_then(money::decimal)
                    .is_some_and(|price| price >= Decimal::ZERO)
            {
                errors.push("price không được âm".into());
            }
            errors
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "booking"
        && current.get("status").and_then(Value::as_str) != Some("requested")
        && [
            "party",
            "resource",
            "service",
            "starts_at",
            "ends_at",
            "price",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        return vec!["Lịch đã xác nhận không thể đổi tài nguyên, thời gian hoặc dịch vụ; hãy hủy và tạo lịch mới".into()];
    }
    Vec::new()
}

fn instant(document: &Value, field: &str) -> Option<DateTime<Utc>> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "booking" {
        return Vec::new();
    }
    let now = Utc::now();
    let Some(starts_at) = instant(document, "starts_at") else {
        return vec!["Lịch hẹn cần giờ bắt đầu hợp lệ trước khi đổi trạng thái".into()];
    };
    let Some(ends_at) = instant(document, "ends_at") else {
        return vec!["Lịch hẹn cần giờ kết thúc hợp lệ trước khi đổi trạng thái".into()];
    };
    match action {
        "confirmed" if starts_at <= now => {
            vec!["Không thể xác nhận lịch hẹn đã bắt đầu hoặc đã qua".into()]
        }
        "checked_in" if now < starts_at || now >= ends_at => {
            vec!["Chỉ check-in trong khoảng thời gian lịch hẹn diễn ra".into()]
        }
        "cancelled" if starts_at <= now => {
            vec!["Không thể hủy lịch sau giờ bắt đầu; hãy ghi nhận vắng mặt".into()]
        }
        "no_show" if ends_at > now => {
            vec!["Chỉ ghi nhận vắng mặt sau khi khung giờ lịch hẹn kết thúc".into()]
        }
        _ => Vec::new(),
    }
}
