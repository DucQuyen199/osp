//! Pure inspection state and traceability rules.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub(super) fn number(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "inspection_disposition" {
        let mut errors = Vec::new();
        if id(document, "inspection").is_none() {
            errors.push("Phiếu xử lý cần tham chiếu phiếu QC hợp lệ".into());
        }
        if !number(document, "qty").is_some_and(|qty| qty > Decimal::ZERO) {
            errors.push("Số lượng xử lý phải lớn hơn 0".into());
        }
        if !document
            .get("note")
            .and_then(Value::as_str)
            .is_some_and(|note| !note.trim().is_empty())
        {
            errors.push("Cần ghi lý do giải phóng một phần hàng QC".into());
        }
        return errors;
    }
    if entity != "inspection" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    let traceable_source = matches!(
        document.get("source").and_then(Value::as_str),
        Some("production_order" | "production_rework" | "purchase_order")
    );
    if traceable_source
        && !number(document, "qty").is_some_and(|qty| qty > Decimal::ZERO)
        && id(document, "id").is_none()
    {
        errors.push("Số lượng kiểm tra phải lớn hơn 0".into());
    }
    if document
        .get("unit_cost")
        .is_some_and(|_| !number(document, "unit_cost").is_some_and(|cost| cost >= Decimal::ZERO))
    {
        errors.push("Đơn giá kiểm tra phải là số không âm".into());
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "inspection_disposition" {
        if current
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status != "draft")
        {
            return vec!["Phiếu xử lý đã ghi sổ phải được giữ nguyên làm lịch sử".into()];
        }
        return Vec::new();
    }
    if entity != "inspection" {
        return Vec::new();
    }
    if current.get("status").and_then(Value::as_str) != Some("pending") {
        return vec!["Phiếu QC đã quyết định phải được giữ nguyên làm lịch sử".into()];
    }
    if [
        "product",
        "source",
        "source_id",
        "rework_order",
        "qty",
        "warehouse",
        "lot",
        "unit_cost",
        "status",
    ]
    .iter()
    .any(|field| patch.get(*field).is_some())
    {
        return vec!["Sản phẩm, nguồn và kết quả QC chỉ được thiết lập qua luồng kiểm tra".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "inspection_disposition"
        && document
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status != "draft")
    {
        return vec!["Phiếu xử lý đã ghi sổ phải được giữ nguyên làm lịch sử".into()];
    }
    if entity == "inspection"
        && matches!(
            document.get("source").and_then(Value::as_str),
            Some("production_order" | "purchase_order" | "purchase_receipt")
        )
    {
        return vec![
            "Phiếu QC thành phẩm gắn với lệnh sản xuất phải được giữ làm dấu vết kiểm tra".into(),
        ];
    }
    if entity == "inspection" && document.get("status").and_then(Value::as_str) != Some("pending") {
        return vec!["Phiếu QC đã có kết quả phải được giữ làm lịch sử".into()];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "inspection" && matches!(action, "passed" | "failed" | "retest") {
        if document.get("status").and_then(Value::as_str) == Some("passed")
            || (document.get("status").and_then(Value::as_str) == Some("failed")
                && action != "retest")
        {
            return vec![
                "Phiếu QC đã có kết quả; chỉ phiếu trượt mới được gửi kiểm tra lại".into(),
            ];
        }
    }
    Vec::new()
}
