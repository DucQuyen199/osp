//! Pure manufacturing rules and lifecycle policies.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

fn decimal(value: &Value) -> Option<Decimal> {
    money::decimal(value)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "bom" => {
            if !document
                .get("output_qty")
                .and_then(decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Sản lượng định mức phải lớn hơn 0".into());
            }
            let components = document.get("components").and_then(Value::as_array);
            if components.is_none_or(|rows| rows.is_empty()) {
                errors.push("Định mức BOM cần ít nhất một dòng nguyên liệu".into());
            } else if let Some(rows) = components {
                for (index, component) in rows.iter().enumerate() {
                    let prefix = format!("components[{}]", index + 1);
                    if component
                        .get("product")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                    {
                        errors.push(format!("{prefix}.product là bắt buộc"));
                    }
                    if !component
                        .get("qty")
                        .and_then(decimal)
                        .is_some_and(|qty| qty > Decimal::ZERO)
                    {
                        errors.push(format!("{prefix}.qty phải lớn hơn 0"));
                    }
                }
            }
        }
        "production_order" => {
            if !document
                .get("qty")
                .and_then(decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Số lượng sản xuất phải lớn hơn 0".into());
            }
            if document.get("good_qty").is_some()
                && !document
                    .get("good_qty")
                    .and_then(decimal)
                    .is_some_and(|qty| qty >= Decimal::ZERO)
            {
                errors.push("good_qty must be non-negative".into());
            }
            if document.get("scrap_qty").is_some()
                && !document
                    .get("scrap_qty")
                    .and_then(decimal)
                    .is_some_and(|qty| qty >= Decimal::ZERO)
            {
                errors.push("scrap_qty must be non-negative".into());
            }
            if document
                .get("work_center")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
                && document
                    .get("planned_start")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
            {
                errors
                    .push("A planned start date is required when a work center is assigned".into());
            }
        }
        "rework_order" => {
            if !document
                .get("qty")
                .and_then(decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Rework quantity must be positive".into());
            }
            if document
                .get("reason")
                .and_then(Value::as_str)
                .is_none_or(|reason| reason.trim().is_empty())
            {
                errors.push("A reason is required for production rework".into());
            }
        }
        "production_disposition" => {
            if !document
                .get("qty")
                .and_then(decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Số lượng loại bỏ phải lớn hơn 0".into());
            }
            if document
                .get("note")
                .and_then(Value::as_str)
                .is_none_or(|note| note.trim().len() < 5)
            {
                errors.push("Lý do loại bỏ cần ít nhất 5 ký tự".into());
            }
        }
        "conditional_acceptance" => {
            if !document
                .get("qty")
                .and_then(decimal)
                .is_some_and(|qty| qty > Decimal::ZERO)
            {
                errors.push("Số lượng chấp nhận có điều kiện phải lớn hơn 0".into());
            }
            if document
                .get("condition")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().len() < 5)
            {
                errors.push("Điều kiện chấp nhận cần ít nhất 5 ký tự".into());
            }
            if document
                .get("justification")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().len() < 5)
            {
                errors.push("Căn cứ chấp nhận cần ít nhất 5 ký tự".into());
            }
        }
        "work_center" => {
            if document
                .get("capacity_per_day")
                .is_some_and(|value| !value.is_null())
                && !document
                    .get("capacity_per_day")
                    .and_then(decimal)
                    .is_some_and(|capacity| capacity > Decimal::ZERO)
            {
                errors.push("Work-center daily capacity must be positive when specified".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "conditional_acceptance"
        && !matches!(
            current.get("status").and_then(Value::as_str),
            Some("draft" | "rejected")
        )
        && ["inspection", "qty", "condition", "justification"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Submitted or approved conditional acceptances are immutable".into()];
    }
    if entity == "rework_order"
        && current.get("status").and_then(Value::as_str) != Some("planned")
        && ["production_order", "inspection", "qty", "reason"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Started rework orders are immutable".into()];
    }
    if entity == "production_disposition"
        && current.get("status").and_then(Value::as_str) != Some("draft")
        && ["inspection", "qty", "note", "expense_account"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Posted production dispositions are immutable".into()];
    }
    if entity == "production_order"
        && current.get("status").and_then(Value::as_str) == Some("planned")
        && ["good_qty", "scrap_qty", "scrap_reason"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Record good and scrap quantities only after starting production".into()];
    }
    if entity == "production_order"
        && current.get("status").and_then(Value::as_str) != Some("planned")
        && [
            "product",
            "qty",
            "bom",
            "warehouse",
            "work_center",
            "planned_start",
            "output_lot_code",
            "output_expiry",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some())
    {
        return vec!["Không sửa sản phẩm, số lượng, BOM hoặc kho sau khi lệnh đã bắt đầu".into()];
    }
    if entity == "production_order" && current.get("status").and_then(Value::as_str) == Some("done")
    {
        return vec!["Lệnh sản xuất đã hoàn tất không được sửa".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if entity == "conditional_acceptance"
        && !matches!(
            document.get("status").and_then(Value::as_str),
            Some("draft" | "rejected" | "cancelled")
        )
    {
        return vec![
            "Submitted or approved conditional acceptances must remain in the quality history"
                .into(),
        ];
    }
    if entity == "production_disposition"
        && document.get("status").and_then(Value::as_str) != Some("draft")
    {
        return vec!["Posted production dispositions must be kept as accounting history".into()];
    }
    if entity == "rework_order" && document.get("status").and_then(Value::as_str) != Some("planned")
    {
        return vec!["Started rework orders must be kept as production history".into()];
    }
    if entity == "production_order"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("in_progress" | "done" | "cancelled")
        )
    {
        return vec![
            "Lệnh sản xuất đã bắt đầu, hoàn tất hoặc hủy phải được giữ làm lịch sử".into(),
        ];
    }
    Vec::new()
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "production_order" && action == "done" {
        let planned = document.get("qty").and_then(decimal).unwrap_or_default();
        let good = document
            .get("good_qty")
            .and_then(decimal)
            .unwrap_or_default();
        let scrap = document
            .get("scrap_qty")
            .and_then(decimal)
            .unwrap_or_default();
        let mut errors = Vec::new();
        if good < Decimal::ZERO
            || scrap < Decimal::ZERO
            || good
                .checked_add(scrap)
                .is_none_or(|total| !money::within_tolerance(total, planned, Decimal::new(1, 4)))
        {
            errors.push("Good output plus scrap quantity must equal planned production".into());
        }
        let scrap_method = document
            .get("scrap_cost_method")
            .and_then(Value::as_str)
            .unwrap_or("absorb");
        if good.is_zero() && scrap_method != "expense" {
            errors.push("A batch with no accepted output must expense the full scrap cost".into());
        }
        if scrap > Decimal::ZERO
            && document
                .get("scrap_reason")
                .and_then(Value::as_str)
                .is_none_or(|reason| reason.trim().is_empty())
        {
            errors.push("A reason is required when production scrap is recorded".into());
        }
        if let Some(expiry) = document.get("output_expiry").and_then(Value::as_str) {
            match chrono::NaiveDate::parse_from_str(expiry, "%Y-%m-%d") {
                Ok(expiry) if expiry >= chrono::Utc::now().date_naive() => {}
                _ => errors
                    .push("Ngày hết hạn thành phẩm phải là ngày hợp lệ trong tương lai".into()),
            }
        }
        match scrap_method {
            "absorb" => {}
            "expense" => {
                if scrap <= Decimal::ZERO {
                    errors.push("Abnormal scrap expense requires a positive scrap quantity".into());
                }
                if document
                    .get("scrap_expense_account")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                {
                    errors.push("Select an expense account for abnormal scrap".into());
                }
            }
            _ => errors.push("Scrap cost method must be absorb or expense".into()),
        }
        return errors;
    }
    Vec::new()
}
