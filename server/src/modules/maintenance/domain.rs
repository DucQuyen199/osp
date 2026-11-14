//! Pure maintenance rules and lifecycle policies.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;
fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "maintenance_request" => {
            if let Some(parts) = document.get("parts") {
                if let Some(parts) = parts.as_array() {
                    for (index, part) in parts.iter().enumerate() {
                        let prefix = format!("parts[{}]", index + 1);
                        if part
                            .get("product")
                            .and_then(Value::as_str)
                            .is_none_or(str::is_empty)
                        {
                            errors.push(format!("{prefix}.product là bắt buộc"));
                        }
                        if !part
                            .get("qty")
                            .and_then(money::decimal)
                            .is_some_and(|qty| qty > Decimal::ZERO)
                        {
                            errors.push(format!("{prefix}.qty phải lớn hơn 0"));
                        }
                    }
                } else {
                    errors.push("parts phải là danh sách vật tư".into());
                }
            }
            for field in ["labor_hours", "labor_rate"] {
                if document.get(field).is_some_and(|value| {
                    !money::decimal(value).is_some_and(|number| number >= Decimal::ZERO)
                }) {
                    errors.push(format!("{field} phải là số không âm"));
                }
            }
        }
        "maintenance_plan" => {
            if !document
                .get("interval_days")
                .and_then(money::decimal)
                .is_some_and(|days| days >= Decimal::ONE && days.fract().is_zero())
            {
                errors.push("Chu kỳ bảo trì phải là số ngày nguyên dương".into());
            }
            if document.get("next_due").is_some_and(|value| {
                value
                    .as_str()
                    .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                    .is_none()
            }) {
                errors.push("Ngày bảo trì kế tiếp không hợp lệ".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, _patch: &Value) -> Vec<String> {
    if entity == "maintenance_request"
        && current.get("status").and_then(Value::as_str) == Some("done")
    {
        return vec![
            "Lệnh bảo trì đã hoàn tất không được sửa; hãy tạo lệnh mới để lưu dấu vết".into(),
        ];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "maintenance_request"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("done" | "cancelled")
        )
    {
        return vec![
            "Lệnh bảo trì đã hoàn tất hoặc hủy phải được giữ làm lịch sử nghiệp vụ".into(),
        ];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "maintenance_request" && action == "done" {
        let mut errors = Vec::new();
        if document
            .get("resolution")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            errors.push("Cần ghi nhận kết quả xử lý trước khi hoàn tất lệnh bảo trì".into());
        }
        if document
            .get("parts")
            .and_then(Value::as_array)
            .is_some_and(|parts| !parts.is_empty())
            && id(document, "warehouse").is_none()
        {
            errors.push("Cần chọn kho xuất khi lệnh bảo trì sử dụng vật tư".into());
        }
        return errors;
    }
    Vec::new()
}
