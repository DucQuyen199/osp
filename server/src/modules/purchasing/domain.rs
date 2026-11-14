use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal(value: &Value) -> Option<Decimal> {
    crate::money::decimal(value)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if !matches!(
        entity,
        "rfq" | "purchase_order" | "purchase_requisition" | "purchase_receipt" | "purchase_return"
    ) {
        return Vec::new();
    }
    let Some(value) = document.get("lines") else {
        return Vec::new();
    };
    let Some(lines) = value.as_array() else {
        return vec!["lines must be an array of purchase lines".into()];
    };
    let mut errors = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let prefix = format!("lines[{}]", index + 1);
        if line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
        {
            errors.push(format!(
                "{prefix}.product must be a valid product reference"
            ));
        }
        if !line
            .get("qty")
            .and_then(decimal)
            .is_some_and(|qty| qty > Decimal::ZERO)
        {
            errors.push(format!("{prefix}.qty must be greater than zero"));
        }
        if line.get("price").is_some_and(|value| !value.is_null())
            && !line
                .get("price")
                .and_then(decimal)
                .is_some_and(|price| price >= Decimal::ZERO)
        {
            errors.push(format!("{prefix}.price cannot be negative"));
        }
    }
    if entity == "purchase_return" {
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            for (index, line) in lines.iter().enumerate() {
                if !line
                    .get("price")
                    .and_then(decimal)
                    .is_some_and(|price| price > Decimal::ZERO)
                {
                    errors.push(format!(
                        "lines[{}].price must be greater than zero on a purchase return",
                        index + 1
                    ));
                }
            }
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    let protected: &[&str] = match entity {
        "purchase_receipt" if current.get("status").and_then(Value::as_str) != Some("draft") => {
            &["purchase_order", "warehouse", "lines", "total", "note"]
        }
        "purchase_order"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &[
                "supplier",
                "warehouse",
                "lines",
                "total",
                "expected_date",
                "source",
                "source_id",
            ]
        }
        "purchase_requisition"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &["requested_by", "supplier", "warehouse", "lines", "reason"]
        }
        "purchase_return"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &[
                "purchase_order",
                "inspection",
                "warehouse",
                "lines",
                "total",
                "reason",
            ]
        }
        _ => return Vec::new(),
    };
    if protected.iter().any(|field| patch.get(*field).is_some()) {
        vec!["Submitted purchasing documents cannot change their lines or warehouse".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if !matches!(
        (entity, action),
        ("rfq", "accepted")
            | (
                "purchase_order",
                "submitted" | "approved" | "partially_received" | "received"
            )
            | ("purchase_requisition", "submitted" | "approved")
            | ("purchase_return", "submitted" | "approved" | "dispatched")
            | ("purchase_receipt", "received")
    ) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if entity == "purchase_requisition" && matches!(action, "submitted" | "approved") {
        for field in ["supplier", "warehouse"] {
            if document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_none()
            {
                errors.push("Choose a valid supplier and warehouse before approval".into());
            }
        }
    }
    if entity == "purchase_order"
        && matches!(action, "partially_received" | "received")
        && document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .is_none()
    {
        errors.push("Choose a valid receiving warehouse before receiving the order".into());
    }
    if document
        .get("lines")
        .and_then(Value::as_array)
        .is_none_or(Vec::is_empty)
    {
        errors.push("At least one purchase line is required before processing the document".into());
    }
    if entity == "purchase_order"
        && matches!(
            action,
            "submitted" | "approved" | "partially_received" | "received"
        )
        && !document
            .get("total")
            .and_then(decimal)
            .is_some_and(|total| total > Decimal::ZERO)
    {
        errors.push("Purchase order total must be greater than zero before processing".into());
    }
    if entity == "purchase_return"
        && matches!(action, "submitted" | "approved" | "dispatched")
        && !document
            .get("total")
            .and_then(decimal)
            .is_some_and(|total| total > Decimal::ZERO)
    {
        errors.push("Purchase return total must be greater than zero".into());
    }
    if entity == "purchase_receipt"
        && action == "received"
        && !document
            .get("total")
            .and_then(decimal)
            .is_some_and(|total| total > Decimal::ZERO)
    {
        errors.push("Purchase receipt total must be greater than zero".into());
    }
    if matches!(
        (entity, action),
        ("rfq", "accepted")
            | (
                "purchase_order",
                "submitted" | "approved" | "partially_received" | "received"
            )
            | ("purchase_return", "submitted" | "approved" | "dispatched")
            | ("purchase_receipt", "received")
    ) {
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            for (index, line) in lines.iter().enumerate() {
                if !line
                    .get("price")
                    .and_then(decimal)
                    .is_some_and(|price| price > Decimal::ZERO)
                {
                    errors.push(format!(
                        "lines[{}].price must be positive before document processing",
                        index + 1
                    ));
                }
            }
        }
    }
    errors
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    let status = document
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("draft");
    let protected = match entity {
        "purchase_return" => status != "draft",
        "purchase_receipt" => status != "draft",
        "purchase_requisition" => !matches!(status, "draft" | "rejected"),
        "purchase_order" => {
            !matches!(status, "draft" | "cancelled") || document.get("source").is_some()
        }
        "rfq" => !matches!(status, "draft" | "cancelled"),
        _ => false,
    };
    if protected {
        vec!["Submitted purchasing documents with business activity cannot be removed".into()]
    } else {
        Vec::new()
    }
}
