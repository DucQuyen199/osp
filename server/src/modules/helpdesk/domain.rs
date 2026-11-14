//! Helpdesk ticket and service-level policy invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "ticket" => {
            if document
                .get("subject")
                .and_then(Value::as_str)
                .is_none_or(|subject| subject.trim().is_empty())
            {
                vec!["Ticket cần có tiêu đề".into()]
            } else {
                Vec::new()
            }
        }
        "sla_policy" => validate_sla_policy(document),
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "ticket"
        && action == "responded"
        && document
            .get("assignee")
            .and_then(Value::as_str)
            .is_none_or(|assignee| assignee.trim().is_empty())
    {
        return vec!["Cần phân công người phụ trách trước khi ghi nhận phản hồi đầu tiên".into()];
    }
    if entity == "ticket"
        && action == "resolved"
        && document
            .get("resolution")
            .and_then(Value::as_str)
            .is_none_or(|resolution| resolution.trim().is_empty())
    {
        vec!["Cần ghi nội dung xử lý trước khi chuyển ticket sang đã giải quyết".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "ticket"
        && current.get("status").and_then(Value::as_str) == Some("closed")
        && patch.as_object().is_some_and(|fields| !fields.is_empty())
    {
        vec!["Ticket đã đóng là hồ sơ lịch sử; hãy mở lại qua action trước khi chỉnh sửa".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str) -> Vec<String> {
    if entity == "ticket" {
        vec!["Ticket hỗ trợ được lưu làm lịch sử; hãy dùng trạng thái đóng thay vì xóa".into()]
    } else {
        Vec::new()
    }
}

fn validate_sla_policy(document: &Value) -> Vec<String> {
    let response = document
        .get("response_hours")
        .and_then(money::decimal)
        .filter(|hours| *hours > Decimal::ZERO);
    let resolution = document
        .get("resolve_hours")
        .and_then(money::decimal)
        .filter(|hours| *hours > Decimal::ZERO);
    let mut errors = Vec::new();
    if document
        .get("name")
        .and_then(Value::as_str)
        .is_none_or(|name| name.trim().is_empty())
    {
        errors.push("Chính sách SLA cần có tên".into());
    }
    if response.is_none() {
        errors.push("Thời hạn phản hồi SLA phải lớn hơn 0 giờ".into());
    }
    if resolution.is_none() {
        errors.push("Thời hạn giải quyết SLA phải lớn hơn 0 giờ".into());
    }
    if response
        .zip(resolution)
        .is_some_and(|(response, resolution)| resolution < response)
    {
        errors.push("Thời hạn giải quyết SLA không thể ngắn hơn thời hạn phản hồi".into());
    }
    errors
}
