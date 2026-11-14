//! Pure restaurant order and kitchen rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "table" {
        return if document.get("seats").is_some_and(|value| !value.is_null())
            && !document
                .get("seats")
                .and_then(money::decimal)
                .is_some_and(|seats| seats > Decimal::ZERO && seats.fract().is_zero())
        {
            vec!["Số chỗ của bàn phải là số nguyên dương".into()]
        } else {
            Vec::new()
        };
    }
    if entity == "recipe" {
        let mut errors = Vec::new();
        if document
            .get("output_qty")
            .is_some_and(|value| !value.is_null())
        {
            if !document
                .get("output_qty")
                .and_then(money::decimal)
                .is_some_and(|output_qty| output_qty > Decimal::ZERO)
            {
                errors.push("recipe.output_qty phải lớn hơn 0".into());
            }
        }
        if let Some(value) = document.get("ingredients") {
            let Some(ingredients) = value.as_array() else {
                return vec!["recipe.ingredients phải là danh sách nguyên liệu".into()];
            };
            if ingredients.is_empty() {
                errors.push("Công thức cần ít nhất một nguyên liệu".into());
            }
            for (index, ingredient) in ingredients.iter().enumerate() {
                let prefix = format!("ingredients[{}]", index + 1);
                if ingredient
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .is_none()
                {
                    errors.push(format!("{prefix}.product phải là UUID hợp lệ"));
                }
                if !ingredient
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::ZERO)
                {
                    errors.push(format!("{prefix}.qty phải lớn hơn 0"));
                }
            }
        }
        return errors;
    }
    if entity != "table_order" {
        return Vec::new();
    }
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return vec!["Order cần danh sách món".into()];
    };
    if lines.is_empty() {
        return vec!["Order cần ít nhất một món".into()];
    }
    let mut errors = Vec::new();
    if document
        .get("table")
        .and_then(Value::as_str)
        .is_some_and(|table| !table.is_empty())
        && !document
            .get("guest_count")
            .and_then(money::decimal)
            .is_some_and(|guests| guests > Decimal::ZERO && guests.fract().is_zero())
    {
        errors.push("Số khách ngồi tại bàn phải là số nguyên dương".into());
    }
    for (index, line) in lines.iter().enumerate() {
        let prefix = format!("lines[{}]", index + 1);
        if line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
        {
            errors.push(format!("{prefix}.product phải là UUID hợp lệ"));
        }
        if !line
            .get("qty")
            .and_then(money::decimal)
            .is_some_and(|qty| qty > Decimal::ZERO)
        {
            errors.push(format!("{prefix}.qty phải lớn hơn 0"));
        }
        if !line
            .get("price")
            .and_then(money::decimal)
            .is_some_and(|price| price >= Decimal::ZERO)
        {
            errors.push(format!("{prefix}.price phải là số không âm"));
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "kitchen_ticket" => vec!["Phiếu bếp chỉ được cập nhật qua hành động trạng thái".into()],
        "table_order" => match current.get("status").and_then(Value::as_str) {
            Some("sent" | "served")
                if [
                    "table",
                    "party",
                    "warehouse",
                    "lines",
                    "total",
                    "consumptions",
                    "status",
                ]
                .iter()
                .any(|field| patch.get(*field).is_some()) =>
            {
                vec!["Order đã gửi bếp không được sửa món, số tiền, bàn hoặc kho".into()]
            }
            Some("completed" | "cancelled")
                if patch.as_object().is_some_and(|fields| !fields.is_empty()) =>
            {
                vec!["Order đã hoàn tất hoặc hủy không được sửa".into()]
            }
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "kitchen_ticket" => vec!["Phiếu bếp là dấu vết vận hành, không được xóa trực tiếp".into()],
        "table_order" if document.get("status").and_then(Value::as_str) != Some("open") => {
            vec!["Order đã gửi bếp phải hủy qua luồng trạng thái, không được xóa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "table_order"
        && action == "cancelled"
        && document.get("status").and_then(Value::as_str) == Some("sent")
    {
        let reason = document
            .get("cancellation_reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|reason| !reason.is_empty());
        return match reason {
            None => vec!["Cần ghi lý do hủy order sau khi đã gửi bếp".into()],
            Some(reason) if reason.chars().count() > 500 => {
                vec!["Lý do hủy order không được vượt quá 500 ký tự".into()]
            }
            Some(_) => Vec::new(),
        };
    }
    if entity != "table_order" || action != "completed" {
        return Vec::new();
    }
    let amount = document
        .get("total")
        .and_then(money::decimal)
        .unwrap_or(Decimal::ZERO);
    if amount <= Decimal::ZERO {
        return Vec::new();
    }
    match document.get("method").and_then(Value::as_str) {
        Some("cash" | "card" | "transfer" | "ewallet") => Vec::new(),
        _ => vec!["Order có giá trị cần phương thức thanh toán hợp lệ trước khi hoàn tất".into()],
    }
}
