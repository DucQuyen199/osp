use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal(value: &Value) -> Option<Decimal> {
    crate::money::decimal(value)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if !matches!(
        entity,
        "rfq"
            | "purchase_order"
            | "purchase_requisition"
            | "purchase_receipt"
            | "purchase_return"
            | "supplier_invoice"
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
    if entity == "rfq"
        && document
            .get("quote_lines")
            .and_then(Value::as_array)
            .is_some_and(|lines| !lines.is_empty())
    {
        errors.extend(validate_quote_lines(document));
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

fn validate_quote_lines(document: &Value) -> Vec<String> {
    let Some(requested) = document.get("lines").and_then(Value::as_array) else {
        return vec!["RFQ must contain requested lines before a supplier quote is entered".into()];
    };
    let Some(quotes) = document.get("quote_lines").and_then(Value::as_array) else {
        return vec!["Supplier quote lines must be an array".into()];
    };
    if requested.is_empty() || requested.len() != quotes.len() {
        return vec!["Supplier quote must cover every requested line exactly once".into()];
    }
    let mut errors = Vec::new();
    for (index, (request, quote)) in requested.iter().zip(quotes).enumerate() {
        let prefix = format!("quote_lines[{}]", index + 1);
        let same_product = request.get("product").and_then(Value::as_str)
            == quote.get("product").and_then(Value::as_str);
        let same_qty = request.get("qty").and_then(decimal) == quote.get("qty").and_then(decimal);
        if !same_product || !same_qty {
            errors.push(format!(
                "{prefix} must keep the requested product and quantity"
            ));
        }
        if !quote
            .get("price")
            .and_then(decimal)
            .is_some_and(|price| price > Decimal::ZERO)
        {
            errors.push(format!("{prefix}.price must be greater than zero"));
        }
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    let protected: &[&str] = match entity {
        "purchase_return" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "purchase_order",
            "supplier_invoice",
            "inspection",
            "department",
            "warehouse",
            "lines",
            "total",
            "tax_total",
            "reason",
        ],
        "purchase_receipt" if current.get("status").and_then(Value::as_str) != Some("draft") => {
            &["purchase_order", "warehouse", "lines", "total", "note"]
        }
        "supplier_invoice"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &[
                "purchase_order",
                "supplier",
                "department",
                "invoice_number",
                "issue_date",
                "due_date",
                "total",
                "tax_total",
                "adjustments",
                "lines",
            ]
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
            &[
                "requested_by",
                "supplier",
                "sourcing_method",
                "warehouse",
                "lines",
                "reason",
            ]
        }
        "rfq" if current.get("status").and_then(Value::as_str) == Some("sent") => &[
            "supplier",
            "purchase_requisition",
            "warehouse",
            "department",
            "lines",
            "note",
            "response_due",
        ],
        "rfq" if current.get("status").and_then(Value::as_str) != Some("draft") => &["*"],
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
    if protected.contains(&"*") || protected.iter().any(|field| patch.get(*field).is_some()) {
        vec!["Submitted purchasing documents cannot change their lines or warehouse".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if !matches!(
        (entity, action),
        ("rfq", "sent" | "quoted" | "accepted")
            | (
                "purchase_order",
                "submitted" | "approved" | "partially_received" | "received"
            )
            | ("purchase_requisition", "submitted" | "approved")
            | ("purchase_return", "submitted" | "approved" | "dispatched")
            | ("purchase_receipt", "received")
            | ("supplier_invoice", "submitted" | "approved")
    ) {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if entity == "rfq"
        && action == "sent"
        && document
            .get("response_due")
            .and_then(Value::as_str)
            .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
            .is_some_and(|due| due < chrono::Utc::now().date_naive())
    {
        errors.push("RFQ response deadline cannot be in the past".into());
    }
    if entity == "purchase_requisition" && matches!(action, "submitted" | "approved") {
        for field in ["warehouse"] {
            if document
                .get(field)
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_none()
            {
                errors.push("Choose a valid supplier and warehouse before approval".into());
            }
        }
        if document.get("sourcing_method").and_then(Value::as_str) != Some("competitive")
            && document
                .get("supplier")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_none()
        {
            errors.push("Choose a supplier for a direct purchase requisition".into());
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
    if entity == "supplier_invoice" && matches!(action, "submitted" | "approved") {
        if document
            .get("invoice_number")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty())
        {
            errors.push("Supplier invoice number is required".into());
        }
        let issue = document
            .get("issue_date")
            .and_then(Value::as_str)
            .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
        if issue.is_none() {
            errors.push("Supplier invoice needs a valid issue date".into());
        } else if issue.is_some_and(|date| date > chrono::Utc::now().date_naive()) {
            errors.push("Supplier invoice issue date cannot be in the future".into());
        }
        if document
            .get("due_date")
            .and_then(Value::as_str)
            .is_some_and(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err())
        {
            errors.push("Supplier invoice due date must be a valid date".into());
        }
        if let (Some(issue), Some(due)) = (
            issue,
            document
                .get("due_date")
                .and_then(Value::as_str)
                .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()),
        ) && due < issue
        {
            errors.push("Supplier invoice due date cannot precede its issue date".into());
        }
        if !document
            .get("total")
            .and_then(decimal)
            .is_some_and(|value| value > Decimal::ZERO)
        {
            errors.push("Supplier invoice total must be greater than zero".into());
        }
        if document
            .get("tax_total")
            .and_then(decimal)
            .is_some_and(|value| value < Decimal::ZERO)
        {
            errors.push("Supplier invoice tax cannot be negative".into());
        }
    }
    if entity == "rfq" && matches!(action, "quoted" | "accepted") {
        errors.extend(validate_quote_lines(document));
    }
    if matches!(
        (entity, action),
        (
            "purchase_order",
            "submitted" | "approved" | "partially_received" | "received"
        ) | ("purchase_return", "submitted" | "approved" | "dispatched")
            | ("purchase_receipt", "received")
    ) {
        let lines_field = if entity == "rfq" {
            "quote_lines"
        } else {
            "lines"
        };
        if let Some(lines) = document.get(lines_field).and_then(Value::as_array) {
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
        "supplier_invoice" => status != "draft",
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
