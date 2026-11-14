use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if !matches!(entity, "payment_txn" | "payment_refund") {
        return Vec::new();
    }
    match document.get("amount").and_then(money::decimal) {
        Some(amount) if amount > Decimal::ZERO => Vec::new(),
        _ => vec!["Số tiền giao dịch phải lớn hơn 0".into()],
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "payment_refund"
        && current.get("status").and_then(Value::as_str) != Some("pending")
        && ["payment_txn", "amount", "reference"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec![
            "A processed refund cannot change its payment, amount, or provider reference".into(),
        ];
    }
    if entity == "payment_txn"
        && current.get("status").and_then(Value::as_str) != Some("pending")
        && [
            "provider",
            "party",
            "amount",
            "method",
            "invoice",
            "bill",
            "reference",
            "source",
            "source_id",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        return vec!["Giao dịch đã được xử lý không được sửa thông tin đối soát".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "payment_refund"
        && document.get("status").and_then(Value::as_str) != Some("pending")
    {
        return vec!["A processed refund must be retained as financial audit history".into()];
    }
    if entity == "payment_txn" && document.get("status").and_then(Value::as_str) != Some("pending")
    {
        return vec!["Giao dịch đã xử lý phải được giữ làm dấu vết tài chính".into()];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "payment_refund"
        && action == "succeeded"
        && document
            .get("reference")
            .and_then(Value::as_str)
            .is_none_or(|reference| reference.trim().is_empty())
    {
        return vec!["A successful refund requires the provider refund reference".into()];
    }
    if entity != "payment_txn" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if action == "succeeded"
        && document
            .get("reference")
            .and_then(Value::as_str)
            .is_none_or(|reference| reference.trim().is_empty())
    {
        errors.push("Giao dịch thành công cần mã tham chiếu từ nhà cung cấp".into());
    }
    if action == "succeeded" {
        let has_invoice = document
            .get("invoice")
            .is_some_and(|value| !value.is_null());
        let has_bill = document.get("bill").is_some_and(|value| !value.is_null());
        if has_invoice == has_bill {
            errors
                .push("Giao dịch thành công phải gắn đúng một hóa đơn bán hoặc hóa đơn mua".into());
        }
    }
    if action == "refunded"
        && document
            .get("reference")
            .and_then(Value::as_str)
            .is_none_or(|reference| reference.trim().is_empty())
    {
        errors.push("Giao dịch hoàn tiền cần giữ mã tham chiếu gốc".into());
    }
    errors
}
