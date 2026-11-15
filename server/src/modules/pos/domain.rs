//! Pure POS order and cash-session rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal(value: &Value) -> Option<Decimal> {
    money::decimal(value)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "pos_session" {
        let opening_cash = document.get("opening_cash").and_then(decimal);
        return if opening_cash.is_some_and(|amount| amount >= Decimal::ZERO) {
            Vec::new()
        } else {
            vec!["Tiền đầu ca phải là số không âm".into()]
        };
    }
    if entity == "cash_movement" {
        let valid_amount = document
            .get("amount")
            .and_then(decimal)
            .is_some_and(|amount| amount > Decimal::ZERO);
        let valid_direction = matches!(
            document.get("direction").and_then(Value::as_str),
            Some("cash_in" | "cash_out")
        );
        let valid_reason = document
            .get("reason")
            .and_then(Value::as_str)
            .is_some_and(|reason| !reason.trim().is_empty());
        let mut errors = Vec::new();
        if !valid_amount {
            errors.push("Số tiền thu chi phải lớn hơn 0".into());
        }
        if !valid_direction {
            errors.push("Loại giao dịch quỹ phải là thu hoặc chi".into());
        }
        if !valid_reason {
            errors.push("Phiếu thu chi cần nêu lý do".into());
        }
        return errors;
    }
    if entity != "pos_order" {
        return Vec::new();
    }
    if document
        .get("cash_received")
        .is_some_and(|amount| !decimal(amount).is_some_and(|value| value >= Decimal::ZERO))
    {
        return vec!["Số tiền khách đưa phải là số không âm hợp lệ".into()];
    }
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return vec!["Đơn POS cần danh sách dòng hàng".into()];
    };
    let mut errors = Vec::new();
    if lines.is_empty() {
        errors.push("Đơn POS cần ít nhất một dòng hàng".into());
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
            .and_then(decimal)
            .is_some_and(|value| value > Decimal::ZERO)
        {
            errors.push(format!("{prefix}.qty phải lớn hơn 0"));
        }
    }
    errors
}

pub fn validate_update(current: &Value, patch: &Value) -> Vec<String> {
    if patch.get("refund_reason").is_some() {
        let reason = patch.get("refund_reason").and_then(Value::as_str);
        let can_add_refund_reason = current.get("status").and_then(Value::as_str)
            == Some("completed")
            && current.get("refund_reason").is_none()
            && patch.as_object().is_some_and(|fields| fields.len() == 1)
            && reason.is_some_and(|value| (5..=500).contains(&value.trim().chars().count()));
        if can_add_refund_reason {
            return Vec::new();
        }
        return vec!["Lý do hoàn tiền chỉ được ghi một lần cùng lúc hoàn đơn POS".into()];
    }
    if current.get("status").and_then(Value::as_str) == Some("open") {
        return Vec::new();
    }
    let protected = [
        "party",
        "branch",
        "warehouse",
        "session",
        "prescription",
        "lines",
        "total",
        "method",
        "voucher_code",
        "voucher_discount",
        "cash_received",
        "change_due",
        "refund_reason",
    ];
    if protected.iter().any(|field| patch.get(*field).is_some()) {
        vec!["Đơn POS đã hoàn tất không thể sửa dữ liệu giao dịch".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_session_update(current: &Value, patch: &Value) -> Vec<String> {
    if current.get("status").and_then(Value::as_str) != Some("open") {
        return vec!["Ca POS đã đóng không thể thay đổi".into()];
    }
    if patch
        .as_object()
        .is_some_and(|fields| fields.keys().any(|key| key != "closing_cash"))
    {
        return vec!["Ca POS chỉ cho phép cập nhật tiền thực đếm trước khi đóng".into()];
    }
    if patch
        .get("closing_cash")
        .is_some_and(|amount| !decimal(amount).is_some_and(|value| value >= Decimal::ZERO))
    {
        return vec!["Tiền thực đếm phải là số không âm".into()];
    }
    Vec::new()
}

pub fn validate_cash_movement_update(current: &Value, patch: &Value) -> Vec<String> {
    if current.get("status").and_then(Value::as_str) != Some("draft") {
        return vec!["Phiếu thu chi đã ghi sổ không thể thay đổi".into()];
    }
    let mut merged = current.as_object().cloned().unwrap_or_default();
    if let Some(fields) = patch.as_object() {
        merged.extend(fields.clone());
    }
    validate("cash_movement", &Value::Object(merged))
}

pub fn validate_cash_movement_remove(document: &Value) -> Vec<String> {
    if document.get("status").and_then(Value::as_str) == Some("draft") {
        Vec::new()
    } else {
        vec!["Phiếu thu chi đã ghi sổ phải được giữ làm dấu vết tài chính".into()]
    }
}

pub fn validate_cash_movement_action(action: &str, document: &Value) -> Vec<String> {
    if action != "posted" {
        return Vec::new();
    }
    validate("cash_movement", document)
}

pub fn validate_session_close(document: &Value) -> Vec<String> {
    let has_closing_cash = document
        .get("closing_cash")
        .and_then(decimal)
        .is_some_and(|amount| amount >= Decimal::ZERO);
    if has_closing_cash {
        Vec::new()
    } else {
        vec!["Cần nhập số tiền thực đếm trước khi đóng ca".into()]
    }
}

pub fn validate_remove(document: &Value) -> Vec<String> {
    if document.get("status").and_then(Value::as_str) != Some("open") {
        vec!["Đơn POS đã hoàn tất phải được giữ làm dấu vết giao dịch".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "cash_movement" {
        return validate_cash_movement_action(action, document);
    }
    if action == "completed" {
        let total = document
            .get("total")
            .and_then(decimal)
            .unwrap_or(Decimal::ZERO);
        if total <= Decimal::ZERO {
            return vec!["Tổng đơn POS phải lớn hơn 0 trước khi hoàn tất".into()];
        }
        if !matches!(
            document.get("method").and_then(Value::as_str),
            Some("cash" | "card" | "transfer" | "ewallet")
        ) {
            return vec!["Đơn POS cần phương thức thanh toán hợp lệ trước khi hoàn tất".into()];
        }
        if document.get("method").and_then(Value::as_str) == Some("cash")
            && !document
                .get("cash_received")
                .and_then(decimal)
                .is_some_and(|received| received >= total)
        {
            return vec!["Số tiền khách đưa phải bằng hoặc lớn hơn tổng thanh toán trước khi hoàn tất đơn tiền mặt".into()];
        }
    }
    if entity == "pos_order" && action == "refunded" {
        let reason = document.get("refund_reason").and_then(Value::as_str);
        if !reason.is_some_and(|value| (5..=500).contains(&value.trim().chars().count())) {
            return vec!["Hoàn đơn POS cần lý do từ 5 đến 500 ký tự".into()];
        }
    }
    Vec::new()
}
