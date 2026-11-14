//! Pure expense claim validation and lifecycle rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(document: &Value) -> Vec<String> {
    let Some(value) = document.get("items") else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return vec!["items phải là danh sách khoản chi".into()];
    };
    let mut errors = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if !item
            .get("amount")
            .and_then(money::decimal)
            .is_some_and(|amount| amount > Decimal::ZERO)
        {
            errors.push(format!("items[{}].amount phải lớn hơn 0", index + 1));
        }
    }
    errors
}

pub fn validate_update(current: &Value, patch: &Value) -> Vec<String> {
    if matches!(
        current.get("status").and_then(Value::as_str),
        Some("submitted" | "approved" | "paid")
    ) && [
        "employee",
        "items",
        "total",
        "payment_date",
        "payment_method",
        "note",
    ]
    .iter()
    .any(|field| patch.get(*field).is_some())
    {
        vec!["Phiếu chi đã gửi duyệt không thể sửa người đề nghị hoặc khoản chi".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(action: &str, document: &Value) -> Vec<String> {
    if !matches!(action, "submitted" | "approved" | "paid") {
        return Vec::new();
    }
    if action == "paid"
        && !matches!(
            document.get("payment_method").and_then(Value::as_str),
            Some("cash" | "bank")
        )
    {
        return vec!["Phương thức chi phí nhân viên phải là tiền mặt hoặc ngân hàng".into()];
    }
    let Some(items) = document.get("items").and_then(Value::as_array) else {
        return vec!["Cần có danh sách khoản chi trước khi gửi hoặc thanh toán".into()];
    };
    if items.is_empty() {
        return vec!["Cần có ít nhất một khoản chi trước khi gửi hoặc thanh toán".into()];
    }
    validate(document)
}

pub fn validate_remove(document: &Value) -> Vec<String> {
    if matches!(
        document.get("status").and_then(Value::as_str),
        Some("submitted" | "approved" | "paid")
    ) {
        vec!["Phiếu chi đã gửi duyệt hoặc đã xử lý phải được giữ làm dấu vết kiểm toán".into()]
    } else {
        Vec::new()
    }
}
