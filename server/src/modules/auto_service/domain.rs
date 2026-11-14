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
                !money::decimal(odometer).is_some_and(|value| value >= Decimal::ZERO)
            }) {
                errors.push("Số công-tơ-mét phải là số không âm".into());
            }
            errors
        }
        "repair_order" => {
            let mut errors = Vec::new();
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
    if entity != "repair_order" || action != "completed" {
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
        && matches!(
            current.get("status").and_then(Value::as_str),
            Some("approved" | "in_progress")
        )
        && patch.as_object().is_some_and(|fields| {
            ["lines", "warehouse", "complaint"]
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
            Some("completed" | "delivered")
        )
    {
        vec!["Lệnh sửa chữa đã hoàn tất hoặc giao xe không thể xóa khỏi lịch sử".into()]
    } else {
        Vec::new()
    }
}
