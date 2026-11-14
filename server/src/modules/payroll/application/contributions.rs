//! Effective-dated employee and employer payroll contribution policies.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use uuid::Uuid;

#[derive(Clone)]
pub(in crate::modules::payroll) struct ContributionPolicy {
    pub id: Uuid,
    pub basis: String,
    pub monthly_base_cap: Option<Decimal>,
    pub employee_rate: Decimal,
    pub employer_rate: Decimal,
    pub employee_deductible_for_tax: bool,
}

pub(in crate::modules::payroll) async fn load_contribution_policy(
    tx: &Tx<'_>,
    tenant: &Tenant,
    as_of: chrono::NaiveDate,
) -> R<Option<ContributionPolicy>> {
    let Some(row) = tx
        .query_opt(
            "SELECT id, basis, monthly_base_cap::text, employee_rate::text, employer_rate::text, COALESCE(employee_deductible_for_tax, false) FROM payroll__contribution_policy WHERE tenant_id = $1 AND status = 'approved' AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2) ORDER BY effective_from DESC, created_at DESC LIMIT 1 FOR SHARE",
            &[&tenant.id, &as_of],
        )
        .await?
    else {
        return Ok(None);
    };
    let parse = |raw: Option<String>| -> R<Option<Decimal>> {
        raw.map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "payroll.contribution_policy",
                    vec!["Approved contribution policy contains an invalid decimal value".into()],
                )
            })
        })
        .transpose()
    };
    let policy = ContributionPolicy {
        id: row.get(0),
        basis: row.get(1),
        monthly_base_cap: parse(row.get(2))?,
        employee_rate: parse(row.get(3))?.ok_or_else(|| {
            crate::error::ApiError::validation(
                "payroll.contribution_policy",
                vec!["Employee contribution rate is missing".into()],
            )
        })?,
        employer_rate: parse(row.get(4))?.ok_or_else(|| {
            crate::error::ApiError::validation(
                "payroll.contribution_policy",
                vec!["Employer contribution rate is missing".into()],
            )
        })?,
        employee_deductible_for_tax: row.get(5),
    };
    validate_contribution_policy_values(&policy)?;
    Ok(Some(policy))
}

pub(in crate::modules::payroll) fn calculate_contributions(
    policy: &ContributionPolicy,
    exempt: bool,
    salary_basis: Decimal,
    gross: Decimal,
) -> R<(Decimal, Decimal, Decimal)> {
    validate_contribution_policy_values(policy)?;
    if salary_basis < Decimal::ZERO || gross < Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "payroll.payslip",
            vec!["Contribution salary and gross bases must be non-negative".into()],
        ));
    }
    let raw_base = if policy.basis == "salary" {
        salary_basis
    } else {
        gross
    };
    let contribution_base = if exempt {
        Decimal::ZERO
    } else {
        policy
            .monthly_base_cap
            .map_or(raw_base, |cap| raw_base.min(cap))
    };
    let employee_amount = contribution_base
        .checked_mul(policy.employee_rate)
        .and_then(|amount| amount.checked_div(Decimal::ONE_HUNDRED))
        .map(money::round_money)
        .ok_or_else(contribution_overflow)?;
    let employer_amount = contribution_base
        .checked_mul(policy.employer_rate)
        .and_then(|amount| amount.checked_div(Decimal::ONE_HUNDRED))
        .map(money::round_money)
        .ok_or_else(contribution_overflow)?;
    Ok((
        money::round_money(contribution_base),
        employee_amount,
        employer_amount,
    ))
}

fn validate_contribution_policy_values(policy: &ContributionPolicy) -> R<()> {
    if !matches!(policy.basis.as_str(), "salary" | "gross")
        || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&policy.employee_rate)
        || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&policy.employer_rate)
        || policy
            .monthly_base_cap
            .is_some_and(|cap| cap <= Decimal::ZERO)
    {
        return Err(crate::error::ApiError::validation(
            "payroll.contribution_policy",
            vec!["Approved payroll contribution policy contains invalid rates or bases".into()],
        ));
    }
    Ok(())
}

fn contribution_overflow() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "payroll.payslip",
        vec!["Calculated payroll contribution exceeds the supported amount range".into()],
    )
}
