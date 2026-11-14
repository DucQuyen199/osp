//! Normalize vehicle identity and repair-order text before persistence.
use crate::money;
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    let fields: &[&str] = match entity {
        "vehicle" => &["plate", "vin", "make", "model"],
        "repair_order" => &["complaint"],
        _ => &[],
    };
    for field in fields {
        if let Some(value) = document.get(*field).and_then(Value::as_str) {
            let value = value.trim();
            let normalized = if matches!(*field, "plate" | "vin") {
                value.to_ascii_uppercase()
            } else {
                value.to_owned()
            };
            document.insert((*field).into(), Value::String(normalized));
        }
    }
    if entity == "repair_order"
        && let Some(lines) = document.get("lines").and_then(Value::as_array)
    {
        if let Some(total) = money::sum_line_totals(lines).and_then(money::json_number) {
            document.insert("total".into(), total);
        } else {
            document.remove("total");
        }
    }
}
