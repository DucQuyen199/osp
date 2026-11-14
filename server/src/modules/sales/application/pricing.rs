use crate::money::{decimal, json_number, line_amounts};
use rust_decimal::Decimal;
use serde_json::{Map, Value};

/// Rebuild line and header totals using exact base-10 arithmetic. This also
/// backfills derived values when updating older sales records.
pub fn recalculate_lines(document: &mut Map<String, Value>) -> Vec<String> {
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Vec::new();
    };
    let mut errors = Vec::new();
    let mut total = Decimal::ZERO;
    let mut tax_total = Decimal::ZERO;
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("lines[{}] must be an object", index + 1));
            continue;
        };
        for field in ["discount_amount", "net_amount", "tax_amount", "line_total"] {
            line.remove(field);
        }
        let discount_pct = match line.get("discount_pct") {
            Some(value) => match decimal(value) {
                Some(value) => value,
                None => {
                    errors.push(format!(
                        "lines[{}].discount_pct must be a decimal number",
                        index + 1
                    ));
                    continue;
                }
            },
            None => Decimal::ZERO,
        };
        if discount_pct < Decimal::ZERO || discount_pct > Decimal::ONE_HUNDRED {
            errors.push(format!(
                "lines[{}].discount_pct must be between 0 and 100",
                index + 1
            ));
            continue;
        }
        line.entry("discount_pct").or_insert_with(|| Value::from(0));
        let (Some(qty), Some(price)) = (
            line.get("qty").and_then(decimal),
            line.get("price").and_then(decimal),
        ) else {
            errors.push(format!(
                "lines[{}] requires numeric quantity and price",
                index + 1
            ));
            continue;
        };
        if qty <= Decimal::ZERO || price < Decimal::ZERO {
            errors.push(format!(
                "lines[{}] quantity must be positive and price cannot be negative",
                index + 1
            ));
            continue;
        }
        let tax_rate = match line.get("tax_rate") {
            Some(value) => match decimal(value) {
                Some(value) => value,
                None => {
                    errors.push(format!(
                        "lines[{}].tax_rate must be a decimal number",
                        index + 1
                    ));
                    continue;
                }
            },
            None => Decimal::ZERO,
        };
        if tax_rate < Decimal::ZERO || tax_rate > Decimal::ONE_HUNDRED {
            errors.push(format!(
                "lines[{}].tax_rate must be between 0 and 100",
                index + 1
            ));
            continue;
        }
        let amounts = line_amounts(qty, price, discount_pct, tax_rate);
        let Some((discount, net, tax, line_total)) = amounts else {
            errors.push(format!(
                "lines[{}] has values outside supported financial limits",
                index + 1
            ));
            continue;
        };
        let Some(discount_value) = json_number(discount) else {
            errors.push(format!(
                "lines[{}] discount cannot be serialized",
                index + 1
            ));
            continue;
        };
        let Some(net_value) = json_number(net) else {
            errors.push(format!(
                "lines[{}] net amount cannot be serialized",
                index + 1
            ));
            continue;
        };
        let Some(tax_value) = json_number(tax) else {
            errors.push(format!("lines[{}] tax cannot be serialized", index + 1));
            continue;
        };
        let Some(total_value) = json_number(line_total) else {
            errors.push(format!("lines[{}] total cannot be serialized", index + 1));
            continue;
        };
        line.insert("discount_amount".into(), discount_value);
        line.insert("net_amount".into(), net_value);
        line.insert("tax_amount".into(), tax_value);
        line.insert("line_total".into(), total_value);
        let Some(next_total) = total.checked_add(line_total) else {
            errors.push("Sales document total exceeds supported financial limits".into());
            continue;
        };
        let Some(next_tax_total) = tax_total.checked_add(tax) else {
            errors.push("Sales tax total exceeds supported financial limits".into());
            continue;
        };
        total = next_total;
        tax_total = next_tax_total;
    }
    if errors.is_empty() {
        if let (Some(total), Some(tax_total)) = (json_number(total), json_number(tax_total)) {
            document.insert("total".into(), total);
            document.insert("tax_total".into(), tax_total);
        } else {
            errors.push("Sales document totals cannot be serialized".into());
        }
    }
    errors
}
