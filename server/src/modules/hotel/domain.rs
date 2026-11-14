use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn date(document: &Value, field: &str) -> Option<chrono::NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn is_folio_charge(event_type: &str) -> bool {
    event_type == "hotel.folio_charge.created"
}

pub fn room_transition(event_type: &str) -> Option<&'static str> {
    match event_type {
        "hotel.reservation.checked_in" => Some("occupied"),
        "hotel.reservation.checked_out" => Some("cleaning"),
        _ => None,
    }
}

pub fn room_id(document: &Value) -> Option<Uuid> {
    document
        .get("room")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "room_type" => {
            if !document
                .get("rate")
                .and_then(money::decimal)
                .is_some_and(|rate| rate >= Decimal::ZERO)
            {
                errors.push("Room type rate must be a nonnegative amount".into());
            }
            if document
                .get("capacity")
                .is_some_and(|value| !value.as_i64().is_some_and(|capacity| capacity >= 1))
            {
                errors.push("Room type capacity must be at least one guest".into());
            }
        }
        "room" => {
            if document
                .get("number")
                .and_then(Value::as_str)
                .is_none_or(|number| number.trim().is_empty())
            {
                errors.push("Room number is required".into());
            }
        }
        "reservation" => {
            let check_in = date(document, "check_in");
            let check_out = date(document, "check_out");
            if check_in.is_none() || check_out.is_none() {
                errors.push("Reservation dates must use YYYY-MM-DD format".into());
            } else if check_in >= check_out {
                errors.push("Check-out date must be later than check-in date".into());
            }
            if !document
                .get("guest_count")
                .and_then(Value::as_i64)
                .is_some_and(|guests| guests > 0)
            {
                errors.push("Số lượng khách phải là số nguyên dương".into());
            }
        }
        "folio_charge" => {
            if !document
                .get("amount")
                .and_then(money::decimal)
                .is_some_and(|amount| amount >= Decimal::ZERO)
            {
                errors.push("Folio charge must be a nonnegative amount".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "reservation"
        && current.get("status").and_then(Value::as_str) == Some("checked_in")
    {
        let Some(fields) = patch.as_object() else {
            return vec![
                "An in-house stay can only be changed through the stay-extension workflow".into(),
            ];
        };
        if fields.len() != 1 || !fields.contains_key("check_out") {
            return vec!["During a stay, only the checkout date can be extended; guest, room, and rate snapshots are locked".into()];
        }
        let old_checkout = date(current, "check_out");
        let new_checkout = date(patch, "check_out");
        if old_checkout
            .zip(new_checkout)
            .is_some_and(|(old, new)| new > old)
        {
            return Vec::new();
        }
        return vec!["Checkout date must move later to extend an in-house stay".into()];
    }
    if entity == "reservation"
        && current.get("status").and_then(Value::as_str) == Some("no_show")
        && patch.as_object().is_some_and(|fields| !fields.is_empty())
    {
        return vec!["Đặt phòng đã ghi nhận khách vắng mặt không được sửa".into()];
    }
    if entity == "reservation"
        && current.get("status").and_then(Value::as_str) != Some("booked")
        && patch.get("no_show_reason").is_some()
    {
        return vec![
            "Chỉ được cập nhật lý do vắng mặt khi đặt phòng còn ở trạng thái đã đặt".into(),
        ];
    }
    if entity == "reservation"
        && current.get("status").and_then(Value::as_str) != Some("booked")
        && ["party", "room", "check_in", "check_out"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Guest, room, and stay dates are immutable after check-in".into()];
    }
    if entity == "reservation" && patch.get("room_type").is_some() {
        return vec!["A reservation room type is fixed when it is created".into()];
    }
    if entity == "room" && current.get("status").and_then(Value::as_str) == Some("occupied") {
        if ["number", "room_type", "floor"]
            .iter()
            .any(|field| patch.get(*field).is_some())
        {
            return vec!["Occupied room details cannot be changed".into()];
        }
    }
    if entity == "room" && patch.get("room_type").is_some() {
        return vec!["A room cannot change room type after it is created".into()];
    }
    if entity == "folio_charge" && patch.as_object().is_some_and(|fields| !fields.is_empty()) {
        return vec!["Folio charges are immutable financial audit history".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "reservation" && document.get("status").and_then(Value::as_str) != Some("booked") {
        return vec!["Only a booked reservation without operational history can be removed".into()];
    }
    if entity == "folio_charge" {
        return vec!["Folio charges are retained as financial audit history".into()];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "reservation" && action == "no_show" {
        let reason = document
            .get("no_show_reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if reason.is_empty() {
            return vec!["Cần ghi lý do trước khi xác nhận khách vắng mặt".into()];
        }
        if reason.chars().count() > 500 {
            return vec!["Lý do khách vắng mặt không được vượt quá 500 ký tự".into()];
        }
    }
    if entity == "reservation" && action == "checked_in" {
        if room_id(document).is_none() {
            return vec!["Assign a room before checking in".into()];
        }
    }
    Vec::new()
}
