//! Asset master-data normalization and opening-balance preparation.
use super::shared::{decimal_json, optional_decimal};
use crate::money;
use rust_decimal::Decimal;
use serde_json::{Map, Value};

pub fn prepare_asset_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    if entity != "asset" {
        return Vec::new();
    }
    let opening_value = document.get("opening_accumulated_depreciation");
    let opening_accumulated = optional_decimal(
        &Value::Object(document.clone()),
        "opening_accumulated_depreciation",
    )
    .unwrap_or(Decimal::ZERO);
    let opening_balance =
        document.get("acquisition_method").and_then(Value::as_str) == Some("opening_balance");
    if (opening_value.is_some_and(|value| !value.is_null() && money::decimal(value).is_none()))
        || opening_accumulated < Decimal::ZERO
        || (!opening_balance && opening_accumulated > Decimal::new(5, 3))
    {
        return vec![
            "Opening accumulated depreciation must be non-negative and only applies to opening-balance assets".into(),
        ];
    }
    let accumulated = if opening_balance {
        opening_accumulated
    } else {
        Decimal::ZERO
    };
    let Ok(accumulated_value) = decimal_json(accumulated) else {
        return vec!["Opening accumulated depreciation exceeds supported limits".into()];
    };
    document.insert("accumulated_depreciation".into(), accumulated_value);
    if let Some(cost) = document.get("cost").and_then(money::decimal) {
        if let Some(book_value) = cost.checked_sub(accumulated) {
            if let Ok(book_value) = decimal_json(book_value) {
                document.insert("book_value".into(), book_value);
            } else {
                document.remove("book_value");
            }
        } else {
            document.remove("book_value");
        }
    } else {
        document.remove("book_value");
    }
    Vec::new()
}
