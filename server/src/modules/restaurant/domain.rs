//! Pure restaurant order and kitchen rules.
use crate::money;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "reservation" {
        let mut errors = Vec::new();
        let start = document
            .get("starts_at")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok());
        let end = document
            .get("ends_at")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok());
        if start.is_none() {
            errors.push("Thời gian bắt đầu đặt bàn không hợp lệ".into());
        }
        if end.is_none() {
            errors.push("Thời gian kết thúc đặt bàn không hợp lệ".into());
        }
        if let (Some(start), Some(end)) = (start, end) {
            if end <= start {
                errors.push("Thời gian kết thúc phải sau thời gian bắt đầu".into());
            }
            if start.with_timezone(&Utc) <= Utc::now() {
                errors.push("Đặt bàn phải bắt đầu trong tương lai".into());
            }
        }
        if !document
            .get("guest_count")
            .and_then(money::decimal)
            .is_some_and(|count| count > Decimal::ZERO && count.fract().is_zero())
        {
            errors.push("Số khách phải là số nguyên dương".into());
        }
        if document
            .get("guest_name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty() || name.chars().count() > 160)
        {
            errors.push("Tên khách phải có từ 1 đến 160 ký tự".into());
        }
        if document.get("phone").is_some_and(|phone| {
            phone
                .as_str()
                .is_none_or(|phone| phone.chars().count() > 80)
        }) {
            errors.push("Số điện thoại không được vượt quá 80 ký tự".into());
        }
        if document
            .get("note")
            .is_some_and(|note| note.as_str().is_none_or(|note| note.chars().count() > 1000))
        {
            errors.push("Ghi chú không được vượt quá 1.000 ký tự".into());
        }
        return errors;
    }
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
        if line
            .get("note")
            .is_some_and(|note| note.as_str().is_none_or(|note| note.chars().count() > 500))
        {
            errors.push(format!("{prefix}.note phải là văn bản tối đa 500 ký tự"));
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "reservation" if current.get("status").and_then(Value::as_str) != Some("requested") => {
            let assigning_waitlist_table = matches!(
                current.get("status").and_then(Value::as_str),
                Some("confirmed" | "arrived")
            ) && current.get("table").is_none_or(Value::is_null)
                && patch
                    .as_object()
                    .is_some_and(|fields| fields.len() == 1 && fields.contains_key("table"));
            if !assigning_waitlist_table
                && [
                    "guest_name",
                    "phone",
                    "table",
                    "guest_count",
                    "starts_at",
                    "ends_at",
                    "note",
                ]
                .iter()
                .any(|field| patch.get(*field).is_some())
            {
                return vec!["Đặt bàn đã xác nhận không được sửa; hãy hủy và tạo lại".into()];
            }
            Vec::new()
        }
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
        "reservation" if document.get("status").and_then(Value::as_str) != Some("requested") => {
            vec!["Đặt bàn đã xác nhận phải được hủy qua luồng trạng thái, không được xóa".into()]
        }
        "kitchen_ticket" => vec!["Phiếu bếp là dấu vết vận hành, không được xóa trực tiếp".into()],
        "table_order" if document.get("status").and_then(Value::as_str) != Some("open") => {
            vec!["Order đã gửi bếp phải hủy qua luồng trạng thái, không được xóa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "reservation" {
        let now = Utc::now();
        let instant = |field: &str| {
            document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc))
        };
        let Some(start) = instant("starts_at") else {
            return vec!["Đặt bàn cần thời gian bắt đầu hợp lệ trước khi đổi trạng thái".into()];
        };
        let Some(end) = instant("ends_at") else {
            return vec!["Đặt bàn cần thời gian kết thúc hợp lệ trước khi đổi trạng thái".into()];
        };
        return match action {
            "confirmed" if start <= now => {
                vec!["Không thể xác nhận đặt bàn đã bắt đầu hoặc đã qua".into()]
            }
            "arrived" if now < start || now >= end => {
                vec!["Chỉ ghi nhận khách đã đến trong khung giờ đặt bàn".into()]
            }
            "cancelled" if start <= now => {
                vec!["Không thể hủy đặt bàn sau giờ bắt đầu; hãy ghi nhận khách vắng mặt".into()]
            }
            "no_show" if end > now => {
                vec!["Chỉ ghi nhận khách vắng mặt sau khi khung giờ đặt bàn kết thúc".into()]
            }
            _ => Vec::new(),
        };
    }
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
