use rust_decimal::Decimal;
use serde_json::Value;

use crate::money;

pub(super) fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

pub(super) fn amount(document: &Value, field: &str) -> Option<Decimal> {
    money::decimal(document.get(field)?)
}

pub(super) fn amounts_match(left: Decimal, right: Decimal) -> bool {
    money::within_tolerance(left, right, amount_tolerance())
}

pub(super) fn refund_matches(original: Decimal, refund: Decimal) -> bool {
    money::sum_within_tolerance(original, refund, amount_tolerance())
}
