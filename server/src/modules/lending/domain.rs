//! Lending terms, amortization, and repayment lifecycle invariants.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

#[path = "domain/installments.rs"]
mod installments;
pub use installments::{
    due_dates, due_dates_from_first, installment_amounts, installment_components,
};

fn decimal(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "loan" => {
            let mut errors = Vec::new();
            if !decimal(document, "principal").is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Số tiền vay gốc phải lớn hơn 0".into());
            }
            if !decimal(document, "rate")
                .is_some_and(|value| (Decimal::ZERO..=Decimal::from(1000)).contains(&value))
            {
                errors.push("Lãi suất năm phải nằm trong khoảng từ 0 đến 1.000 phần trăm".into());
            }
            if !decimal(document, "term_months").is_some_and(|value| {
                (Decimal::ONE..=Decimal::from(600)).contains(&value)
                    && value.fract() == Decimal::ZERO
            }) {
                errors.push("Kỳ hạn phải là số tháng nguyên từ 1 đến 600".into());
            }
            if document.get("id").is_none() || document.get("first_due_date").is_some() {
                if document
                    .get("first_due_date")
                    .and_then(Value::as_str)
                    .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                    .is_none()
                {
                    errors.push("Khoản vay cần ngày đến hạn kỳ đầu hợp lệ theo hợp đồng".into());
                }
            }
            if document.get("method").is_some_and(|value| {
                !value.is_null() && !matches!(value.as_str(), Some("cash" | "bank"))
            }) {
                errors.push("Phương thức giải ngân phải là tiền mặt hoặc ngân hàng".into());
            }
            errors
        }
        "repayment" => {
            let mut errors = Vec::new();
            if !decimal(document, "amount").is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Số tiền kỳ trả nợ phải lớn hơn 0".into());
            }
            let principal = decimal(document, "principal_component");
            let interest = decimal(document, "interest_component");
            if !principal.is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Phần gốc kỳ trả phải lớn hơn 0".into());
            }
            if !interest.is_some_and(|value| value >= Decimal::ZERO) {
                errors.push("Phần lãi kỳ trả không được âm".into());
            }
            if let (Some(amount), Some(principal), Some(interest)) =
                (decimal(document, "amount"), principal, interest)
            {
                let total = principal.checked_add(interest);
                if total
                    .is_none_or(|total| !money::within_tolerance(amount, total, Decimal::new(5, 3)))
                {
                    errors.push("Tổng kỳ trả phải bằng phần gốc cộng phần lãi".into());
                }
            }
            if !decimal(document, "installment_no")
                .is_some_and(|value| value >= Decimal::ONE && value.fract() == Decimal::ZERO)
            {
                errors.push("Số thứ tự kỳ trả nợ phải là số nguyên dương".into());
            }
            if document
                .get("due_date")
                .and_then(Value::as_str)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .is_none()
            {
                errors.push("Kỳ trả nợ cần có ngày đến hạn hợp lệ".into());
            }
            errors
        }
        _ => Vec::new(),
    }
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
    if entity == "loan" && action == "disbursed" {
        if matches!(
            document.get("method").and_then(Value::as_str),
            Some("cash" | "bank")
        ) {
            return Vec::new();
        }
        return vec!["Chọn phương thức giải ngân trước khi giải ngân khoản vay".into()];
    }
    if entity == "repayment"
        && action == "paid"
        && !matches!(
            document.get("method").and_then(Value::as_str),
            Some("cash" | "bank")
        )
    {
        return vec!["Chọn phương thức thu tiền trước khi ghi nhận kỳ trả đã thanh toán".into()];
    }
    if entity != "repayment" || action != "overdue" {
        return Vec::new();
    }
    let due = document
        .get("due_date")
        .and_then(Value::as_str)
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
    if due.is_some_and(|date| date < today) {
        Vec::new()
    } else {
        vec!["Chỉ kỳ đã quá ngày đến hạn mới được đánh dấu quá hạn".into()]
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    let has_changes = patch.as_object().is_some_and(|fields| !fields.is_empty());
    if !has_changes {
        return Vec::new();
    }
    if entity == "repayment" {
        let method_only = patch.as_object().is_some_and(|fields| {
            fields.len() == 1
                && fields.contains_key("method")
                && matches!(
                    fields.get("method").and_then(Value::as_str),
                    Some("cash" | "bank")
                )
        });
        if method_only
            && matches!(
                current.get("status").and_then(Value::as_str),
                Some("due" | "overdue")
            )
        {
            return Vec::new();
        }
        return vec![
            "Kỳ trả nợ chỉ cho phép chọn phương thức thu trước khi thanh toán; lịch đã sinh không thể sửa".into(),
        ];
    }
    if entity == "loan" && current.get("status").and_then(Value::as_str) != Some("applied") {
        return vec!["Điều khoản khoản vay chỉ được sửa khi hồ sơ còn ở trạng thái đề nghị".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "repayment" => vec!["Kỳ trả nợ phải được giữ lại làm lịch sử thanh toán".into()],
        "loan" if document.get("status").and_then(Value::as_str) != Some("applied") => {
            vec![
                "Khoản vay đã được duyệt hoặc xử lý phải được giữ lại làm lịch sử tài chính".into(),
            ]
        }
        _ => Vec::new(),
    }
}
