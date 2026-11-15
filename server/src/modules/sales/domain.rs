use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal(value: &Value) -> Option<Decimal> {
    crate::money::decimal(value)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "price_list" {
        let Some(items) = document.get("items").and_then(Value::as_array) else {
            return vec!["A price list requires product items".into()];
        };
        if items.is_empty() {
            return vec!["A price list requires at least one product".into()];
        }
        let mut errors = Vec::new();
        let mut products = std::collections::HashSet::new();
        for (index, item) in items.iter().enumerate() {
            let product = item
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if product.is_none() {
                errors.push(format!("items[{}].product must be a valid UUID", index + 1));
            } else if !products.insert(product.unwrap()) {
                errors.push(format!(
                    "items[{}].product is duplicated in the price list",
                    index + 1
                ));
            }
            if !item
                .get("price")
                .and_then(decimal)
                .is_some_and(|price| price >= Decimal::ZERO)
            {
                errors.push(format!("items[{}].price must be non-negative", index + 1));
            }
        }
        return errors;
    }
    if entity == "sales_return" {
        let mut errors = validate_lines(document.get("lines"), "lines");
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            for (index, line) in lines.iter().enumerate() {
                if !line
                    .get("price")
                    .and_then(decimal)
                    .is_some_and(|price| price > Decimal::ZERO)
                {
                    errors.push(format!(
                        "lines[{}].price must be greater than zero on a return",
                        index + 1
                    ));
                }
            }
        }
        return errors;
    }
    if !matches!(entity, "quotation" | "sales_order") {
        return Vec::new();
    }
    validate_lines(document.get("lines"), "lines")
}

fn validate_lines(value: Option<&Value>, field: &str) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(lines) = value.as_array() else {
        return vec![format!("{field} must be an array of order lines")];
    };
    let mut errors = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let prefix = format!("{field}[{}]", index + 1);
        if line
            .get("product")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            errors.push(format!("{prefix}.product is required"));
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
        if line.get("discount_pct").is_some_and(|value| {
            !decimal(value).is_some_and(|pct| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&pct))
        }) {
            errors.push(format!("{prefix}.discount_pct must be between 0 and 100"));
        }
        if line.get("tax_rate").is_some_and(|value| {
            !decimal(value)
                .is_some_and(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate))
        }) {
            errors.push(format!("{prefix}.tax_rate must be between 0 and 100"));
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "sales_order"
        && current
            .get("source")
            .and_then(Value::as_str)
            .is_some_and(|source| !source.is_empty())
        && (patch.get("source").is_some() || patch.get("source_id").is_some())
    {
        return vec!["A sales order source and source id are immutable after creation".into()];
    }
    let protected: &[&str] = match entity {
        "quotation"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &[
                "party",
                "warehouse",
                "shipping_address",
                "price_list",
                "lines",
                "total",
                "valid_until",
                "note",
            ]
        }
        "sales_order" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "party",
            "warehouse",
            "price_list",
            "lines",
            "total",
            "order_date",
            "source",
            "source_id",
            "shipping_address",
        ],
        "sales_return"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &["sales_order", "warehouse", "lines", "total", "reason"]
        }
        _ => return Vec::new(),
    };
    if protected.iter().any(|field| patch.get(*field).is_some()) {
        let message = if entity == "quotation" {
            "A sent quotation cannot be edited; update it after rejection"
        } else {
            "A confirmed sales record cannot change its lines or warehouse"
        };
        vec![message.into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "quotation"
            if !matches!(
                document.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            vec!["A sent, accepted, or expired quotation is retained as a sales record".into()]
        }
        "sales_order" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Confirmed or cancelled sales orders are retained as business records".into()]
        }
        "sales_return" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Submitted or processed sales returns are retained as business records".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "quotation" && matches!(action, "sent" | "accepted") {
        if let Some(value) = document.get("valid_until").and_then(Value::as_str) {
            let Some(valid_until) = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok() else {
                return vec!["Quotation valid_until must be a valid calendar date".into()];
            };
            if valid_until < Utc::now().date_naive() {
                return vec!["An expired quotation cannot be sent or accepted".into()];
            }
        }
    }
    if entity == "quotation" && action == "expired" {
        let Some(valid_until) = document
            .get("valid_until")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            return vec!["A quotation needs a valid_until date before it can expire".into()];
        };
        if valid_until < Utc::now().date_naive() {
            return Vec::new();
        }
        return vec!["A quotation can expire only after its valid_until date".into()];
    }
    if entity == "sales_return" && matches!(action, "submitted" | "approved" | "received") {
        let mut errors = Vec::new();
        if document
            .get("lines")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
        {
            errors.push("A return requires at least one line".into());
        }
        if !document
            .get("total")
            .and_then(decimal)
            .is_some_and(|total| total > Decimal::ZERO)
        {
            errors.push("Return total must be greater than zero".into());
        }
        return errors;
    }
    if !matches!(
        (entity, action),
        ("quotation", "sent" | "accepted") | ("sales_order", "confirmed")
    ) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if entity == "sales_order"
        && document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
    {
        errors.push("Select a warehouse before confirming the sales order".into());
    }
    if document
        .get("lines")
        .and_then(Value::as_array)
        .is_none_or(Vec::is_empty)
    {
        errors.push("At least one sales line is required before acceptance or confirmation".into());
    }
    if !document
        .get("total")
        .and_then(decimal)
        .is_some_and(|total| total > Decimal::ZERO)
    {
        errors
            .push("Sales total must be greater than zero before acceptance or confirmation".into());
    }
    if entity == "sales_order" {
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            for (index, line) in lines.iter().enumerate() {
                if !line
                    .get("price")
                    .and_then(decimal)
                    .is_some_and(|price| price >= Decimal::ZERO)
                {
                    errors.push(format!(
                        "lines[{}].price must be non-negative before order confirmation",
                        index + 1
                    ));
                }
            }
        }
    }
    if entity == "quotation" {
        if let Some(valid_until) = document.get("valid_until").and_then(Value::as_str) {
            if NaiveDate::parse_from_str(valid_until, "%Y-%m-%d")
                .is_ok_and(|date| date < Utc::now().date_naive())
            {
                errors.push(
                    "The quotation has expired; update its validity date before acceptance".into(),
                );
            }
        }
    }
    errors
}
