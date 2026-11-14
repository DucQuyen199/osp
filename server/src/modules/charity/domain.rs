//! Pure donation receipt rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "program" {
        if document.get("budget").is_some_and(|budget| {
            !money::decimal(budget).is_some_and(|amount| amount >= Decimal::ZERO)
        }) {
            return vec!["Charity program budget must be finite and non-negative".into()];
        }
        return Vec::new();
    }
    if entity != "disbursement" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !document
        .get("amount")
        .and_then(money::decimal)
        .is_some_and(|amount| amount > Decimal::ZERO)
    {
        errors.push("Disbursement amount must be finite and greater than zero".into());
    }
    if document
        .get("purpose")
        .and_then(Value::as_str)
        .is_none_or(|purpose| purpose.trim().is_empty())
    {
        errors.push("Disbursement purpose is required".into());
    }
    if !matches!(
        document.get("method").and_then(Value::as_str),
        Some("cash" | "card" | "transfer" | "ewallet" | "bank")
    ) {
        errors.push("Disbursement method must be cash, card, transfer, ewallet, or bank".into());
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "disbursement" && matches!(action, "approved" | "paid") {
        return validate(entity, document);
    }
    if entity != "donation" || action != "received" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !document
        .get("amount")
        .and_then(money::decimal)
        .is_some_and(|amount| amount > Decimal::ZERO)
    {
        errors.push("Khoản quyên góp phải lớn hơn 0 trước khi ghi nhận đã nhận".into());
    }
    if !matches!(
        document.get("method").and_then(Value::as_str),
        Some("cash" | "card" | "transfer" | "ewallet" | "bank")
    ) {
        errors.push("Chọn phương thức nhận tiền hợp lệ trước khi ghi nhận quyên góp".into());
    }
    errors
}

/// Donation state and receipt facts may only change through explicit actions.
pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "disbursement" {
        let Some(fields) = patch.as_object() else {
            return Vec::new();
        };
        if fields.contains_key("status") {
            return vec!["Disbursement status can only change through its actions".into()];
        }
        if !fields.is_empty() && current.get("status").and_then(Value::as_str) != Some("requested")
        {
            return vec!["Approved or completed disbursements are immutable".into()];
        }
        return Vec::new();
    }
    if entity != "donation" {
        return Vec::new();
    }

    let Some(fields) = patch.as_object() else {
        return Vec::new();
    };
    if fields.is_empty() {
        return Vec::new();
    }

    if fields.contains_key("status") {
        return vec!["Trạng thái khoản quyên góp chỉ được đổi qua nghiệp vụ nhận tiền".into()];
    }

    if current.get("status").and_then(Value::as_str) == Some("received") {
        return vec![
            "Khoản quyên góp đã nhận không được sửa; hãy lập bút toán điều chỉnh nếu cần".into(),
        ];
    }

    Vec::new()
}

/// Preserve the source record for every donation that has an accounting receipt.
pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "disbursement"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("approved" | "paid")
        )
    {
        return vec!["Approved or paid disbursements must be retained as financial records".into()];
    }
    if entity == "donation" && document.get("status").and_then(Value::as_str) == Some("received") {
        vec!["Khoản quyên góp đã nhận không được xóa vì đã tạo dấu vết kế toán".into()]
    } else {
        Vec::new()
    }
}
