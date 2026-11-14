use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone)]
pub(in crate::modules::payroll) struct TaxBand {
    pub upper: Option<Decimal>,
    pub rate: Decimal,
}

#[derive(Clone)]
pub(in crate::modules::payroll) struct TaxPolicy {
    pub id: Uuid,
    pub personal_allowance: Decimal,
    pub dependent_allowance: Decimal,
    pub nonresident_rate: Decimal,
    pub rounding_unit: Decimal,
    pub resident_brackets: Vec<TaxBand>,
}

fn tax_policy_error(message: &str) -> crate::error::ApiError {
    crate::error::ApiError::validation("payroll.tax_policy", vec![message.into()])
}

fn row_decimal(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "payroll.tax_policy",
            vec![format!(
                "Stored tax policy {field} exceeds the supported decimal range"
            )],
        )
    })
}

pub(in crate::modules::payroll) async fn load_tax_policy(
    tx: &Tx<'_>,
    tenant: &Tenant,
    as_of: chrono::NaiveDate,
) -> R<Option<TaxPolicy>> {
    let Some(row) = tx
        .query_opt(
            "SELECT id, personal_allowance::text, dependent_allowance::text, resident_brackets, nonresident_rate::text, rounding_unit::text FROM payroll__tax_policy WHERE tenant_id = $1 AND status = 'approved' AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2) ORDER BY effective_from DESC, created_at DESC LIMIT 1 FOR SHARE",
            &[&tenant.id, &as_of],
        )
        .await?
    else {
        return Ok(None);
    };
    let bracket_value: Value = row.get(3);
    let mut resident_brackets = Vec::new();
    for band in bracket_value.as_array().into_iter().flatten() {
        let rate = band
            .get("rate")
            .and_then(money::decimal)
            .ok_or_else(|| tax_policy_error("Approved tax policy contains an invalid tax rate"))?;
        let upper = match band.get("upper") {
            None | Some(Value::Null) => None,
            Some(value) => Some(money::decimal(value).ok_or_else(|| {
                tax_policy_error("Approved tax policy contains an invalid bracket limit")
            })?),
        };
        if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate)
            || upper.is_some_and(|limit| limit <= Decimal::ZERO)
        {
            return Err(tax_policy_error(
                "Approved tax policy contains an invalid tax bracket",
            ));
        }
        resident_brackets.push(TaxBand { upper, rate });
    }
    if resident_brackets.is_empty()
        || resident_brackets
            .last()
            .is_some_and(|band| band.upper.is_some())
    {
        return Err(tax_policy_error(
            "Approved resident tax brackets must end with an unbounded final band",
        ));
    }
    let policy = TaxPolicy {
        id: row.get(0),
        personal_allowance: row_decimal(&row, 1, "personal allowance")?,
        dependent_allowance: row_decimal(&row, 2, "dependent allowance")?,
        resident_brackets,
        nonresident_rate: row_decimal(&row, 4, "nonresident rate")?,
        rounding_unit: row_decimal(&row, 5, "rounding unit")?,
    };
    if policy.personal_allowance < Decimal::ZERO
        || policy.dependent_allowance < Decimal::ZERO
        || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&policy.nonresident_rate)
        || policy.rounding_unit <= Decimal::ZERO
    {
        return Err(tax_policy_error(
            "Approved tax policy contains invalid values",
        ));
    }
    Ok(Some(policy))
}

pub(in crate::modules::payroll) fn calculate_income_tax(
    policy: &TaxPolicy,
    residency: &str,
    dependent_count: i32,
    taxable_gross: Decimal,
) -> R<(Decimal, Decimal)> {
    if taxable_gross < Decimal::ZERO || dependent_count < 0 {
        return Err(crate::error::ApiError::validation(
            "payroll.payslip",
            vec!["Tax calculation inputs must be non-negative".into()],
        ));
    }
    let taxable_income = match residency {
        "resident" => {
            let dependent_allowance = policy
                .dependent_allowance
                .checked_mul(Decimal::from(dependent_count))
                .ok_or_else(|| {
                    tax_policy_error("Dependent allowance exceeds the supported range")
                })?;
            taxable_gross
                .checked_sub(policy.personal_allowance)
                .and_then(|amount| amount.checked_sub(dependent_allowance))
                .ok_or_else(|| tax_policy_error("Taxable income exceeds the supported range"))?
                .max(Decimal::ZERO)
        }
        "nonresident" => taxable_gross,
        "exempt" => Decimal::ZERO,
        _ => {
            return Err(crate::error::ApiError::validation(
                "hrm.employee",
                vec!["Tax residency must be resident, nonresident, or exempt".into()],
            ));
        }
    };
    let raw_tax = match residency {
        "resident" => {
            let mut lower = Decimal::ZERO;
            let mut tax = Decimal::ZERO;
            for band in &policy.resident_brackets {
                let upper = band.upper.unwrap_or(taxable_income);
                let taxable_in_band = taxable_income
                    .min(upper)
                    .checked_sub(lower)
                    .ok_or_else(|| {
                        tax_policy_error("Tax bracket calculation exceeds the supported range")
                    })?
                    .max(Decimal::ZERO);
                let band_tax = taxable_in_band
                    .checked_mul(band.rate)
                    .and_then(|amount| amount.checked_div(Decimal::ONE_HUNDRED))
                    .ok_or_else(|| {
                        tax_policy_error("Tax bracket amount exceeds the supported range")
                    })?;
                tax = tax
                    .checked_add(band_tax)
                    .ok_or_else(|| tax_policy_error("Tax total exceeds the supported range"))?;
                if taxable_income <= upper {
                    break;
                }
                lower = upper;
            }
            tax
        }
        "nonresident" => taxable_income
            .checked_mul(policy.nonresident_rate)
            .and_then(|amount| amount.checked_div(Decimal::ONE_HUNDRED))
            .ok_or_else(|| tax_policy_error("Nonresident tax exceeds the supported range"))?,
        _ => Decimal::ZERO,
    };
    if policy.rounding_unit <= Decimal::ZERO {
        return Err(tax_policy_error("Tax rounding unit must be positive"));
    }
    let income_tax = raw_tax
        .checked_div(policy.rounding_unit)
        .map(|amount| amount.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero))
        .and_then(|amount| amount.checked_mul(policy.rounding_unit))
        .map(money::round_money)
        .ok_or_else(|| {
            tax_policy_error("Calculated income tax exceeds the supported amount range")
        })?;
    Ok((taxable_income, income_tax))
}
