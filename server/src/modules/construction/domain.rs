//! Pure estimate, contract, and site-diary policies.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

fn positive(document: &Value, field: &str) -> bool {
    document
        .get(field)
        .and_then(money::decimal)
        .is_some_and(|value| value > Decimal::ZERO)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "boq" => {
            if !document
                .get("revision")
                .and_then(money::decimal)
                .is_some_and(|revision| {
                    revision >= Decimal::ONE
                        && revision.fract() == Decimal::ZERO
                        && revision <= Decimal::from(1000)
                })
            {
                errors.push("Sá»‘ phiÃªn báº£n BOQ pháº£i lÃ  sá»‘ nguyÃªn dÆ°Æ¡ng".into());
            }
            let Some(items) = document.get("items").and_then(Value::as_array) else {
                return vec!["BOQ cần danh sách hạng mục".into()];
            };
            if items.is_empty() {
                errors.push("BOQ cần ít nhất một hạng mục".into());
            }
            for (index, item) in items.iter().enumerate() {
                let label = format!("Hạng mục BOQ [{}]", index + 1);
                if item
                    .get("description")
                    .and_then(Value::as_str)
                    .is_none_or(|text| text.trim().is_empty())
                {
                    errors.push(format!("{label} cần mô tả"));
                }
                if item
                    .get("unit")
                    .and_then(Value::as_str)
                    .is_none_or(|unit| unit.trim().is_empty())
                {
                    errors.push(format!("{label} cần đơn vị đo"));
                } else if item
                    .get("unit")
                    .and_then(Value::as_str)
                    .is_some_and(|unit| unit.trim().chars().count() > 32)
                {
                    errors.push(format!("{label} có đơn vị đo vượt quá 32 ký tự"));
                }
                if !item
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::ZERO)
                {
                    errors.push(format!("{label} cần số lượng lớn hơn 0"));
                }
                if !item
                    .get("unit_price")
                    .and_then(money::decimal)
                    .is_some_and(|price| price >= Decimal::ZERO)
                {
                    errors.push(format!("{label} cần đơn giá không âm"));
                }
            }
        }
        "site" => {
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Công trường cần có tên".into());
            }
        }
        "subcontract" => {
            if !positive(document, "value") {
                errors.push("Giá trị hợp đồng thầu phụ phải lớn hơn 0".into());
            }
        }
        "progress_claim" => {
            if !positive(document, "amount") {
                errors.push("Giá trị nghiệm thu phải lớn hơn 0".into());
            }
            if document
                .get("period")
                .and_then(Value::as_str)
                .filter(|date| date.len() == 10)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .is_none_or(|date| date > chrono::Utc::now().date_naive())
            {
                errors.push("Kỳ nghiệm thu cần là ngày hợp lệ, không nằm trong tương lai".into());
            }
        }
        "site_diary" => {
            let date = document.get("date").and_then(Value::as_str);
            if date
                .filter(|date| date.len() == 10)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .is_none_or(|date| date > chrono::Utc::now().date_naive())
            {
                errors.push("Nhật ký cần ngày hợp lệ, không nằm trong tương lai".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "boq" && action == "approved" {
        let revision = document
            .get("revision")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ONE);
        if revision > Decimal::ONE
            && document
                .get("revision_reason")
                .and_then(Value::as_str)
                .is_none_or(|reason| reason.trim().is_empty())
        {
            return vec![
                "PhiÃªn báº£n BOQ Ä‘iá»u chá»‰nh cáº§n nÃªu lÃ½ do trÆ°á»›c khi duyá»‡t".into(),
            ];
        }
    }
    if entity == "subcontract" && action == "signed" && !positive(document, "value") {
        return vec!["Chỉ ký hợp đồng thầu phụ có giá trị lớn hơn 0".into()];
    }
    if entity == "progress_claim" && action == "approved" && !positive(document, "amount") {
        return vec!["Chỉ duyệt hồ sơ nghiệm thu có giá trị lớn hơn 0".into()];
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if !patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        return Vec::new();
    }
    if entity == "boq" {
        if patch.get("status").is_some() {
            return vec![
                "Tráº¡ng thÃ¡i BOQ chá»‰ Ä‘Æ°á»£c thay Ä‘á»•i qua thao tÃ¡c quy trÃ¬nh".into(),
            ];
        }
        if ["project", "revision", "supersedes"]
            .iter()
            .any(|field| patch.get(*field).is_some())
        {
            return vec!["CÃ´ng trÃ¬nh, sá»‘ phiÃªn báº£n vÃ  BOQ gá»‘c khÃ´ng thá»ƒ Ä‘á»•i sau khi táº¡o báº£n nhÃ¡p".into()];
        }
        if current.get("status").and_then(Value::as_str) != Some("draft") {
            return vec![
                "BOQ Ä‘Ã£ duyá»‡t khÃ´ng Ä‘Æ°á»£c sá»­a; hÃ£y táº¡o phiÃªn báº£n Ä‘iá»u chá»‰nh"
                    .into(),
            ];
        }
        return Vec::new();
    }
    if entity == "site_diary" {
        return vec!["Nhật ký công trường đã ghi nhận không thể sửa".into()];
    }
    if entity == "subcontract" && current.get("status").and_then(Value::as_str) != Some("draft") {
        return vec!["Hợp đồng thầu phụ đã ký không thể sửa điều khoản".into()];
    }
    if entity == "progress_claim" && current.get("status").and_then(Value::as_str) != Some("draft")
    {
        return vec!["Hồ sơ nghiệm thu đã duyệt không thể sửa".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match (entity, document.get("status").and_then(Value::as_str)) {
        ("boq", Some("approved" | "superseded")) => {
            vec!["BOQ Ä‘Ã£ duyá»‡t pháº£i Ä‘Æ°á»£c giá»¯ lÃ m lá»‹ch sá»­ phiÃªn báº£n".into()]
        }
        ("site_diary", _) => vec!["Nhật ký công trường không thể xóa khỏi lịch sử".into()],
        ("subcontract", Some("signed" | "completed")) => {
            vec!["Hợp đồng thầu phụ đã ký không thể xóa khỏi lịch sử".into()]
        }
        ("progress_claim", Some("approved")) => {
            vec!["Hồ sơ nghiệm thu đã duyệt không thể xóa khỏi lịch sử".into()]
        }
        _ => Vec::new(),
    }
}
