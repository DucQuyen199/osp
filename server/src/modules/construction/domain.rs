//! Pure estimate, contract, and site-diary policies.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn positive(document: &Value, field: &str) -> bool {
    document
        .get(field)
        .and_then(money::decimal)
        .is_some_and(|value| value > Decimal::ZERO)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "boq" => {
            let Some(items) = document.get("items").and_then(Value::as_array) else {
                return vec!["BOQ cần danh sách hạng mục".into()];
            };
            if items.is_empty() {
                errors.push("BOQ cần ít nhất một hạng mục".into());
            }
            for (index, item) in items.iter().enumerate() {
                let label = format!("Hạng mục BOQ [{}]", index + 1);
                if item
                    .get("description")
                    .and_then(Value::as_str)
                    .is_none_or(|text| text.trim().is_empty())
                {
                    errors.push(format!("{label} cần mô tả"));
                }
                if !item
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::ZERO)
                {
                    errors.push(format!("{label} cần số lượng lớn hơn 0"));
                }
                if !item
                    .get("unit_price")
                    .and_then(money::decimal)
                    .is_some_and(|price| price >= Decimal::ZERO)
                {
                    errors.push(format!("{label} cần đơn giá không âm"));
                }
            }
        }
        "site" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Công trường cần có tên".into());
            }
        }
        "subcontract" => {
            if !positive(document, "value") {
                errors.push("Giá trị hợp đồng thầu phụ phải lớn hơn 0".into());
            }
        }
        "site_diary" => {
            let date = document.get("date").and_then(Value::as_str);
            if date
                .filter(|date| date.len() == 10)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .is_none_or(|date| date > chrono::Utc::now().date_naive())
            {
                errors.push("Nhật ký cần ngày hợp lệ, không nằm trong tương lai".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "subcontract" && action == "signed" && !positive(document, "value") {
        return vec!["Chỉ ký hợp đồng thầu phụ có giá trị lớn hơn 0".into()];
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if entity == "site_diary" {
        return vec!["Nhật ký công trường đã ghi nhận không thể sửa".into()];
    }
    if entity == "subcontract" && current.get("status").and_then(Value::as_str) != Some("draft") {
        return vec!["Hợp đồng thầu phụ đã ký không thể sửa điều khoản".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("site_diary", _) => vec!["Nhật ký công trường không thể xóa khỏi lịch sử".into()],
        ("subcontract", Some("signed" | "completed")) => {
            vec!["Hợp đồng thầu phụ đã ký không thể xóa khỏi lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
