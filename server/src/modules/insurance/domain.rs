//! Pure insurance coverage, claim, and lifecycle policies.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn positive(document: &Value, field: &str) -> bool {
    document
        .get(field)
        .and_then(money::decimal)
        .is_some_and(|amount| amount > Decimal::ZERO)
}

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| (value.len() == 10).then_some(value))
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    validate_at(entity, document, chrono::Utc::now().date_naive())
}

pub fn validate_at(entity: &str, document: &Value, today: chrono::NaiveDate) -> Vec<String> {
    match entity {
        "policy" => {
            let mut errors = Vec::new();
            if document
                .get("number")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Hợp đồng cần có số hợp đồng".into());
            }
            if document
                .get("product")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Hợp đồng cần có sản phẩm bảo hiểm".into());
            }
            if !positive(document, "premium") {
                errors.push("Phí bảo hiểm phải lớn hơn 0".into());
            }
            if !positive(document, "coverage_limit") {
                errors.push("Hạn mức bảo hiểm phải lớn hơn 0".into());
            }
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
                && end < start
            {
                errors.push("Ngày kết thúc hợp đồng phải từ ngày bắt đầu trở đi".into());
            }
            errors
        }
        "claim" => {
            let mut errors = Vec::new();
            if document
                .get("number")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Hồ sơ bồi thường cần có mã hồ sơ".into());
            }
            if !positive(document, "amount") {
                errors.push("Số tiền yêu cầu bồi thường phải lớn hơn 0".into());
            }
            if let Some(approved) = document
                .get("approved_amount")
                .filter(|value| !value.is_null())
            {
                let requested = document.get("amount").and_then(money::decimal);
                let approved = money::decimal(approved);
                if !approved.is_some_and(|amount| amount > Decimal::ZERO)
                    || requested
                        .zip(approved)
                        .is_none_or(|(requested, approved)| approved > requested)
                {
                    errors.push("Số tiền bồi thường được duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu".into());
                }
            }
            if date(document, "incident_date").is_none() {
                errors.push("Ngày xảy ra sự cố phải hợp lệ".into());
            } else if date(document, "incident_date").is_some_and(|incident| incident > today) {
                errors.push("Ngày xảy ra sự cố không thể nằm trong tương lai".into());
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
    if entity == "claim"
        && action == "paid"
        && (!matches!(
            document.get("method").and_then(Value::as_str),
            Some("cash" | "bank")
        ) || document
            .get("expense_account")
            .and_then(Value::as_str)
            .is_none())
    {
        return vec![
            "Choose the claim expense account and cash or bank payout method before payment".into(),
        ];
    }
    match (entity, action) {
        ("claim", "rejected") => {
            let reason = document
                .get("rejection_reason")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if !(5..=1000).contains(&reason.chars().count()) {
                return vec!["Cần ghi lý do từ chối bồi thường (5–1000 ký tự)".into()];
            }
        }
        ("policy", "activated") => {
            if date(document, "start_date").is_none() || date(document, "end_date").is_none() {
                return vec![
                    "Cần khai báo ngày bắt đầu và kết thúc trước khi kích hoạt hợp đồng".into(),
                ];
            }
            if date(document, "end_date").is_some_and(|end| end < today) {
                return vec!["Không thể kích hoạt hợp đồng đã quá ngày kết thúc bảo hiểm".into()];
            }
            if !positive(document, "premium") || !positive(document, "coverage_limit") {
                return vec![
                    "Hợp đồng cần có phí và hạn mức bảo hiểm hợp lệ trước khi kích hoạt".into(),
                ];
            }
        }
        ("policy", "lapsed") => {
            if date(document, "end_date").is_none_or(|end| end >= today) {
                return vec!["Chỉ chuyển hợp đồng sang hết hạn sau ngày kết thúc bảo hiểm".into()];
            }
        }
        ("claim", "approved" | "paid") => {
            let requested = document.get("amount").and_then(money::decimal);
            let approved = document
                .get("approved_amount")
                .filter(|value| !value.is_null())
                .and_then(money::decimal)
                .or(requested);
            if !approved.is_some_and(|amount| amount > Decimal::ZERO)
                || requested
                    .zip(approved)
                    .is_none_or(|(requested, approved)| approved > requested)
            {
                return vec![
                    "Số tiền bồi thường được duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu"
                        .into(),
                ];
            }
        }
        _ => {}
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if entity == "claim"
        && let Some(reason) = patch.get("rejection_reason")
    {
        let reason = reason.as_str().map(str::trim).unwrap_or_default();
        if !(5..=1000).contains(&reason.chars().count()) {
            return vec!["Lý do từ chối bồi thường phải có từ 5 đến 1000 ký tự".into()];
        }
    }
    if entity == "claim"
        && current.get("status").and_then(Value::as_str) == Some("approved")
        && patch.as_object().is_some_and(|fields| {
            fields
                .keys()
                .all(|field| matches!(field.as_str(), "expense_account" | "method"))
        })
    {
        return Vec::new();
    }
    match entity {
        "policy" if current.get("status").and_then(Value::as_str) != Some("quoted") => {
            vec![
                "Hợp đồng đã kích hoạt hoặc kết thúc không thể sửa; hãy dùng action trạng thái"
                    .into(),
            ]
        }
        "claim" if current.get("status").and_then(Value::as_str) != Some("submitted") => {
            vec!["Hồ sơ đã duyệt, từ chối hoặc chi trả không thể sửa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("policy", Some("active" | "lapsed" | "cancelled")) => {
            vec!["Hợp đồng đã có hiệu lực không thể xóa khỏi lịch sử".into()]
        }
        ("claim", Some("approved" | "rejected" | "paid")) => {
            vec!["Hồ sơ đã xử lý không thể xóa khỏi lịch sử bồi thường".into()]
        }
        _ => Vec::new(),
    }
}
