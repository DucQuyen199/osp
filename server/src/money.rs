//! Shared exact-decimal operations for persisted financial amounts.
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;
use std::str::FromStr;

pub const MONEY_SCALE: u32 = 4;

pub fn decimal(value: &Value) -> Option<Decimal> {
    decimal_str(&value.to_string())
}

pub fn decimal_str(value: &str) -> Option<Decimal> {
    Decimal::from_str(value).ok()
}

pub fn json_number(value: Decimal) -> Option<Value> {
    serde_json::from_str(&value.normalize().to_string()).ok()
}

pub fn round_money(value: Decimal) -> Decimal {
    value.round_dp_with_strategy(MONEY_SCALE, RoundingStrategy::MidpointAwayFromZero)
}

pub fn within_tolerance(left: Decimal, right: Decimal, tolerance: Decimal) -> bool {
    tolerance >= Decimal::ZERO
        && left
            .checked_sub(right)
            .is_some_and(|delta| delta >= -tolerance && delta <= tolerance)
}

pub fn sum_within_tolerance(left: Decimal, right: Decimal, tolerance: Decimal) -> bool {
    left.checked_add(right)
        .is_some_and(|sum| within_tolerance(sum, Decimal::ZERO, tolerance))
}

pub fn amount(qty: Decimal, price: Decimal) -> Option<Decimal> {
    if qty < Decimal::ZERO || price < Decimal::ZERO {
        return None;
    }
    qty.checked_mul(price).map(round_money)
}

pub fn sum_line_totals(lines: &[Value]) -> Option<Decimal> {
    lines.iter().try_fold(Decimal::ZERO, |total, line| {
        let qty = decimal(line.get("qty")?)?;
        let price = decimal(line.get("price")?)?;
        total.checked_add(amount(qty, price)?)
    })
}

/// Calculate a sales or purchasing line with the shared four-decimal policy.
pub fn line_amounts(
    qty: Decimal,
    price: Decimal,
    discount_pct: Decimal,
    tax_rate: Decimal,
) -> Option<(Decimal, Decimal, Decimal, Decimal)> {
    if qty <= Decimal::ZERO
        || price < Decimal::ZERO
        || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&discount_pct)
        || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&tax_rate)
    {
        return None;
    }
    let gross = qty.checked_mul(price)?;
    let discount = round_money(
        gross
            .checked_mul(discount_pct)?
            .checked_div(Decimal::ONE_HUNDRED)?,
    );
    let net = round_money(gross.checked_sub(discount)?);
    let tax = round_money(
        net.checked_mul(tax_rate)?
            .checked_div(Decimal::ONE_HUNDRED)?,
    );
    let total = round_money(net.checked_add(tax)?);
    Some((discount, net, tax, total))
}
