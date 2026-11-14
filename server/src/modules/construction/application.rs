//! Normalize construction commands and calculate trusted BOQ totals.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value};

pub async fn prepare_document(
    _tx: &Tx<'_>,
    _tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    match entity {
        "site" => trim(document, &["name", "address"]),
        "subcontract" => trim(document, &["scope"]),
        "site_diary" => trim(document, &["weather", "notes"]),
        "boq" => prepare_boq(document),
        _ => Ok(Vec::new()),
    }
}

fn trim(document: &mut Map<String, Value>, fields: &[&str]) -> R<Vec<String>> {
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value));
        }
    }
    Ok(Vec::new())
}

fn prepare_boq(document: &mut Map<String, Value>) -> R<Vec<String>> {
    let Some(items) = document.get("items").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut total = Decimal::ZERO;
    for item in items {
        let qty = item.get("qty").and_then(money::decimal).unwrap_or_default();
        let unit_price = item
            .get("unit_price")
            .and_then(money::decimal)
            .unwrap_or_default();
        let Some(line_total) = qty.checked_mul(unit_price) else {
            return Ok(vec![
                "BOQ line value exceeds the supported decimal range".into(),
            ]);
        };
        let Some(updated_total) = total.checked_add(line_total) else {
            return Ok(vec!["BOQ total exceeds the supported decimal range".into()]);
        };
        total = updated_total;
    }
    let total = total.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let value = money::json_number(total).ok_or_else(|| {
        crate::error::ApiError::validation(
            "construction.boq",
            vec!["BOQ total exceeds the supported decimal range".into()],
        )
    })?;
    document.insert("total".into(), value);
    Ok(Vec::new())
}
