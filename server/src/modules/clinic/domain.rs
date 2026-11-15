//! Pure clinic validation and record-lifecycle rules.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn positive(value: Option<&Value>) -> bool {
    value
        .and_then(money::decimal)
        .is_some_and(|amount| amount > Decimal::ZERO)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    validate_at(entity, document, chrono::Utc::now().date_naive())
}

pub fn validate_at(entity: &str, document: &Value, today: chrono::NaiveDate) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "patient" => {
            if let Some(dob) = document.get("dob").and_then(Value::as_str) {
                if dob.len() != 10
                    || NaiveDate::parse_from_str(dob, "%Y-%m-%d")
                        .ok()
                        .is_none_or(|date| date > today)
                {
                    errors.push("Ngày sinh phải hợp lệ và không nằm trong tương lai".into());
                }
            }
        }
        "encounter" => {
            if document
                .get("doctor")
                .and_then(Value::as_str)
                .is_some_and(|doctor| doctor.trim().is_empty())
            {
                errors.push("Tên bác sĩ không được để trống".into());
            }
            if document
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| status == "completed")
                && !positive(document.get("fee"))
            {
                errors.push("Lượt khám hoàn tất cần phí khám lớn hơn 0".into());
            }
        }
        "prescription" => {
            if let Some(items) = document.get("items") {
                match items.as_array() {
                    Some(items) => errors.extend(validate_items(items, false)),
                    None => errors.push("Các thuốc kê đơn phải là danh sách dòng thuốc".into()),
                }
            }
        }
        "lab_order" => {
            if document
                .get("test")
                .and_then(Value::as_str)
                .is_none_or(|test| test.trim().is_empty())
            {
                errors.push("Chỉ định xét nghiệm cần tên xét nghiệm".into());
            }
        }
        _ => {}
    }
    errors
}

fn validate_items(items: &[Value], require_nonempty: bool) -> Vec<String> {
    if items.is_empty() && require_nonempty {
        return vec!["Đơn thuốc cần ít nhất một dòng thuốc".into()];
    }
    let mut errors = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let line = format!("Thuốc [{}]", index + 1);
        if item
            .get("product")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            errors.push(format!("{line} cần sản phẩm hợp lệ"));
        }
        if !item
            .get("qty")
            .and_then(money::decimal)
            .is_some_and(|qty| qty > Decimal::ZERO)
        {
            errors.push(format!("{line} cần số lượng lớn hơn 0"));
        }
        if item
            .get("dosage")
            .and_then(Value::as_str)
            .is_some_and(|dosage| dosage.trim().is_empty())
        {
            errors.push(format!("{line} có hướng dẫn dùng thuốc rỗng"));
        }
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("encounter", "completed") => {
            let mut errors = Vec::new();
            if document
                .get("doctor")
                .and_then(Value::as_str)
                .is_none_or(|doctor| doctor.trim().is_empty())
            {
                errors.push("Cần ghi nhận bác sĩ trước khi hoàn tất lượt khám".into());
            }
            if document
                .get("diagnosis")
                .and_then(Value::as_str)
                .is_none_or(|diagnosis| diagnosis.trim().is_empty())
            {
                errors.push("Cần ghi nhận chẩn đoán trước khi hoàn tất lượt khám".into());
            }
            if !positive(document.get("fee")) {
                errors.push("Lượt khám hoàn tất cần phí khám lớn hơn 0".into());
            }
            errors
        }
        ("prescription", "dispensed") => match document.get("items").and_then(Value::as_array) {
            Some(items) => validate_items(items, true),
            None => vec!["Đơn thuốc cần danh sách thuốc trước khi phát".into()],
        },
        ("lab_order", "resulted") => {
            if document
                .get("result")
                .and_then(Value::as_str)
                .is_none_or(|result| result.trim().is_empty())
            {
                vec!["Cần nhập kết quả xét nghiệm trước khi hoàn tất".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if matches!(entity, "prescription" | "lab_order") && patch.get("encounter").is_some() {
        return vec!["Không thể chuyển chỉ định sang lượt khám khác sau khi đã ghi nhận".into()];
    }
    if entity == "lab_order" && patch.get("test").is_some() {
        return vec!["Không thể thay đổi xét nghiệm đã được chỉ định; hãy tạo chỉ định mới".into()];
    }
    match (entity, current.get("status").and_then(Value::as_str)) {
        ("encounter", Some("completed")) => {
            vec!["Lượt khám hoàn tất không thể sửa".into()]
        }
        ("prescription", Some("dispensed")) => {
            vec!["Đơn thuốc đã phát không thể sửa".into()]
        }
        ("lab_order", Some("resulted")) => {
            vec!["Kết quả xét nghiệm đã hoàn tất không thể sửa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "encounter"
        && document
            .get("appointment")
            .is_some_and(|appointment| !appointment.is_null())
    {
        return vec![
            "LÆ°á»£t khÃ¡m táº¡o tá»« lá»‹ch háº¹n pháº£i Ä‘Æ°á»£c giá»¯ cÃ¹ng lá»‹ch sá»­".into(),
        ];
    }
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("encounter", Some("completed")) => {
            vec!["Lượt khám hoàn tất không thể xóa khỏi hồ sơ bệnh án".into()]
        }
        ("prescription", Some("dispensed")) => {
            vec!["Đơn thuốc đã phát không thể xóa khỏi lịch sử".into()]
        }
        ("lab_order", Some("resulted")) => {
            vec!["Kết quả xét nghiệm đã hoàn tất không thể xóa khỏi lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
