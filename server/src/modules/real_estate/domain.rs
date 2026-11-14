//! Property and lease invariants independent of storage and HTTP.
use crate::money;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub const LEASE_ACTIVATED_EVENT: &str = "real-estate.lease.activated";
pub const LEASE_TERMINATED_EVENT: &str = "real-estate.lease.terminated";
pub const LEASE_RENT_DUE_EVENT: &str = "real-estate.lease.rent_due";

pub fn leased_property(document: &Value) -> Option<Uuid> {
    document
        .get("property")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "property" => {
            validate_positive(document, "area", true, &mut errors);
            validate_positive(document, "price", false, &mut errors);
        }
        "lease" => {
            validate_positive(document, "rent", true, &mut errors);
            if document
                .get("billing_interval")
                .and_then(Value::as_str)
                .is_some_and(|interval| !matches!(interval, "monthly" | "quarterly" | "yearly"))
            {
                errors.push("Lease billing interval must be monthly, quarterly, or yearly".into());
            }
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
            {
                if end < start {
                    errors.push("Lease end date cannot be before its start date".into());
                }
            }
        }
        "reservation" => {
            if document
                .get("number")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Reservation number is required".into());
            }
            if date(document, "expires_on").is_none() {
                errors.push("Reservation expiry date must be valid".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("property", "sold") => {
            let mut errors = Vec::new();
            if document.get("buyer").and_then(Value::as_str).is_none() {
                errors.push("Property sale requires a recorded buyer".into());
            }
            if !document
                .get("sale_price")
                .and_then(money::decimal)
                .is_some_and(|price| price > Decimal::ZERO)
            {
                errors.push("Property sale requires a positive agreed sale price".into());
            }
            errors
        }
        ("reservation", "reserved") => {
            let mut errors = Vec::new();
            if date(document, "expires_on")
                .is_none_or(|expiry| expiry < chrono::Utc::now().date_naive())
            {
                errors.push("A reservation must expire today or on a future date".into());
            }
            if !document
                .get("agreed_price")
                .and_then(money::decimal)
                .is_some_and(|price| price > Decimal::ZERO)
            {
                errors.push("A reservation requires a positive agreed sale price".into());
            }
            errors
        }
        ("reservation", "converted") => {
            if !document
                .get("agreed_price")
                .and_then(money::decimal)
                .is_some_and(|price| price > Decimal::ZERO)
            {
                vec!["Reservation conversion requires a positive agreed sale price".into()]
            } else {
                Vec::new()
            }
        }
        ("lease", "activated") => {
            let mut errors = Vec::new();
            validate_positive(document, "rent", true, &mut errors);
            if date(document, "start_date").is_none() || date(document, "end_date").is_none() {
                errors.push("Lease activation requires valid start and end dates".into());
            }
            if leased_property(document).is_none() {
                errors.push("Lease activation requires a property".into());
            }
            if document
                .get("tenant")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_none()
            {
                errors.push("Lease activation requires a valid tenant party".into());
            }
            errors
        }
        ("lease", "rent_due") => {
            let mut errors = Vec::new();
            validate_positive(document, "rent", true, &mut errors);
            if date(document, "next_rent_date").is_none() {
                errors.push("Rent billing requires a scheduled next rent date".into());
            }
            errors
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "reservation" {
        if patch.get("status").is_some() {
            return vec!["Reservation status can only change through its workflow actions".into()];
        }
        if current.get("status").and_then(Value::as_str) != Some("draft") {
            return vec!["A confirmed or completed reservation cannot be edited".into()];
        }
    }
    let immutable = match entity {
        "lease" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "property",
            "tenant",
            "rent",
            "billing_interval",
            "start_date",
            "end_date",
        ][..],
        "property" if current.get("status").and_then(Value::as_str) == Some("sold") => &["*"][..],
        _ => &[][..],
    };
    if immutable.contains(&"*") || immutable.iter().any(|field| patch.get(*field).is_some()) {
        return vec!["Operational lease terms and sold property records are immutable".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "reservation" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Confirmed reservation history cannot be deleted".into()]
        }
        "rent_cycle" => {
            vec!["Billed rent cycles are retained as immutable financial history".into()]
        }
        "lease" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Activated or terminated leases must be retained as business history".into()]
        }
        "property"
            if !matches!(
                document.get("status").and_then(Value::as_str),
                Some("available")
            ) =>
        {
            vec!["Reserved, sold, or leased properties cannot be deleted".into()]
        }
        _ => Vec::new(),
    }
}

fn validate_positive(document: &Value, field: &str, exclusive: bool, errors: &mut Vec<String>) {
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

pub(super) fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub(super) fn interval_months(document: &Value) -> u32 {
    match document.get("billing_interval").and_then(Value::as_str) {
        Some("quarterly") => 3,
        Some("yearly") => 12,
        _ => 1,
    }
}

pub(super) fn next_anchor_date(date: NaiveDate, anchor_day: u32, months: u32) -> Option<NaiveDate> {
    use chrono::{Datelike, Months};
    let month_start = date.with_day(1)?.checked_add_months(Months::new(months))?;
    let next_month = month_start.checked_add_months(Months::new(1))?;
    let last_day = (next_month - chrono::Duration::days(1)).day();
    month_start.with_day(anchor_day.min(last_day))
}
