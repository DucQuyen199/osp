use crate::money;
use serde_json::{Map, Value, json};

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity != "reminder" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !matches!(
        document.get("channel").and_then(Value::as_str),
        Some("email" | "sms")
    ) {
        errors.push("Reminder channel must be email or sms".into());
    }
    if document
        .get("body")
        .and_then(Value::as_str)
        .is_none_or(|body| body.trim().is_empty())
    {
        errors.push("Reminder body cannot be empty".into());
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "reminder"
        && current.get("status").and_then(Value::as_str) != Some("pending")
        && ["party", "channel", "subject", "body", "send_at"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Queued or cancelled reminders are immutable".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "reminder" && document.get("status").and_then(Value::as_str) != Some("pending") {
        return vec!["Queued or cancelled reminders must be retained as history".into()];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "reminder" && action == "queued" {
        let send_at = document
            .get("send_at")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
        if send_at.is_none_or(|send_at| send_at > chrono::Utc::now()) {
            return vec!["A reminder can only be queued after its scheduled time".into()];
        }
    }
    Vec::new()
}

pub fn message_for(event_type: &str, event: &Value) -> Option<Map<String, Value>> {
    if event_type == "communication.reminder.queued" {
        let channel = event.get("channel")?.as_str()?;
        if !matches!(channel, "email" | "sms") {
            return None;
        }
        let party = event.get("party").filter(|value| !value.is_null())?;
        let mut message = Map::new();
        message.insert("channel".into(), json!(channel));
        message.insert("recipient".into(), party.clone());
        message.insert(
            "subject".into(),
            event
                .get("subject")
                .cloned()
                .unwrap_or_else(|| json!("Nhắc việc")),
        );
        message.insert("body".into(), event.get("body")?.clone());
        return Some(message);
    }
    let (channel, subject, body, party_required) = match event_type {
        "helpdesk.ticket.created" => {
            let ticket_subject = event
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or("Yêu cầu hỗ trợ");
            (
                "email",
                "Đã tiếp nhận yêu cầu hỗ trợ".to_owned(),
                format!("Yêu cầu \"{ticket_subject}\" đã được tiếp nhận."),
                true,
            )
        }
        "sales.sales_order.confirmed" => {
            let reference = event
                .get("number")
                .or_else(|| event.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("đơn hàng");
            let total = event
                .get("total")
                .and_then(money::decimal)
                .map(|amount| format!(" Tổng giá trị: {amount:.0}."))
                .unwrap_or_default();
            (
                "email",
                "Đơn hàng đã được xác nhận".to_owned(),
                format!("Đơn hàng {reference} đã được xác nhận.{total}"),
                true,
            )
        }
        "booking.booking.confirmed" => {
            let starts_at = event
                .get("starts_at")
                .and_then(Value::as_str)
                .unwrap_or("theo lịch đã đăng ký");
            (
                "sms",
                "Lịch hẹn đã xác nhận".to_owned(),
                format!("Lịch hẹn {starts_at} đã được xác nhận."),
                true,
            )
        }
        _ => return None,
    };
    let party = event.get("party").filter(|value| !value.is_null());
    if party_required && party.is_none() {
        return None;
    }
    let mut message = Map::new();
    message.insert("channel".into(), json!(channel));
    message.insert("subject".into(), json!(subject));
    if let Some(party) = party {
        message.insert("recipient".into(), party.clone());
    }
    message.insert("body".into(), json!(body));
    Some(message)
}
