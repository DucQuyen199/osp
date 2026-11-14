//! Ecommerce catalog and order invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "storefront" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                vec!["Gian hàng cần có tên".into()]
            } else {
                Vec::new()
            }
        }
        "web_order" => {
            let Some(lines) = document.get("lines") else {
                return Vec::new();
            };
            let Some(lines) = lines.as_array() else {
                return vec!["Dòng đơn online phải là danh sách".into()];
            };
            let mut errors = Vec::new();
            for (index, line) in lines.iter().enumerate() {
                let prefix = format!("Dòng đơn online {}", index + 1);
                if line
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .is_none()
                {
                    errors.push(format!("{prefix}: sản phẩm phải là mã hợp lệ"));
                }
                if !line
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::ZERO)
                {
                    errors.push(format!("{prefix}: số lượng phải lớn hơn 0"));
                }
            }
            errors
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "web_order"
        && action == "placed"
        && document
            .get("lines")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        vec!["Đơn online cần ít nhất một sản phẩm trước khi đặt hàng".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "web_order"
        && current.get("status").and_then(Value::as_str) != Some("cart")
        && patch.as_object().is_some_and(|fields| !fields.is_empty())
    {
        vec!["Đơn online đã đặt hoặc hủy không thể chỉnh sửa".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "web_order" && document.get("status").and_then(Value::as_str) != Some("cart") {
        vec!["Đơn online đã đặt hoặc hủy phải được lưu làm lịch sử nghiệp vụ".into()]
    } else {
        Vec::new()
    }
}
