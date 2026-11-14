//! Payroll overtime valuation from the captured monthly salary basis.
use crate::{error::R, money};
use rust_decimal::{Decimal, RoundingStrategy};

pub(in crate::modules::payroll) fn calculate_overtime_pay(
    salary_basis: Decimal,
    working_days: Decimal,
    hours_per_day: Decimal,
    weighted_hours: Decimal,
) -> R<Decimal> {
    if salary_basis <= Decimal::ZERO
        || working_days <= Decimal::ZERO
        || !(Decimal::ONE..=Decimal::from(24)).contains(&hours_per_day)
        || weighted_hours < Decimal::ZERO
    {
        return Err(crate::error::ApiError::validation(
            "payroll.overtime_entry",
            vec!["Overtime valuation inputs must be valid and non-negative".into()],
        ));
    }
    let amount = salary_basis
        .checked_div(working_days)
        .and_then(|daily| daily.checked_div(hours_per_day))
        .and_then(|hourly| hourly.checked_mul(weighted_hours))
        .map(|amount| amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
        .map(money::round_money)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "payroll.payslip",
                vec!["Overtime pay exceeds the supported amount range".into()],
            )
        })?;
    Ok(amount)
}
