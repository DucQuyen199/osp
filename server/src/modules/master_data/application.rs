//! Normalize shared party, product, and reference data identities.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let (fields, required): (&[&str], &[&str]) = match entity {
        "party" => (
            &["name", "email", "phone", "tax_code", "address"],
            &["name"],
        ),
        "contact" => (&["name", "title", "phone", "email"], &["name"]),
        "product" => (
            &["sku", "barcode", "name", "uom", "category"],
            &["sku", "name"],
        ),
        "product_category" => (&["name"], &["name"]),
        "uom" => (&["name"], &["name"]),
        "branch" => (&["name", "code", "address"], &["name"]),
        "currency" => (&["code", "name"], &["code"]),
        "tax" => (&["name"], &["name"]),
        _ => return Vec::new(),
    };
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            let normalized = match *field {
                "email" => value.to_ascii_lowercase(),
                "sku" | "barcode" | "code" | "tax_code" => value.to_ascii_uppercase(),
                _ => value,
            };
            if required.contains(field) && normalized.is_empty() {
                errors.push(format!("{field} cannot be empty"));
            }
            document.insert((*field).into(), Value::String(normalized));
        }
    }
    errors
}
