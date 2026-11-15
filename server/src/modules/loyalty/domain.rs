use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Copy)]
pub enum PointsEvent {
    Earn { source: &'static str },
    Reverse { source: &'static str },
    ReverseSalesReturn,
}

pub fn event_kind(event_type: &str) -> Option<PointsEvent> {
    match event_type {
        "pos.pos_order.completed" => Some(PointsEvent::Earn {
            source: "pos_order",
        }),
        "sales.sales_order.confirmed" => Some(PointsEvent::Earn {
            source: "sales_order",
        }),
        "pos.pos_order.refunded" => Some(PointsEvent::Reverse {
            source: "pos_order_refund",
        }),
        "sales.sales_return.received" => Some(PointsEvent::ReverseSalesReturn),
        _ => None,
    }
}

pub fn party_id(document: &Value) -> Option<Uuid> {
    document
        .get("party")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn points_for(total: Decimal) -> Option<Decimal> {
    total
        .checked_div(Decimal::new(10_000, 0))
        .map(|value| value.floor())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    validate_at(entity, document, chrono::Utc::now().date_naive())
}

pub fn validate_at(entity: &str, document: &Value, today: chrono::NaiveDate) -> Vec<String> {
    match entity {
        "member" => document
            .get("points")
            .is_none_or(|value| {
                value.is_null()
                    || money::decimal(value).is_some_and(|points| points >= Decimal::ZERO)
            })
            .then(Vec::new)
            .unwrap_or_else(|| vec!["Số dư điểm phải là số không âm".into()]),
        "voucher" => {
            if document.get("code").is_none() {
                return Vec::new();
            }
            let mut errors = Vec::new();
            let percent = document.get("percent").and_then(money::decimal);
            let amount = document.get("amount").and_then(money::decimal);
            if percent.is_some() == amount.is_some() {
                errors
                    .push("Voucher phải có đúng một hình thức giảm: phần trăm hoặc số tiền".into());
            }
            if percent.is_some_and(|value| !(Decimal::ZERO < value && value < Decimal::ONE_HUNDRED))
            {
                errors.push("Phần trăm voucher phải lớn hơn 0 và nhỏ hơn 100".into());
            }
            if amount.is_some_and(|value| value <= Decimal::ZERO) {
                errors.push("Số tiền voucher phải lớn hơn 0".into());
            }
            if document
                .get("code")
                .and_then(Value::as_str)
                .is_none_or(|code| {
                    code.trim().is_empty()
                        || code.len() > 80
                        || !code
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                })
            {
                errors.push("Mã voucher phải có từ 1 đến 80 ký tự".into());
            }
            if let Some(value) = document.get("valid_until").and_then(Value::as_str) {
                if NaiveDate::parse_from_str(value, "%Y-%m-%d").map_or(true, |date| date < today) {
                    errors
                        .push("Hạn dùng voucher phải là ngày hôm nay hoặc trong tương lai".into());
                }
            }
            errors
        }
        "point_txn" => {
            let mut errors = Vec::new();
            if !document
                .get("points")
                .and_then(money::decimal)
                .is_some_and(|points| points != Decimal::ZERO)
            {
                errors.push("Giao dịch điểm phải có số điểm khác 0".into());
            }
            if !matches!(
                document.get("source").and_then(Value::as_str),
                Some("pos_order" | "sales_order" | "pos_order_refund" | "sales_return")
            ) {
                errors.push("Nguồn giao dịch điểm không hợp lệ".into());
            }
            if document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_none()
            {
                errors.push("Giao dịch điểm cần mã nguồn hợp lệ".into());
            }
            errors
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "point_txn" {
        return vec!["Giao dịch điểm là lịch sử bất biến".into()];
    }
    if entity == "member" && patch.get("points").is_some() {
        return vec!["Số dư điểm chỉ được cập nhật từ luồng mua hàng".into()];
    }
    if entity == "member" {
        if let (Some(old), Some(new)) = (
            current.get("party").and_then(Value::as_str),
            patch.get("party").and_then(Value::as_str),
        ) && old != new
        {
            return vec!["Thành viên không thể chuyển sang khách hàng khác".into()];
        }
    }
    if entity == "voucher" {
        if current.get("used").and_then(Value::as_bool) == Some(true) {
            return vec!["Voucher đã sử dụng không thể thay đổi".into()];
        }
        let mut merged = current.as_object().cloned().unwrap_or_default();
        if let Some(fields) = patch.as_object() {
            merged.extend(fields.clone());
        }
        return validate(entity, &Value::Object(merged));
    }
    Vec::new()
}

pub fn validate_remove(entity: &str) -> Vec<String> {
    if entity == "point_txn" {
        vec!["Giao dịch điểm phải được giữ làm lịch sử kiểm toán".into()]
    } else {
        Vec::new()
    }
}
