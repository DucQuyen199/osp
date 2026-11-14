//! Shared fixed-asset depreciation policy used by posting preparation and forecasts.
use rust_decimal::{Decimal, RoundingStrategy};

pub fn monthly_depreciation(
    cost: Decimal,
    salvage_value: Decimal,
    useful_life_months: Decimal,
    month_offset: i32,
    accumulated_depreciation: Decimal,
    method: &str,
    declining_balance_factor: Decimal,
) -> Option<Decimal> {
    if month_offset < 0 || useful_life_months <= Decimal::ZERO {
        return None;
    }
    let depreciable_basis = cost.checked_sub(salvage_value)?.max(Decimal::ZERO);
    let remaining = depreciable_basis
        .checked_sub(accumulated_depreciation)?
        .max(Decimal::ZERO);
    if remaining <= Decimal::new(5, 3) {
        return Some(Decimal::ZERO);
    }
    let monthly = match method {
        "straight_line" => {
            remaining.checked_div(useful_life_months.checked_sub(Decimal::from(month_offset))?)?
        }
        "declining_balance" => remaining
            .checked_mul(declining_balance_factor)?
            .checked_div(useful_life_months)?,
        _ => return None,
    }
    .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let next_month = month_offset.checked_add(1)?;
    let amount = if Decimal::from(next_month) >= useful_life_months {
        remaining
    } else {
        monthly.min(remaining)
    };
    Some(if amount > Decimal::new(5, 3) {
        amount
    } else {
        Decimal::ZERO
    })
}
