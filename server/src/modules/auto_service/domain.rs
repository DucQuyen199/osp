//! Automotive workshop invariants independent of PostgreSQL and HTTP.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "vehicle" => {
            let mut errors = Vec::new();
            if document
                .get("plate")
                .and_then(Value::as_str)
                .is_none_or(|plate| plate.trim().is_empty())
            {
                errors.push("Xe phải có biển số".into());
            }
            if document.get("odometer").is_some_and(|odometer| {
                !money::decimal(odometer)
                    .is_some_and(|value| value >= Decimal::ZERO && value.fract() == Decimal::ZERO)
            }) {
                errors.push("Số công-tơ-mét phải là số km nguyên không âm".into());
            }
            errors
        }
        "repair_order" => {
            let mut errors = Vec::new();
            if document.get("odometer_reading").is_some_and(|reading| {
                !money::decimal(reading)
                    .is_some_and(|value| value >= Decimal::ZERO && value.fract() == Decimal::ZERO)
            }) {
                errors.push("Số km lúc tiếp nhận phải là số km nguyên không âm".into());
            }
            if let Some(lines) = document.get("lines") {
                let Some(lines) = lines.as_array() else {
                    return vec!["Dòng sửa chữa phải là danh sách".into()];
                };
                for (index, line) in lines.iter().enumerate() {
                    let prefix = format!("Dòng sửa chữa {}", index + 1);
                    let quantity = line.get("qty").and_then(money::decimal);
                    if !quantity.is_some_and(|value| value > Decimal::ZERO) {
                        errors.push(format!("{prefix}: số lượng phải lớn hơn 0"));
                    }
                    if line.get("price").is_some_and(|price| {
                        !money::decimal(price).is_some_and(|value| value >= Decimal::ZERO)
                    }) {
                        errors.push(format!("{prefix}: đơn giá không thể âm"));
                    }
                    let tracked = line.get("tracked") == Some(&Value::Bool(true));
                    if tracked
                        && line
                            .get("product")
                            .and_then(Value::as_str)
                            .is_none_or(str::is_empty)
                    {
                        errors.push(format!(
                            "{prefix}: phụ tùng theo dõi tồn kho phải chọn sản phẩm"
                        ));
                    }
                }
            }
            errors
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "repair_order" {
        return Vec::new();
    }
    if action == "approved" {
        let Some(lines) = document.get("lines").and_then(Value::as_array) else {
            return vec!["Báo giá phải có ít nhất một dòng công việc có số lượng và đơn giá hợp lệ trước khi duyệt".into()];
        };
        if lines.is_empty()
            || lines.iter().any(|line| {
                !line
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|quantity| quantity > Decimal::ZERO)
                    || !line
                        .get("price")
                        .and_then(money::decimal)
                        .is_some_and(|price| price >= Decimal::ZERO)
            })
        {
            return vec!["Báo giá phải có ít nhất một dòng công việc có số lượng và đơn giá hợp lệ trước khi duyệt".into()];
        }
        let total = document.get("total").and_then(money::decimal);
        let expected_total = money::sum_line_totals(lines);
        if !matches!((total, expected_total), (Some(total), Some(expected)) if total >= Decimal::ZERO && total == expected)
        {
            return vec!["Tổng báo giá phải khớp với các dòng công việc trước khi duyệt".into()];
        }
        return Vec::new();
    }
    if action == "quote_declined" {
        let reason = document
            .get("declined_reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        return if (5..=500).contains(&reason.chars().count()) {
            Vec::new()
        } else {
            vec!["Cần ghi lý do khách từ chối báo giá (5–500 ký tự)".into()]
        };
    }
    if action != "completed" {
        return Vec::new();
    }
    if document
        .get("lines")
        .and_then(Value::as_array)
        .is_some_and(|lines| !lines.is_empty())
        && document
            .get("total")
            .and_then(money::decimal)
            .is_some_and(|amount| amount >= Decimal::ZERO)
    {
        Vec::new()
    } else {
        vec![
            "Lệnh phải có ít nhất một dòng công việc với tổng tiền hợp lệ trước khi hoàn tất"
                .into(),
        ]
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "repair_order"
        && current.get("status").and_then(Value::as_str) == Some("quote_declined")
        && patch.as_object().is_some_and(|fields| !fields.is_empty())
    {
        return vec!["Báo giá khách đã từ chối là lịch sử và không thể sửa".into()];
    }
    if entity == "repair_order"
        && patch.get("declined_reason").is_some()
        && current.get("status").and_then(Value::as_str) != Some("intake")
    {
        return vec!["Chỉ ghi lý do từ chối khi lệnh đang chờ khách duyệt".into()];
    }
    if entity == "repair_order"
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("approved" | "in_progress")
        )
        && patch.as_object().is_some_and(|fields| {
            [
                "vehicle",
                "party",
                "lines",
                "warehouse",
                "complaint",
                "odometer_reading",
            ]
            .iter()
            .any(|field| fields.contains_key(*field))
        })
    {
        return vec![
            "Báo giá đã được duyệt hoặc xe đã vào sửa; không thể thay đổi nội dung sửa chữa".into(),
        ];
    }
    if entity == "repair_order"
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("completed" | "delivered")
        )
        && patch.as_object().is_some_and(|fields| !fields.is_empty())
    {
        vec!["Lệnh sửa chữa đã hoàn tất hoặc giao xe là chứng từ lịch sử và không thể sửa".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "repair_order"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("approved" | "in_progress" | "completed" | "delivered" | "quote_declined")
        )
    {
        vec![
            "Lệnh đã hoàn tất, bàn giao hoặc khách từ chối báo giá không thể xóa khỏi lịch sử"
                .into(),
        ]
    } else {
        Vec::new()
    }
}
