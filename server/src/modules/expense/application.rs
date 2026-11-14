//! Expense claim application rules shared by create, update, and submit flows.
use crate::money;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};

/// Recalculate the claim total from its item amounts before the record is
/// validated or used by accounting. The system-managed total is never accepted
/// from the client.
pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    if entity != "expense_claim" {
        return Vec::new();
    }
    if document
        .get("payment_method")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        document.insert("payment_method".into(), json!("cash"));
    }
    let Some(items) = document.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut total = Decimal::ZERO;
    let mut normalized_items = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(amount) = item.get("amount").and_then(money::decimal) else {
            return vec![format!("items[{}] requires a numeric amount", index + 1)];
        };
        if amount < Decimal::ZERO {
            return vec![format!("items[{}] amount cannot be negative", index + 1)];
        }
        let Some(next_total) = total.checked_add(money::round_money(amount)) else {
            return vec![format!(
                "items[{}] makes the claim total overflow",
                index + 1
            )];
        };
        total = next_total;
        let Some(mut line) = item.as_object().cloned() else {
            normalized_items.push(item.clone());
            continue;
        };
        let code = line
            .get("account_code")
            .and_then(Value::as_str)
            .filter(|code| !code.trim().is_empty())
            .unwrap_or("642")
            .trim()
            .to_ascii_uppercase();
        line.insert("account_code".into(), Value::String(code));
        normalized_items.push(Value::Object(line));
    }
    let Some(total) = money::json_number(total) else {
        return vec!["Expense claim total cannot be serialized".into()];
    };
    document.insert("total".into(), total);
    document.insert("items".into(), Value::Array(normalized_items));
    Vec::new()
}
