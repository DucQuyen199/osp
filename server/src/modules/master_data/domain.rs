//! Pure invariants for shared ERP master data.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

mod currency_rates;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let non_negative: &[&str] = match entity {
        "party" => &["credit_limit"],
        "product" => &["price", "cost", "weight", "preharvest_interval_days"],
        _ => &[],
    };
    for field in non_negative {
        if let Some(value) = document.get(*field).filter(|value| !value.is_null()) {
            if !money::decimal(value).is_some_and(|number| number >= Decimal::ZERO) {
                errors.push(format!("{field} must be a finite non-negative number"));
            }
        }
    }
    if entity == "product" {
        if let Some(value) = document
            .get("preharvest_interval_days")
            .filter(|value| !value.is_null())
        {
            if !money::decimal(value)
                .is_some_and(|number| number >= Decimal::ZERO && number.fract().is_zero())
            {
                errors.push(
                    "preharvest_interval_days must be a non-negative whole number of days".into(),
                );
            }
        }
    }
    match entity {
        "currency_rate" => errors.extend(currency_rates::validate(document)),
        "uom" => validate_rate(document, "ratio", true, &mut errors),
        "currency" => validate_rate(document, "rate", true, &mut errors),
        "tax" => {
            if let Some(value) = document.get("rate").filter(|value| !value.is_null()) {
                if !money::decimal(value)
                    .is_some_and(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate))
                {
                    errors.push("tax rate must be between 0 and 100".into());
                }
            }
        }
        _ => {}
    }
    errors
}

fn validate_rate(document: &Value, field: &str, exclusive: bool, errors: &mut Vec<String>) {
    if let Some(value) = document.get(field).filter(|value| !value.is_null()) {
        let valid = money::decimal(value).is_some_and(|number| {
            if exclusive {
                number > Decimal::ZERO
            } else {
                number >= Decimal::ZERO
            }
        });
        if !valid {
            errors.push(format!(
                "{field} must be a finite number {} zero",
                if exclusive {
                    "greater than"
                } else {
                    "at least"
                }
            ));
        }
    }
}
