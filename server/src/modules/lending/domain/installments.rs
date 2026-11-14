//! Exact-decimal annuity calculations and monthly repayment dates.
use chrono::{Months, NaiveDate};
use rust_decimal::{Decimal, RoundingStrategy};

const MAX_ANNUAL_RATE_PERCENT: u32 = 1000;
const MAX_INSTALLMENTS: u32 = 600;

fn round_money(value: Decimal) -> Decimal {
    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

/// Calculate equal monthly annuity installments from the outstanding balance.
pub fn installment_amounts(
    principal: Decimal,
    annual_rate_percent: Decimal,
    months: u32,
) -> Option<Vec<Decimal>> {
    installment_components(principal, annual_rate_percent, months)
        .map(|rows| rows.into_iter().map(|(amount, _, _)| amount).collect())
}

pub fn installment_components(
    principal: Decimal,
    annual_rate_percent: Decimal,
    months: u32,
) -> Option<Vec<(Decimal, Decimal, Decimal)>> {
    if principal <= Decimal::ZERO
        || !(Decimal::ZERO..=Decimal::from(MAX_ANNUAL_RATE_PERCENT)).contains(&annual_rate_percent)
        || !(1..=MAX_INSTALLMENTS).contains(&months)
    {
        return None;
    }
    let monthly_rate = annual_rate_percent.checked_div(Decimal::from(1200))?;
    let period_count = Decimal::from(months);
    let payment = if monthly_rate.is_zero() {
        principal.checked_div(period_count)?
    } else {
        // Sum discounted periods instead of raising a large factor to `months`.
        // This remains bounded for long terms and high, but valid, rates.
        let growth = Decimal::ONE.checked_add(monthly_rate)?;
        let mut discount = Decimal::ONE;
        let mut annuity_factor = Decimal::ZERO;
        for _ in 0..months {
            discount = discount.checked_div(growth)?;
            annuity_factor = annuity_factor.checked_add(discount)?;
        }
        principal.checked_div(annuity_factor)?
    };

    let mut balance = round_money(principal);
    let mut amounts = Vec::with_capacity(months as usize);
    for index in 0..months {
        let interest = round_money(balance.checked_mul(monthly_rate)?);
        let is_last = index + 1 == months;
        let installment = if is_last {
            round_money(balance.checked_add(interest)?)
        } else {
            round_money(payment)
        };
        let principal_repayment = if is_last {
            balance
        } else {
            round_money(installment.checked_sub(interest)?)
        };
        balance = round_money(balance.checked_sub(principal_repayment)?.max(Decimal::ZERO));
        amounts.push((
            round_money(principal_repayment.checked_add(interest)?),
            principal_repayment,
            interest,
        ));
    }
    Some(amounts)
}

pub fn due_dates(start: NaiveDate, months: u32) -> Option<Vec<NaiveDate>> {
    (1..=months)
        .map(|month| start.checked_add_months(Months::new(month)))
        .collect()
}
