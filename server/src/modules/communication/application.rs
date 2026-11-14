use crate::{
    db::Tx,
    error::R,
    kernel::{Kernel, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

use super::{domain, persistence};

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("communication") {
        return Ok(false);
    }
    let message = if event_type == "purchasing.rfq.sent" {
        supplier_rfq_message(tx, tenant, document).await?
    } else if event_type == "sales.quotation.sent" {
        customer_quotation_message(tx, tenant, document).await?
    } else {
        domain::message_for(event_type, document)
    };
    let Some(message) = message else {
        return Ok(false);
    };
    persistence::enqueue_message(kernel, tx, tenant, message, event_id, depth).await?;
    Ok(true)
}

async fn supplier_rfq_message(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Option<serde_json::Map<String, Value>>> {
    let Some(recipient) = document.get("supplier").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return Ok(None);
    };

    let mut requested_items = Vec::with_capacity(lines.len());
    for line in lines {
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let row = tx
            .query_opt(
                "SELECT sku, name FROM master_data__product WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &product_id],
            )
            .await?;
        let label = row
            .map(|row| {
                let sku: Option<String> = row.get(0);
                let name: String = row.get(1);
                sku.filter(|sku| !sku.trim().is_empty())
                    .map(|sku| format!("{sku} — {name}"))
                    .unwrap_or(name)
            })
            .unwrap_or_else(|| "Requested item".to_owned());
        let quantity = line
            .get("qty")
            .or_else(|| line.get("quantity"))
            .map(Value::to_string)
            .unwrap_or_else(|| "unspecified quantity".to_owned());
        requested_items.push(format!("• {label}: {quantity}"));
    }

    let reference = document
        .get("number")
        .or_else(|| document.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("RFQ");
    let response_due = document
        .get("response_due")
        .and_then(Value::as_str)
        .map(|value| format!("Please respond by {value}.\n"))
        .unwrap_or_default();
    let request = requested_items.join("\n");
    let mut message = serde_json::Map::new();
    message.insert("channel".into(), serde_json::json!("email"));
    message.insert("recipient".into(), recipient.clone());
    message.insert(
        "subject".into(),
        serde_json::json!(format!(
            "Request for quotation {reference} — {}",
            tenant.name
        )),
    );
    message.insert(
        "body".into(),
        serde_json::json!(format!(
            "{} is requesting a quotation for RFQ {reference}.\n\nRequested items:\n{}\n\n{}Please provide unit prices, applicable taxes, lead time, and quotation validity.",
            tenant.name,
            if request.is_empty() { "See the attached or linked request details." } else { &request },
            response_due
        )),
    );
    Ok(Some(message))
}

async fn customer_quotation_message(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Option<serde_json::Map<String, Value>>> {
    let Some(recipient) = document.get("party").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return Ok(None);
    };

    let currency = tenant.setting_str("baseCurrency").unwrap_or("");
    let currency_suffix = if currency.is_empty() {
        String::new()
    } else {
        format!(" {currency}")
    };
    let mut quoted_items = Vec::with_capacity(lines.len());
    for line in lines {
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let product = tx
            .query_opt(
                "SELECT sku, name FROM master_data__product WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &product_id],
            )
            .await?;
        let product_name = product
            .map(|row| {
                let sku: Option<String> = row.get(0);
                let name: String = row.get(1);
                sku.filter(|sku| !sku.trim().is_empty())
                    .map(|sku| format!("{sku} — {name}"))
                    .unwrap_or(name)
            })
            .unwrap_or_else(|| "Quoted item".to_owned());
        let quantity = line
            .get("qty")
            .map(Value::to_string)
            .unwrap_or_else(|| "0".to_owned());
        let unit_price = line
            .get("price")
            .map(Value::to_string)
            .unwrap_or_else(|| "0".to_owned());
        let tax = line
            .get("tax_name")
            .and_then(Value::as_str)
            .map(|name| format!(" (tax: {name})"))
            .unwrap_or_default();
        let line_total = line
            .get("line_total")
            .map(Value::to_string)
            .unwrap_or_else(|| "0".to_owned());
        quoted_items.push(format!(
            "- {product_name}: {quantity} × {unit_price}{currency_suffix}{tax}; line total {line_total}{currency_suffix}"
        ));
    }

    let reference = document
        .get("number")
        .or_else(|| document.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("quotation");
    let validity = document
        .get("valid_until")
        .and_then(Value::as_str)
        .map(|date| format!("This quotation is valid through {date}.\n"))
        .unwrap_or_default();
    let delivery = document
        .get("shipping_address")
        .and_then(Value::as_str)
        .filter(|address| !address.trim().is_empty())
        .map(|address| format!("Delivery address: {address}\n"))
        .unwrap_or_default();
    let total = document
        .get("total")
        .map(Value::to_string)
        .unwrap_or_else(|| "0".to_owned());
    let tax_total = document
        .get("tax_total")
        .map(Value::to_string)
        .unwrap_or_else(|| "0".to_owned());
    let quote = if quoted_items.is_empty() {
        "Please review the quotation details in your customer portal.".to_owned()
    } else {
        quoted_items.join("\n")
    };

    let mut message = serde_json::Map::new();
    message.insert("channel".into(), serde_json::json!("email"));
    message.insert("recipient".into(), recipient.clone());
    message.insert(
        "subject".into(),
        serde_json::json!(format!("Quotation {reference} from {}", tenant.name)),
    );
    message.insert(
        "body".into(),
        serde_json::json!(format!(
            "{} is pleased to provide quotation {reference}.\n\nQuoted items:\n{}\n\nTax: {tax_total}{currency_suffix}\nQuotation total including tax: {total}{currency_suffix}\n{}{}Please contact us if you have questions or would like to accept this quotation.",
            tenant.name, quote, validity, delivery
        )),
    );
    Ok(Some(message))
}
