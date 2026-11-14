//! Fixed-asset business invariants and depreciation value rules.
mod depreciation;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};

pub(super) use depreciation::monthly_depreciation;

pub(super) fn number(document: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(document.get(field)?)
}

pub(super) fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "asset" => {
            if document.get("cost").is_some()
                && !number(document, "cost").is_some_and(|value| value > Decimal::ZERO)
            {
                errors.push("Asset cost must be greater than zero".into());
            }
            if document.get("salvage_value").is_some()
                && !number(document, "salvage_value").is_some_and(|value| value >= Decimal::ZERO)
            {
                errors.push("Salvage value must be non-negative".into());
            }
            if document.get("disposal_proceeds").is_some()
                && !number(document, "disposal_proceeds")
                    .is_some_and(|value| value >= Decimal::ZERO)
            {
                errors.push("Disposal proceeds must be non-negative".into());
            }
            if document.get("useful_life_months").is_some()
                && !number(document, "useful_life_months")
                    .is_some_and(|value| value >= Decimal::ONE && value.fract() == Decimal::ZERO)
            {
                errors.push("Useful life must be a positive whole number of months".into());
            }
            if document
                .get("depreciation_method")
                .and_then(Value::as_str)
                .is_some_and(|method| !matches!(method, "straight_line" | "declining_balance"))
            {
                errors
                    .push("Depreciation method must be straight_line or declining_balance".into());
            }
            if document.get("declining_balance_factor").is_some()
                && !number(document, "declining_balance_factor")
                    .is_some_and(|value| value > Decimal::ZERO && value <= Decimal::from(2))
            {
                errors.push(
                    "Declining balance factor must be greater than zero and at most 2".into(),
                );
            }
            let cost = number(document, "cost").unwrap_or_default();
            let salvage = number(document, "salvage_value").unwrap_or_default();
            if salvage > cost {
                errors.push("Salvage value cannot exceed asset cost".into());
            }
            if document.get("accumulated_depreciation").is_some()
                && !number(document, "accumulated_depreciation").is_some_and(|value| {
                    value >= Decimal::ZERO
                        && cost
                            .checked_sub(salvage)
                            .and_then(|limit| limit.checked_add(Decimal::new(5, 3)))
                            .is_some_and(|limit| value <= limit)
                })
            {
                errors.push(
                    "Accumulated depreciation must remain within the depreciable basis".into(),
                );
            }
            if let (Some(purchase), Some(service)) = (
                date(document, "purchase_date"),
                date(document, "in_service_date"),
            ) && service < purchase
            {
                errors.push("In-service date cannot precede the purchase date".into());
            }
        }
        "depreciation" => {
            if document.get("amount").is_some()
                && !number(document, "amount").is_some_and(|value| value > Decimal::ZERO)
            {
                errors.push("Depreciation amount must be greater than zero".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "asset"
        && current.get("status").and_then(Value::as_str) == Some("disposed")
        && ["disposal_proceeds", "disposal_method"]
            .iter()
            .any(|field| patch.get(*field).is_some())
    {
        return vec!["Disposal details are immutable after the asset is disposed".into()];
    }
    let protected: &[&str] = match entity {
        "asset" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "code",
            "purchase_date",
            "in_service_date",
            "cost",
            "salvage_value",
            "useful_life_months",
            "depreciation_method",
            "declining_balance_factor",
            "acquisition_method",
            "opening_accumulated_depreciation",
            "accumulated_depreciation",
            "book_value",
        ],
        "asset" => &[
            "opening_accumulated_depreciation",
            "accumulated_depreciation",
            "book_value",
        ],
        "depreciation" => &["*"],
        _ => return Vec::new(),
    };
    let legacy_backfillable = [
        "code",
        "purchase_date",
        "in_service_date",
        "cost",
        "salvage_value",
        "useful_life_months",
        "depreciation_method",
        "declining_balance_factor",
        "acquisition_method",
    ];
    let changed_protected = protected.iter().any(|field| {
        patch.get(*field).is_some()
            && !(entity == "asset"
                && legacy_backfillable.contains(field)
                && current.get(*field).map_or(true, Value::is_null)
                && patch.get(*field).is_some_and(|value| !value.is_null()))
    });
    if protected.contains(&"*") || changed_protected {
        vec!["Asset financial fields can only change through controlled workflows".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "asset" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Capitalized assets must remain in the fixed-asset audit trail".into()]
        }
        "depreciation" if document.get("status").and_then(Value::as_str) == Some("posted") => {
            vec!["Posted depreciation cannot be removed; create an adjusting journal".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("asset", "activated") => {
            if !matches!(
                document.get("acquisition_method").and_then(Value::as_str),
                Some("cash" | "bank" | "opening_balance")
            ) {
                vec!["Select a valid asset capitalization method before activation".into()]
            } else {
                Vec::new()
            }
        }
        ("asset", "opening_balance_recorded") => {
            let mut errors = Vec::new();
            if document.get("acquisition_method").and_then(Value::as_str) != Some("opening_balance")
            {
                errors.push("Only opening-balance assets can record opening balances".into());
            }
            if !number(document, "cost").is_some_and(|cost| cost > Decimal::ZERO)
                || date(document, "in_service_date").is_none()
                || !number(document, "useful_life_months")
                    .is_some_and(|months| months >= Decimal::ONE && months.fract() == Decimal::ZERO)
            {
                errors.push(
                    "Set a positive asset cost, in-service date and whole-month useful life before recording the opening balance".into(),
                );
            }
            errors
        }
        ("asset", "disposed") => {
            let proceeds = number(document, "disposal_proceeds").unwrap_or(Decimal::ZERO);
            let method = document.get("disposal_method").and_then(Value::as_str);
            if document.get("disposal_proceeds").is_some()
                && number(document, "disposal_proceeds").is_none()
            {
                return vec!["Disposal proceeds must be a valid decimal amount".into()];
            }
            if proceeds < Decimal::ZERO {
                return vec!["Disposal proceeds must be non-negative".into()];
            }
            if proceeds > Decimal::ZERO && !matches!(method, Some("cash" | "bank")) {
                return vec!["Select cash or bank for disposal proceeds".into()];
            }
            Vec::new()
        }
        ("depreciation", "posted") => {
            if !number(document, "amount").is_some_and(|value| value > Decimal::ZERO) {
                vec!["Only positive system-calculated depreciation can be posted".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn initial_accumulated_depreciation() -> Value {
    json!(0)
}
