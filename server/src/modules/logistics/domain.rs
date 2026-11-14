//! Pure shipment and fleet validation rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn number(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub(super) fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "vehicle" => {
            if let Some(capacity) = document.get("capacity") {
                if !money::decimal(capacity).is_some_and(|value| value > Decimal::ZERO) {
                    errors.push("Tải trọng phương tiện phải là số dương".into());
                }
            }
        }
        "shipment" => {
            if let Some(weight) = document.get("weight") {
                if !money::decimal(weight).is_some_and(|value| value >= Decimal::ZERO) {
                    errors.push("Khối lượng vận đơn không được âm".into());
                }
            }
            if let Some(lines) = document.get("lines") {
                let Some(lines) = lines.as_array() else {
                    return vec!["Shipment lines must be a list".into()];
                };
                if lines.is_empty() {
                    errors.push("Vận đơn cần có ít nhất một dòng hàng".into());
                }
                for (index, line) in lines.iter().enumerate() {
                    if id(line, "product").is_none()
                        || number(line, "qty").is_none_or(|qty| qty <= Decimal::ZERO)
                        || number(line, "price").is_none_or(|price| price < Decimal::ZERO)
                    {
                        errors.push(format!(
                            "Dòng vận đơn {} cần product, price hợp lệ và qty dương",
                            index + 1
                        ));
                    }
                }
            }
        }
        "tracking_event" => {
            if document
                .get("description")
                .and_then(Value::as_str)
                .is_none_or(|description| description.trim().is_empty())
            {
                errors.push("Tracking event description cannot be empty".into());
            }
            if document
                .get("occurred_at")
                .and_then(Value::as_str)
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_none()
            {
                errors.push("Tracking event requires a valid occurrence timestamp".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "tracking_event" {
        return vec!["Carrier tracking events are immutable audit history".into()];
    }
    if entity == "shipment" {
        if current.get("source").and_then(Value::as_str) == Some("sales_order")
            && patch.get("weight").is_some()
        {
            return vec!["Khối lượng vận đơn bán hàng được chụp từ sản phẩm trong đơn bán".into()];
        }
        let status = current.get("status").and_then(Value::as_str);
        let protected: &[&str] = if status == Some("dispatched") {
            &[
                "party",
                "origin",
                "destination",
                "vehicle",
                "driver",
                "source",
                "source_id",
                "warehouse",
                "lines",
                "weight",
                "carrier",
                "tracking_number",
            ]
        } else if status != Some("created") {
            &[
                "party",
                "origin",
                "destination",
                "vehicle",
                "driver",
                "source",
                "source_id",
                "warehouse",
                "lines",
                "weight",
                "failure_reason",
                "carrier",
                "tracking_number",
                "delivered_at",
                "received_by",
                "delivery_evidence",
            ]
        } else {
            &[]
        };
        if protected.iter().any(|field| patch.get(*field).is_some()) {
            return vec![
                "Thông tin vận đơn đang vận chuyển hoặc đã kết thúc không được sửa".into(),
            ];
        }
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "tracking_event" => {
            vec!["Carrier tracking events must be retained as audit history".into()]
        }
        "shipment" if document.get("status").and_then(Value::as_str) != Some("created") => {
            vec!["Vận đơn đã xuất phát phải được giữ làm dấu vết giao nhận".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "shipment" && action == "delivered" {
        let mut errors = Vec::new();
        let delivered_at = document
            .get("delivered_at")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
        if delivered_at
            .is_none_or(|value| value > chrono::Utc::now() + chrono::Duration::minutes(5))
        {
            errors.push("Xác nhận giao hàng cần thời điểm giao hợp lệ, không ở tương lai".into());
        }
        let received_by = document
            .get("received_by")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        let evidence = document
            .get("delivery_evidence")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if !received_by && !evidence {
            errors
                .push("Cần ghi người nhận hoặc mã/bằng chứng giao hàng trước khi hoàn tất".into());
        }
        if document
            .get("received_by")
            .and_then(Value::as_str)
            .is_some_and(|value| value.chars().count() > 160)
        {
            errors.push("Tên người nhận không được vượt quá 160 ký tự".into());
        }
        if document
            .get("delivery_evidence")
            .and_then(Value::as_str)
            .is_some_and(|value| value.chars().count() > 1000)
        {
            errors.push("Bằng chứng giao hàng không được vượt quá 1000 ký tự".into());
        }
        if !errors.is_empty() {
            return errors;
        }
    }
    if entity == "shipment" && action == "dispatched" && number(document, "weight").is_none() {
        return vec!["Cần khai báo hoặc tính được khối lượng vận đơn trước khi xuất phát".into()];
    }
    if entity == "shipment" && action == "failed" {
        if document
            .get("failure_reason")
            .and_then(Value::as_str)
            .map_or(true, |reason| reason.trim().is_empty())
        {
            return vec!["Cần ghi lý do giao hàng thất bại".into()];
        }
    }
    Vec::new()
}
