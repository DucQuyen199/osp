//! Pure work-order state and accounting invariants.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity != "work_order" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if let Some(ticket) = document.get("source_ticket") {
        if !ticket.is_null() && ticket.as_str().is_none_or(str::is_empty) {
            errors.push("Ticket nguồn phải là mã ticket hợp lệ".into());
        }
    }
    let start = document
        .get("scheduled_at")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    let end = document
        .get("scheduled_end")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    if document
        .get("scheduled_at")
        .is_some_and(|value| !value.is_null())
        || document
            .get("scheduled_end")
            .is_some_and(|value| !value.is_null())
    {
        if start.is_none() || end.is_none() {
            errors.push("Lịch công việc cần đủ thời điểm bắt đầu và kết thúc hợp lệ".into());
        } else if start >= end {
            errors.push("Thời điểm kết thúc phải sau thời điểm bắt đầu".into());
        }
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "work_order" {
        return Vec::new();
    }
    match action {
        "dispatched"
            if document
                .get("technician_employee")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
                && document
                    .get("technician")
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty()) =>
        {
            vec!["Cần phân công nhân viên hoặc kỹ thuật viên bên ngoài trước khi điều phối lệnh công việc".into()]
        }
        "done" => {
            let billable = document
                .get("total")
                .and_then(money::decimal)
                .is_some_and(|amount| amount > Decimal::ZERO);
            if billable {
                Vec::new()
            } else {
                vec!["Tổng tiền dịch vụ phải lớn hơn 0 trước khi hoàn tất và lập hóa đơn".into()]
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "work_order"
        && current.get("status").and_then(Value::as_str) == Some("dispatched")
        && [
            "party",
            "source_ticket",
            "title",
            "address",
            "technician",
            "technician_employee",
            "scheduled_at",
            "scheduled_end",
            "warehouse",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        return vec![
            "Không thể đổi khách hàng, người phụ trách, lịch hoặc kho của lệnh đã điều phối".into(),
        ];
    }
    if entity != "work_order"
        || !patch.as_object().is_some_and(|fields| !fields.is_empty())
        || !matches!(
            current.get("status").and_then(Value::as_str),
            Some("done" | "cancelled")
        )
    {
        return Vec::new();
    }
    vec!["Lệnh công việc đã hoàn tất hoặc hủy là chứng từ lịch sử và không thể sửa".into()]
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "work_order"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("done" | "cancelled")
        )
    {
        vec!["Lệnh công việc đã hoàn tất hoặc hủy không thể xóa khỏi lịch sử nghiệp vụ".into()]
    } else {
        Vec::new()
    }
}
