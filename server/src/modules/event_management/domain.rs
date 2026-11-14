//! Pure ticket pricing, event capacity, and attendance policies.
use crate::money;
use chrono::{DateTime, Utc};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;

fn start(document: &Value) -> Option<DateTime<Utc>> {
    document
        .get("starts_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn positive(value: Option<&Value>) -> bool {
    value
        .and_then(money::decimal)
        .is_some_and(|value| value > Decimal::ZERO)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "event" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Sự kiện cần có tên".into());
            }
            if !document
                .get("capacity")
                .and_then(money::decimal)
                .is_some_and(|capacity| {
                    capacity >= Decimal::ONE && capacity.fract() == Decimal::ZERO
                })
            {
                errors.push("Sức chứa phải là số nguyên lớn hơn 0".into());
            }
            if !positive(document.get("ticket_price")) {
                errors.push("Giá vé phải lớn hơn 0".into());
            }
            if document.get("reservation_minutes").is_some_and(|value| {
                !money::decimal(value).is_some_and(|minutes| {
                    (Decimal::from(5)..=Decimal::from(60)).contains(&minutes)
                        && minutes.fract() == Decimal::ZERO
                })
            }) {
                errors.push("Thời gian giữ vé phải là số phút nguyên từ 5 đến 60".into());
            }
            if document.get("ticket_tax_rate").is_some_and(|value| {
                !money::decimal(value)
                    .is_some_and(|rate| (Decimal::ZERO..=Decimal::from(100)).contains(&rate))
            }) {
                errors.push("Thuế suất vé phải nằm trong khoảng 0 đến 100 phần trăm".into());
            }
        }
        "ticket" => {
            if !positive(document.get("price")) {
                errors.push("Giá vé bán phải lớn hơn 0".into());
            }
            let price = document
                .get("price")
                .and_then(money::decimal)
                .unwrap_or_default();
            let rate = document
                .get("tax_rate")
                .and_then(money::decimal)
                .unwrap_or_default();
            let tax = document
                .get("tax_amount")
                .and_then(money::decimal)
                .unwrap_or_default();
            let net = document
                .get("net_amount")
                .and_then(money::decimal)
                .unwrap_or_default();
            let expected_net = rate
                .checked_div(Decimal::from(100))
                .and_then(|fraction| Decimal::ONE.checked_add(fraction))
                .and_then(|divisor| price.checked_div(divisor))
                .map(|value| {
                    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                });
            if !(Decimal::ZERO..=Decimal::from(100)).contains(&rate)
                || tax < Decimal::ZERO
                || net <= Decimal::ZERO
                || !price
                    .checked_sub(tax)
                    .is_some_and(|total| money::within_tolerance(total, net, Decimal::new(5, 3)))
                || !expected_net.is_some_and(|expected| {
                    money::within_tolerance(net, expected, Decimal::new(5, 3))
                })
            {
                errors.push("Vé cần snapshot giá trị thuế nhất quán".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("event", "published") => {
            let Some(starts_at) = start(document) else {
                return vec!["Cần thời điểm bắt đầu hợp lệ trước khi công bố sự kiện".into()];
            };
            if starts_at <= Utc::now() {
                return vec!["Chỉ công bố sự kiện có thời điểm bắt đầu trong tương lai".into()];
            }
            if !positive(document.get("ticket_price"))
                || !document
                    .get("capacity")
                    .and_then(money::decimal)
                    .is_some_and(|capacity| {
                        capacity >= Decimal::ONE && capacity.fract() == Decimal::ZERO
                    })
            {
                return vec!["Sự kiện cần sức chứa và giá vé hợp lệ trước khi công bố".into()];
            }
        }
        ("ticket", "sold") => {
            if document
                .get("party")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                return vec!["Cần gắn người mua trước khi bán vé".into()];
            }
            if !positive(document.get("price")) {
                return vec!["Không thể bán vé không có giá hợp lệ".into()];
            }
            if !document
                .get("method")
                .and_then(Value::as_str)
                .is_some_and(|method| {
                    matches!(method, "cash" | "card" | "transfer" | "ewallet" | "bank")
                })
            {
                return vec!["Chọn phương thức thanh toán hợp lệ trước khi bán vé".into()];
            }
        }
        ("ticket", "checked_in") => {
            if document.get("party").and_then(Value::as_str).is_none() {
                return vec!["Vé phải gắn với người tham dự trước khi check-in".into()];
            }
        }
        ("ticket", "refunded") => {
            if document.get("status").and_then(Value::as_str) != Some("sold") {
                return vec!["Chỉ được hoàn vé đã bán và chưa check-in".into()];
            }
            if document
                .get("refund_reason")
                .and_then(Value::as_str)
                .is_none_or(|reason| reason.trim().is_empty())
            {
                return vec!["Cần ghi lý do hoàn vé".into()];
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
    match (entity, current.get("status").and_then(Value::as_str)) {
        ("event", Some("draft")) => Vec::new(),
        ("event", _) => {
            vec!["Sự kiện đã công bố không thể sửa; hãy đóng bán vé bằng action".into()]
        }
        ("ticket", Some("reserved")) => Vec::new(),
        ("ticket", Some("sold"))
            if patch.as_object().is_some_and(|patch| {
                patch.iter().all(|(field, value)| {
                    field == "refund_reason" || current.get(field) == Some(value)
                })
            }) =>
        {
            Vec::new()
        }
        ("ticket", _) => vec!["Vé đã bán, check-in hoặc hủy không thể sửa".into()],
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("ticket", _) => vec!["Vé là dấu vết bán hàng; dùng action hủy vé đang giữ chỗ".into()],
        ("event", Some("published" | "closed")) => {
            vec!["Sự kiện đã công bố phải được giữ trong lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
