use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal(value: &Value) -> Option<Decimal> {
    money::decimal(value)
}

pub fn validate_source_action(qname: &str, action: &str, document: &Value) -> Vec<String> {
    let key = match (qname, action) {
        ("field-service.work_order", "done") | ("auto-service.repair_order", "completed") => {
            "lines"
        }
        ("restaurant.table_order", "completed") => "consumptions",
        ("maintenance.maintenance_request", "done") => "parts",
        ("clinic.prescription", "dispensed") => "items",
        _ => return Vec::new(),
    };
    let has_stock_items = document
        .get(key)
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|line| {
                line.get("tracked") == Some(&Value::Bool(true))
                    && line.get("product").and_then(Value::as_str).is_some()
            })
        });
    if has_stock_items
        && document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
    {
        vec!["Cần chọn kho hợp lệ trước khi hoàn tất nghiệp vụ có xuất kho".into()]
    } else {
        Vec::new()
    }
}

fn validate_lines(lines: &[Value], field: &str, count_mode: bool) -> Vec<String> {
    let mut errors = Vec::new();
    if lines.is_empty() {
        errors.push(format!("{field} phải có ít nhất một dòng"));
        return errors;
    }
    for (index, line) in lines.iter().enumerate() {
        let prefix = format!("{field}[{}]", index + 1);
        let product = line.get("product").and_then(Value::as_str);
        if product.is_none_or(str::is_empty) {
            errors.push(format!("{prefix}.product là bắt buộc"));
        }
        let qty = line.get("qty").and_then(decimal);
        if !qty.is_some_and(|n| n > Decimal::ZERO) {
            errors.push(format!("{prefix}.qty phải lớn hơn 0"));
        }
        if count_mode
            && !matches!(
                line.get("direction").and_then(Value::as_str),
                Some("in" | "out")
            )
        {
            errors.push(format!("{prefix}.direction phải là in hoặc out"));
        }
    }
    errors
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "stock_move" => {
            if let Some(qty) = document.get("qty") {
                if !decimal(qty).is_some_and(|n| n > Decimal::ZERO) {
                    errors.push("qty phải lớn hơn 0".into());
                }
            }
        }
        "stock_level" => {
            if document
                .get("held_qty")
                .is_some_and(|held| !decimal(held).is_some_and(|qty| qty >= Decimal::ZERO))
            {
                errors.push("held_qty phải là số không âm".into());
            }
        }
        "reorder_rule" => {
            let minimum = document.get("minimum_qty").and_then(decimal);
            let target = document.get("target_qty").and_then(decimal);
            if !minimum.is_some_and(|qty| qty >= Decimal::ZERO) {
                errors.push("minimum_qty phải là số hữu hạn không âm".into());
            }
            if !target.is_some_and(|qty| qty > Decimal::ZERO) {
                errors.push("target_qty phải là số hữu hạn lớn hơn 0".into());
            }
            if minimum
                .zip(target)
                .is_some_and(|(minimum, target)| target < minimum)
            {
                errors.push("target_qty phải lớn hơn hoặc bằng minimum_qty".into());
            }
        }
        "stock_transfer" => {
            if let (Some(from), Some(to)) = (
                document.get("from_warehouse").and_then(Value::as_str),
                document.get("to_warehouse").and_then(Value::as_str),
            ) {
                if from == to {
                    errors.push("Kho nguồn và kho đích phải khác nhau".into());
                }
            }
            if let Some(value) = document.get("lines") {
                if let Some(rows) = value.as_array() {
                    errors.extend(validate_lines(rows, "lines", false));
                } else {
                    errors.push("lines phải là danh sách dòng hàng".into());
                }
            }
        }
        "stock_count" => {
            if let Some(value) = document.get("adjustment_lines") {
                if let Some(rows) = value.as_array() {
                    if !rows.is_empty() {
                        let mut counted_products = std::collections::HashSet::new();
                        for (index, line) in rows.iter().enumerate() {
                            let prefix = format!("adjustment_lines[{}]", index + 1);
                            let product = line.get("product").and_then(Value::as_str);
                            if product.is_none_or(str::is_empty) {
                                errors.push(format!("{prefix}.product là bắt buộc"));
                            }
                            if let Some(counted) = line.get("counted_qty") {
                                if !decimal(counted).is_some_and(|qty| qty >= Decimal::ZERO) {
                                    errors.push(format!(
                                        "{prefix}.counted_qty phải là số hữu hạn không âm"
                                    ));
                                }
                                if let Some(product) = product
                                    && !counted_products.insert((
                                        product,
                                        line.get("lot").and_then(Value::as_str),
                                        line.get("location").and_then(Value::as_str),
                                    ))
                                {
                                    errors.push(format!(
                                        "Sản phẩm {product} chỉ được đếm một lần trong một phiếu"
                                    ));
                                }
                            } else {
                                // Legacy adjustment rows remain readable and can finish their existing approval flow.
                                errors.extend(validate_lines(
                                    std::slice::from_ref(line),
                                    &prefix,
                                    true,
                                ));
                            }
                        }
                    }
                } else {
                    errors.push("adjustment_lines phải là danh sách dòng điều chỉnh".into());
                }
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    let (protected, message): (&[&str], &str) = match entity {
        "stock_move" | "stock_level" => (
            &["*"],
            "Sổ biến động và số tồn chỉ được thay đổi qua nghiệp vụ kho",
        ),
        "stock_transfer" if current.get("status").and_then(Value::as_str) != Some("draft") => (
            &["from_warehouse", "to_warehouse", "lines", "reference"],
            "Điều chuyển đã xuất kho không thể đổi kho nguồn, kho đích hoặc dòng hàng",
        ),
        "stock_count"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            (
                &["warehouse", "adjustment_lines", "reason"],
                "Phiếu kiểm kê đã gửi không thể đổi kho hoặc dòng điều chỉnh",
            )
        }
        _ => return Vec::new(),
    };
    if protected.contains(&"*") || protected.iter().any(|field| patch.get(*field).is_some()) {
        vec![message.into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    if matches!(entity, "stock_move" | "stock_level") {
        vec!["Stock movements and balances cannot be deleted directly; create an adjustment document".into()]
    } else if entity == "stock_count"
        && matches!(
            document.get("status").and_then(Value::as_str),
            Some("submitted" | "approved")
        )
    {
        vec!["Submitted or approved stock counts are retained as warehouse audit evidence".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("stock_transfer", "dispatched") => {
            let Some(lines) = document.get("lines").and_then(Value::as_array) else {
                return vec!["A stock transfer needs at least one line before dispatch".into()];
            };
            validate_lines(lines, "lines", false)
        }
        ("stock_count", "submitted" | "approved") => {
            let Some(lines) = document.get("adjustment_lines").and_then(Value::as_array) else {
                return vec!["A stock count needs physical-count lines before submission".into()];
            };
            if lines.is_empty() {
                return vec!["A stock count needs at least one physical-count line".into()];
            }
            let mut errors = Vec::new();
            let mut counted_products = std::collections::HashSet::new();
            for (index, line) in lines.iter().enumerate() {
                let prefix = format!("adjustment_lines[{}]", index + 1);
                let product = line.get("product").and_then(Value::as_str);
                if product.is_none_or(str::is_empty) {
                    errors.push(format!("{prefix}.product is required"));
                }
                if let Some(counted) = line.get("counted_qty") {
                    if !decimal(counted).is_some_and(|qty| qty >= Decimal::ZERO) {
                        errors.push(format!(
                            "{prefix}.counted_qty must be a finite nonnegative number"
                        ));
                    }
                    if let Some(product) = product
                        && !counted_products.insert((
                            product,
                            line.get("lot").and_then(Value::as_str),
                            line.get("location").and_then(Value::as_str),
                        ))
                    {
                        errors.push(format!(
                            "Product {product} can only be counted once per document"
                        ));
                    }
                    if action == "approved"
                        && (line.get("expected_qty").and_then(decimal).is_none()
                            || line.get("variance_qty").and_then(decimal).is_none())
                    {
                        errors.push(format!("{prefix} is missing the submitted stock snapshot"));
                    }
                } else {
                    // Legacy adjustment rows can complete an approval already in progress.
                    errors.extend(validate_lines(std::slice::from_ref(line), &prefix, true));
                }
            }
            errors
        }
        _ => Vec::new(),
    }
}
