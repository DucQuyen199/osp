//! Pure contract dates, terms, and lifecycle policy.
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
    if entity == "amendment" {
        return validate_amendment(&Value::Null, document);
    }
    if entity != "contract" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if let Some(value) = document.get("value") {
        if !money::decimal(value).is_some_and(|amount| amount >= Decimal::ZERO) {
            errors.push("Giá trị hợp đồng phải là số không âm".into());
        }
    }
    if let (Some(start), Some(end)) = (date(document, "start_date"), date(document, "end_date")) {
        if end < start {
            errors.push("Ngày kết thúc hợp đồng phải từ ngày bắt đầu trở đi".into());
        }
    }
    errors
}

/// Validate an amendment's declared field set and its merged contract terms.
pub fn validate_amendment(current: &Value, amendment: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if amendment
        .get("reason")
        .and_then(Value::as_str)
        .is_none_or(|reason| reason.trim().is_empty())
    {
        errors.push("Phụ lục phải nêu lý do thay đổi".into());
    }
    let Some(effective_date) = amendment
        .get("effective_date")
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        errors.push("Ngày hiệu lực phụ lục không hợp lệ".into());
        return errors;
    };
    let Some(changes) = amendment.get("changes").and_then(Value::as_object) else {
        errors.push("Nội dung thay đổi phải là một object JSON".into());
        return errors;
    };
    if changes.is_empty() {
        errors.push("Phụ lục phải thay đổi ít nhất một điều khoản".into());
        return errors;
    }
    for key in changes.keys() {
        if !matches!(key.as_str(), "title" | "terms" | "end_date" | "value") {
            errors.push(format!("Không được sửa điều khoản `{key}` qua phụ lục này"));
        }
    }

    let start_date = date(current, "start_date");
    if start_date.is_some_and(|start| effective_date < start) {
        errors.push("Ngày hiệu lực phụ lục không được trước ngày bắt đầu hợp đồng".into());
    }
    if let Some(title) = changes.get("title")
        && title
            .as_str()
            .is_none_or(|title| title.trim().is_empty() || title.len() > 500)
    {
        errors.push("Tên hợp đồng mới phải có nội dung và tối đa 500 ký tự".into());
    }
    if let Some(terms) = changes.get("terms")
        && !terms.is_null()
        && terms
            .as_str()
            .is_none_or(|terms| terms.trim().is_empty() || terms.len() > 30_000)
    {
        errors.push("Điều khoản hợp đồng mới phải có nội dung và tối đa 30.000 ký tự".into());
    }
    if let Some(value) = changes.get("value")
        && !value.is_null()
        && !money::decimal(value).is_some_and(|amount| amount >= Decimal::ZERO)
    {
        errors.push("Giá trị hợp đồng sau điều chỉnh phải không âm".into());
    }

    let end_date = match changes.get("end_date") {
        Some(Value::Null) => None,
        Some(value) => value
            .as_str()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        None => date(current, "end_date"),
    };
    if changes.contains_key("end_date")
        && !changes.get("end_date").is_some_and(Value::is_null)
        && end_date.is_none()
    {
        errors.push("Ngày kết thúc mới không hợp lệ".into());
    }
    if end_date.is_some_and(|end| end < effective_date) {
        errors.push("Ngày kết thúc mới phải bằng hoặc sau ngày hiệu lực phụ lục".into());
    }
    if start_date
        .zip(end_date)
        .is_some_and(|(start, end)| end < start)
    {
        errors.push("Ngày kết thúc hợp đồng phải từ ngày bắt đầu trở đi".into());
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "amendment"
        && !matches!(
            current.get("status").and_then(Value::as_str),
            Some("draft" | "rejected")
        )
        && [
            "contract",
            "reference",
            "effective_date",
            "reason",
            "changes",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        return vec![
            "Phụ lục đã gửi duyệt không được sửa; hãy tạo phụ lục mới nếu cần thay đổi".into(),
        ];
    }
    if entity == "contract"
        && current.get("status").and_then(Value::as_str) != Some("draft")
        && ["title", "terms", "party", "start_date", "end_date", "value"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        vec!["Điều khoản chính của hợp đồng đã kích hoạt không được sửa; hãy lập phụ lục hoặc hợp đồng điều chỉnh".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "contract" && document.get("status").and_then(Value::as_str) != Some("draft") {
        vec!["Hợp đồng đã kích hoạt phải được giữ làm dấu vết pháp lý".into()]
    } else {
        Vec::new()
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
    if entity == "amendment" {
        return match action {
            "submitted" | "approved" => {
                let mut errors = validate_amendment(&Value::Null, document);
                if action == "approved" {
                    let effective_date = date(document, "effective_date");
                    if effective_date.is_some_and(|date| date < today) {
                        errors.push("Không thể phê duyệt phụ lục có ngày hiệu lực đã qua".into());
                    }
                }
                errors
            }
            "applied" => {
                if date(document, "effective_date")
                    .is_some_and(|effective_date| effective_date <= today)
                {
                    Vec::new()
                } else {
                    vec!["Chỉ áp dụng phụ lục vào hoặc sau ngày hiệu lực".into()]
                }
            }
            _ => Vec::new(),
        };
    }
    if entity != "contract" {
        return Vec::new();
    }
    match action {
        "activated" => {
            let mut errors = validate(entity, document);
            if date(document, "start_date").is_none() {
                errors.push("Cần ngày bắt đầu hiệu lực trước khi kích hoạt hợp đồng".into());
            }
            errors
        }
        "expired" => {
            if date(document, "end_date").is_some_and(|end| end < today) {
                Vec::new()
            } else {
                vec!["Chỉ được chuyển hợp đồng sang hết hạn sau ngày kết thúc".into()]
            }
        }
        "amended" => {
            if document
                .get("last_amendment")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.trim().is_empty())
            {
                Vec::new()
            } else {
                vec!["Cần áp dụng một phụ lục đã được phê duyệt".into()]
            }
        }
        _ => Vec::new(),
    }
}
