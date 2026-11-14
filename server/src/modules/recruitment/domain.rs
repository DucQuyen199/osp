//! Pure candidate, opening, and application validation.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

fn email(document: &Value) -> Option<&str> {
    document
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "job_opening" => {
            if let Some(headcount) = document.get("headcount") {
                if !money::decimal(headcount)
                    .is_some_and(|value| value >= Decimal::ONE && value.fract().is_zero())
                {
                    errors.push("Số lượng tuyển phải là số nguyên dương".into());
                }
            }
        }
        "candidate" => {
            if let Some(value) = email(document) {
                if !value.contains('@')
                    || !value
                        .rsplit('@')
                        .next()
                        .is_some_and(|host| host.contains('.'))
                {
                    errors.push("Email ứng viên không hợp lệ".into());
                }
            }
        }
        "application" => {
            if document
                .get("candidate_name")
                .and_then(Value::as_str)
                .map_or(true, |name| name.trim().is_empty())
            {
                errors.push("Hồ sơ ứng tuyển cần tên ứng viên".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "job_opening" if current.get("status").and_then(Value::as_str) != Some("open") => {
            if ["title", "department", "position", "headcount"]
                .iter()
                .any(|field| patch.get(*field).is_some())
            {
                vec!["Tin tuyển dụng đã đóng không được sửa các điều kiện chính".into()]
            } else {
                Vec::new()
            }
        }
        "application"
            if matches!(
                current.get("status").and_then(Value::as_str),
                Some("applied" | "hired")
            ) && ["job", "candidate", "candidate_name"]
                .iter()
                .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Hồ sơ đã gửi hoặc trúng tuyển không được đổi ứng viên/vị trí".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "application" && document.get("status").and_then(Value::as_str) != Some("draft") {
        vec!["Hồ sơ đã gửi cần được giữ làm lịch sử tuyển dụng".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "application" && action == "hired" {
        if document
            .get("candidate_name")
            .and_then(Value::as_str)
            .map_or(true, |name| name.trim().is_empty())
        {
            return vec!["Không thể tuyển ứng viên nếu thiếu tên hợp lệ".into()];
        }
    }
    Vec::new()
}
