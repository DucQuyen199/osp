use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "plan" => {
            if document.get("price").is_some_and(|value| {
                !money::decimal(value).is_some_and(|price| price >= Decimal::ZERO)
            }) {
                errors.push("Giá gói thuê bao phải là số không âm".into());
            }
        }
        "subscription" => {
            if document.get("start").is_some_and(|value| !value.is_null())
                && date(document, "start").is_none()
            {
                errors.push("Ngày bắt đầu thuê bao phải có dạng YYYY-MM-DD".into());
            }
        }
        "billing_cycle" => {
            if !document
                .get("amount")
                .and_then(money::decimal)
                .is_some_and(|amount| amount > Decimal::ZERO)
            {
                errors.push("Số tiền kỳ thanh toán phải lớn hơn 0".into());
            }
        }
        _ => {}
    }
    if entity == "billing_cycle" && date(document, "due_date").is_none() {
        errors.push("Billing cycle due date must use YYYY-MM-DD format".into());
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "subscription"
        && current.get("status").and_then(Value::as_str) != Some("cancelled")
        && ["party", "plan", "start"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Không đổi khách hàng, gói hoặc ngày bắt đầu của thuê bao hiện hữu; hãy tạo thuê bao mới".into()];
    }
    if entity == "billing_cycle"
        && current.get("status").and_then(Value::as_str) != Some("pending")
        && ["subscription", "party", "amount", "due_date"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Kỳ thanh toán đã trả phải được giữ nguyên làm chứng từ".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "subscription"
        && document.get("status").and_then(Value::as_str) != Some("cancelled")
    {
        return vec!["Chỉ xóa được thuê bao đã hủy".into()];
    }
    if entity == "billing_cycle"
        && document.get("status").and_then(Value::as_str) != Some("pending")
    {
        return vec!["Kỳ thanh toán đã đến hạn hoặc đã trả phải được lưu làm lịch sử".into()];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    validate_action_at(entity, action, document, chrono::Utc::now().date_naive())
}

pub fn validate_action_at(
    entity: &str,
    action: &str,
    document: &Value,
    today: chrono::NaiveDate,
) -> Vec<String> {
    if entity == "billing_cycle" && action == "due" {
        if date(document, "due_date").is_none_or(|due| due > today) {
            return vec!["Chỉ đánh dấu đến hạn khi ngày thu phí đã tới".into()];
        }
    }
    Vec::new()
}
