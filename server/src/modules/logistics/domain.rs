//! Pure shipment and fleet validation rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
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

fn shipment_quantities(
    lines: &Value,
) -> Option<HashMap<(String, Decimal, Option<String>), Decimal>> {
    let mut quantities = HashMap::new();
    for line in lines.as_array()? {
        if matches!(
            line.get("kind").and_then(Value::as_str),
            Some("service" | "digital")
        ) {
            continue;
        }
        let product = line.get("product").and_then(Value::as_str)?;
        let price = number(line, "price")?.round_dp(2);
        let qty = number(line, "qty")?;
        if product.is_empty() || price < Decimal::ZERO || qty <= Decimal::ZERO {
            return None;
        }
        let unit = line.get("uom").and_then(Value::as_str).map(str::to_owned);
        let total = quantities
            .entry((product.to_owned(), price, unit))
            .or_insert(Decimal::ZERO);
        *total = total.checked_add(qty)?;
    }
    Some(quantities)
}

pub(super) fn normalize_delivered_lines(shipped: &Value, delivered: &Value) -> Option<Value> {
    let mut remaining = shipment_quantities(delivered)?;
    let mut normalized = Vec::new();
    for line in shipped.as_array()? {
        if matches!(
            line.get("kind").and_then(Value::as_str),
            Some("service" | "digital")
        ) {
            continue;
        }
        let product = line.get("product").and_then(Value::as_str)?;
        let price = number(line, "price")?.round_dp(2);
        let shipped_qty = number(line, "qty")?;
        let unit = line.get("uom").and_then(Value::as_str).map(str::to_owned);
        let key = (product.to_owned(), price, unit);
        let delivered_qty = remaining
            .get_mut(&key)
            .map(|qty| {
                let applied = (*qty).min(shipped_qty);
                *qty -= applied;
                applied
            })
            .unwrap_or_default();
        if delivered_qty <= Decimal::ZERO {
            continue;
        }
        let mut line = line.clone();
        line["qty"] = money::json_number(delivered_qty)?;
        if let Some(base_qty) = line.get("base_qty").and_then(money::decimal) {
            let normalized_base_qty = base_qty
                .checked_mul(delivered_qty)?
                .checked_div(shipped_qty)?;
            line["base_qty"] = money::json_number(normalized_base_qty)?;
        }
        normalized.push(line);
    }
    if remaining.values().any(|qty| *qty > Decimal::new(1, 6)) || normalized.is_empty() {
        return None;
    }
    Some(Value::Array(normalized))
}

pub(super) fn remaining_lines(shipped: &Value, delivered: &Value) -> Option<Value> {
    let mut delivered = shipment_quantities(&normalize_delivered_lines(shipped, delivered)?)?;
    let mut remaining = Vec::new();
    for line in shipped.as_array()? {
        if matches!(
            line.get("kind").and_then(Value::as_str),
            Some("service" | "digital")
        ) {
            continue;
        }
        let product = line.get("product").and_then(Value::as_str)?;
        let price = number(line, "price")?.round_dp(2);
        let shipped_qty = number(line, "qty")?;
        let unit = line.get("uom").and_then(Value::as_str).map(str::to_owned);
        let key = (product.to_owned(), price, unit);
        let delivered_qty = delivered.entry(key).or_default();
        let remaining_qty = shipped_qty.checked_sub((*delivered_qty).min(shipped_qty))?;
        *delivered_qty -= (*delivered_qty).min(shipped_qty);
        if remaining_qty <= Decimal::new(1, 6) {
            continue;
        }
        let mut remaining_line = line.clone();
        remaining_line["qty"] = money::json_number(remaining_qty)?;
        if let Some(base_qty) = line.get("base_qty").and_then(money::decimal) {
            remaining_line["base_qty"] = money::json_number(
                base_qty
                    .checked_mul(remaining_qty)?
                    .checked_div(shipped_qty)?,
            )?;
        }
        remaining.push(remaining_line);
    }
    (!remaining.is_empty()).then_some(Value::Array(remaining))
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
        let shipment = document.get("lines").and_then(shipment_quantities);
        let delivered_lines = document
            .get("delivered_lines")
            .filter(|value| !value.is_null())
            .or_else(|| document.get("lines"));
        let delivered = delivered_lines.and_then(shipment_quantities);
        match (shipment, delivered) {
            (Some(shipment), Some(delivered)) if !delivered.is_empty() => {
                if delivered.iter().any(|(key, qty)| {
                    shipment
                        .get(key)
                        .copied()
                        .unwrap_or_default()
                        .checked_add(Decimal::new(1, 6))
                        .is_none_or(|limit| *qty > limit)
                }) {
                    errors.push("Số lượng giao thực tế không được vượt số lượng vận đơn".into());
                }
                let partial = shipment.iter().any(|(key, qty)| {
                    delivered
                        .get(key)
                        .copied()
                        .unwrap_or_default()
                        .checked_add(Decimal::new(1, 6))
                        .is_some_and(|received| received < *qty)
                });
                if partial
                    && document
                        .get("short_delivery_reason")
                        .and_then(Value::as_str)
                        .is_none_or(|reason| !(5..=500).contains(&reason.trim().chars().count()))
                {
                    errors.push("Giao thiếu cần lý do từ 5 đến 500 ký tự".into());
                }
                if !partial
                    && document
                        .get("short_delivery_reason")
                        .and_then(Value::as_str)
                        .is_some_and(|reason| !reason.trim().is_empty())
                {
                    errors.push("Không ghi lý do giao thiếu khi đã giao đủ số lượng".into());
                }
            }
            _ => {
                errors.push("Cần ghi số lượng giao thực tế hợp lệ cho ít nhất một dòng hàng".into())
            }
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
