//! Pure farm, crop-cycle, and field-operation invariants.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| (value.len() == 10).then_some(value))
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "farm" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Trang trại cần có tên".into());
            }
            if document.get("area").is_some_and(|area| {
                !money::decimal(area).is_some_and(|value| value > Decimal::ZERO)
            }) {
                errors.push("Diện tích trang trại phải lớn hơn 0".into());
            }
        }
        "crop_cycle" => {
            if document
                .get("crop")
                .and_then(Value::as_str)
                .is_none_or(|crop| crop.trim().is_empty())
            {
                errors.push("Vụ mùa cần có tên cây trồng".into());
            }
            if date(document, "planted_on").is_none() {
                errors.push("Ngày gieo trồng phải hợp lệ".into());
            }
            if document
                .get("expected_harvest")
                .is_some_and(|value| !value.is_null())
            {
                match (
                    date(document, "planted_on"),
                    date(document, "expected_harvest"),
                ) {
                    (Some(planted), Some(expected)) if expected >= planted => {}
                    _ => errors.push(
                        "Ngày thu hoạch dự kiến phải hợp lệ và không trước ngày gieo trồng".into(),
                    ),
                }
            }
        }
        "harvest" => {
            if !document
                .get("qty")
                .and_then(money::decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Sản lượng thu hoạch phải lớn hơn 0".into());
            }
            if date(document, "date").is_none() {
                errors.push("Ngày thu hoạch phải hợp lệ".into());
            }
            if document.get("expiry").is_some_and(|value| !value.is_null()) {
                match (date(document, "date"), date(document, "expiry")) {
                    (Some(harvested), Some(expiry)) if expiry >= harvested => {}
                    _ => errors
                        .push("Ngày hết hạn lô phải hợp lệ và không trước ngày thu hoạch".into()),
                }
            }
        }
        "input_application" => {
            if !document
                .get("qty")
                .and_then(money::decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Lượng vật tư sử dụng phải lớn hơn 0".into());
            }
            if date(document, "date").is_none() {
                errors.push("Ngày sử dụng vật tư phải hợp lệ".into());
            }
            if document.get("kind").and_then(Value::as_str) == Some("water")
                && document
                    .get("product")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                && document
                    .get("uom")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
            {
                errors.push("Nước tưới ghi ngoài kho cần có đơn vị đo".into());
            }
            if matches!(
                document.get("kind").and_then(Value::as_str),
                Some("fertilizer" | "pesticide" | "seed")
            ) && document
                .get("product")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                errors.push("Vật tư phân bón, thuốc và giống cần chọn sản phẩm".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "crop_cycle" && action == "harvested" {
        return if document.get("id").and_then(Value::as_str).is_some() {
            Vec::new()
        } else {
            vec!["Không xác định được vụ mùa cần kết thúc".into()]
        };
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if entity == "crop_cycle" && current.get("status").and_then(Value::as_str) != Some("growing") {
        return vec!["Vụ mùa đã kết thúc không thể sửa".into()];
    }
    if matches!(entity, "harvest" | "input_application") {
        return vec!["Nhật ký thu hoạch và sử dụng vật tư không thể sửa".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if matches!(entity, "harvest" | "input_application") {
        return vec!["Nhật ký canh tác không thể xóa khỏi lịch sử".into()];
    }
    if entity == "crop_cycle" && document.get("status").and_then(Value::as_str) != Some("growing") {
        return vec!["Vụ mùa đã kết thúc không thể xóa khỏi lịch sử".into()];
    }
    Vec::new()
}
