use crate::money;
use chrono::NaiveDate;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity != "prescription" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    for field in ["prescription_no", "prescriber"] {
        if document
            .get(field)
            .and_then(Value::as_str)
            .is_none_or(|v| v.trim().is_empty())
        {
            errors.push(format!("{field} không được để trống"));
        }
    }
    let date = |field: &str| {
        document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|v| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok())
    };
    let issued = date("issued_at");
    let valid = date("valid_until");
    if issued.is_none() || valid.is_none() {
        errors.push("Đơn thuốc cần ngày kê và ngày hết hạn hợp lệ".into());
    }
    if issued.zip(valid).is_some_and(|(a, b)| b < a) {
        errors.push("Ngày hết hạn không được trước ngày kê".into());
    }
    if issued.is_some_and(|date| date > chrono::Utc::now().date_naive()) {
        errors.push("Ngày kê đơn không được ở tương lai".into());
    }
    match document.get("items").and_then(Value::as_array) {
        Some(items) if !items.is_empty() => {
            for (i, item) in items.iter().enumerate() {
                if item
                    .get("product")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                {
                    errors.push(format!("Thuốc {} cần chọn sản phẩm", i + 1));
                }
                if !item
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|q| q > rust_decimal::Decimal::ZERO)
                {
                    errors.push(format!("Thuốc {} cần số lượng lớn hơn 0", i + 1));
                }
                if item
                    .get("dosage")
                    .and_then(Value::as_str)
                    .is_none_or(|v| v.trim().is_empty())
                {
                    errors.push(format!("Thuốc {} cần hướng dẫn sử dụng", i + 1));
                }
            }
        }
        _ => errors.push("Đơn thuốc cần ít nhất một mặt hàng".into()),
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "prescription" && action == "verified" {
        validate(entity, document)
    } else {
        Vec::new()
    }
}
pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity != "prescription" {
        return Vec::new();
    }
    if patch.get("status").is_some() {
        return vec!["Trạng thái đơn thuốc chỉ được đổi qua thao tác quy trình".into()];
    }
    if current
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|s| s != "draft")
        && patch.as_object().is_some_and(|m| {
            m.keys().any(|k| {
                !["status", "verified_by", "verified_at", "dispensed_at"].contains(&k.as_str())
            })
        })
    {
        vec!["Đơn thuốc đã xác minh không được sửa nội dung".into()]
    } else {
        Vec::new()
    }
}
pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity != "prescription" {
        return Vec::new();
    }
    if matches!(
        document.get("status").and_then(Value::as_str),
        Some("dispensed" | "partially_dispensed" | "verified")
    ) {
        vec!["Đơn đã xác minh hoặc cấp phát phải được giữ làm dấu vết".into()]
    } else {
        Vec::new()
    }
}
