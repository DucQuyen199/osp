//! Pure payslip and payroll-run invariants.
use chrono::Datelike;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;

#[path = "domain/lifecycle.rs"]
mod lifecycle;
#[path = "domain/policies.rs"]
mod policies;

pub use lifecycle::{validate_action, validate_remove, validate_update};
use policies::{
    valid_period, validate_adjustment, validate_contribution_policy,
    validate_contribution_remittance, validate_overtime_entry, validate_tax_deduction,
    validate_tax_policy,
};

fn decimal_field(document: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(document.get(field)?)
}

fn optional_decimal_field(document: &Value, field: &str) -> Option<Decimal> {
    match document.get(field) {
        None | Some(Value::Null) => Some(Decimal::ZERO),
        Some(value) => crate::money::decimal(value),
    }
}

fn valid_working_weekdays(document: &Value) -> bool {
    match document.get("working_weekdays") {
        None | Some(Value::Null) => true,
        Some(Value::Array(days)) => {
            !days.is_empty()
                && days.len() <= 7
                && days
                    .iter()
                    .all(|day| day.as_u64().is_some_and(|day| (1..=7).contains(&day)))
                && days
                    .iter()
                    .map(Value::as_u64)
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    == days.len()
        }
        _ => false,
    }
}

fn validate_run_weekdays(document: &Value, errors: &mut Vec<String>) {
    if !valid_working_weekdays(document) {
        errors.push(
            "working_weekdays must be a non-empty list of unique ISO weekdays from 1 to 7".into(),
        );
    }
}
pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity == "tax_policy" {
        return validate_tax_policy(document);
    }
    if entity == "tax_deduction" {
        return validate_tax_deduction(document, false, false);
    }
    if entity == "contribution_policy" {
        return validate_contribution_policy(document);
    }
    if entity == "payroll_adjustment" {
        return validate_adjustment(document);
    }
    if entity == "overtime_entry" {
        return validate_overtime_entry(document);
    }
    if entity == "contribution_remittance" {
        return validate_contribution_remittance(document, false);
    }
    if entity == "payroll_run" {
        let mut errors = if document
            .get("period")
            .and_then(Value::as_str)
            .is_some_and(valid_period)
        {
            Vec::new()
        } else {
            vec!["Payroll period must use YYYY-MM format".into()]
        };
        if document
            .get("hours_per_day")
            .is_some_and(|value| !value.is_null())
            && !decimal_field(document, "hours_per_day")
                .is_some_and(|hours| (Decimal::ONE..=Decimal::from(24)).contains(&hours))
        {
            errors.push("Payroll hours_per_day must be between 1 and 24".into());
        }
        validate_run_weekdays(document, &mut errors);
        return errors;
    }
    if entity != "payslip" {
        return Vec::new();
    }

    let mut errors = Vec::new();
    let gross = decimal_field(document, "gross");
    let deductions = optional_decimal_field(document, "deductions").unwrap_or(Decimal::ZERO);
    let tolerance = Decimal::new(5, 3);
    if !gross.is_some_and(|amount| amount > Decimal::ZERO) {
        errors.push("Payslip gross must be greater than zero".into());
    }
    if optional_decimal_field(document, "deductions").is_none_or(|amount| amount < Decimal::ZERO) {
        errors.push("Payslip deductions cannot be negative".into());
    }
    if gross.is_some_and(|amount| {
        amount
            .checked_sub(deductions)
            .is_none_or(|net| net <= Decimal::ZERO)
    }) {
        errors.push("Payslip net pay must be greater than zero".into());
    }
    let expected_net = gross
        .and_then(|amount| amount.checked_sub(deductions))
        .map(crate::money::round_money);
    if decimal_field(document, "net").is_none_or(|captured| {
        expected_net.is_none_or(|expected| crate::money::round_money(captured) != expected)
    }) {
        errors.push("Payslip net must equal gross less deductions".into());
    }

    let income_tax = optional_decimal_field(document, "income_tax").unwrap_or(Decimal::ZERO);
    let taxable_income =
        optional_decimal_field(document, "taxable_income").unwrap_or(Decimal::ZERO);
    let contribution_base =
        optional_decimal_field(document, "contribution_base").unwrap_or(Decimal::ZERO);
    let employee_contribution =
        optional_decimal_field(document, "employee_contribution").unwrap_or(Decimal::ZERO);
    let employer_contribution =
        optional_decimal_field(document, "employer_contribution").unwrap_or(Decimal::ZERO);
    let optional_amount_fields = [
        "income_tax",
        "taxable_income",
        "contribution_base",
        "employee_contribution",
        "employer_contribution",
    ];
    if optional_amount_fields
        .iter()
        .any(|field| optional_decimal_field(document, field).is_none())
        || income_tax < Decimal::ZERO
        || taxable_income < Decimal::ZERO
        || taxable_income
            .checked_add(tolerance)
            .is_none_or(|maximum| income_tax > maximum)
        || contribution_base < Decimal::ZERO
        || employee_contribution < Decimal::ZERO
        || employer_contribution < Decimal::ZERO
        || income_tax
            .checked_add(employee_contribution)
            .is_none_or(|total| {
                deductions
                    .checked_add(tolerance)
                    .is_none_or(|maximum| total > maximum)
            })
    {
        errors.push("Payslip tax and contribution amounts must be finite and non-negative".into());
    }

    let salary_basis = decimal_field(document, "salary_basis");
    let additions = decimal_field(document, "additions");
    let paid_days = decimal_field(document, "paid_days");
    let working_days = decimal_field(document, "working_days");
    let overtime_hours =
        optional_decimal_field(document, "overtime_hours").unwrap_or(Decimal::ZERO);
    let overtime_pay = optional_decimal_field(document, "overtime_pay").unwrap_or(Decimal::ZERO);
    if !salary_basis.is_some_and(|amount| amount > Decimal::ZERO)
        || !additions.is_some_and(|amount| amount >= Decimal::ZERO)
        || !paid_days.is_some_and(|days| days >= Decimal::ZERO && days == days.round_dp(6))
        || !working_days.is_some_and(|days| {
            days.fract() == Decimal::ZERO
                && days > Decimal::ZERO
                && paid_days.is_some_and(|paid| paid <= days)
        })
        || optional_decimal_field(document, "overtime_hours").is_none()
        || overtime_hours < Decimal::ZERO
        || optional_decimal_field(document, "overtime_pay").is_none()
        || overtime_pay < Decimal::ZERO
        || paid_days.is_some_and(|days| days == Decimal::ZERO && overtime_hours <= Decimal::ZERO)
        || (overtime_hours == Decimal::ZERO && overtime_pay > tolerance)
    {
        errors.push(
            "Payslip must capture a positive salary basis and valid paid/working days".into(),
        );
    } else if let (Some(salary), Some(paid), Some(working), Some(additions), Some(gross)) =
        (salary_basis, paid_days, working_days, additions, gross)
    {
        let expected = salary
            .checked_mul(paid)
            .and_then(|amount| amount.checked_div(working))
            .map(|amount| amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
            .and_then(|amount| amount.checked_add(additions));
        if expected.is_none_or(|expected| {
            gross
                .checked_sub(expected)
                .is_none_or(|delta| delta.abs() > tolerance)
        }) {
            errors.push("Gross pay does not match the captured salary basis and paid days".into());
        }
    }
    if !additions.is_some_and(|amount| amount >= Decimal::ZERO) {
        errors.push("Payslip additions must be a finite non-negative amount".into());
    }
    if let Some(Value::Array(days)) = document.get("work_weekdays") {
        let unique: std::collections::HashSet<_> = days.iter().filter_map(Value::as_u64).collect();
        if days.is_empty()
            || days.len() > 7
            || unique.len() != days.len()
            || days
                .iter()
                .any(|day| !day.as_u64().is_some_and(|day| (1..=7).contains(&day)))
        {
            errors
                .push("Payslip work_weekdays must contain unique ISO weekdays from 1 to 7".into());
        }
    } else if document
        .get("work_weekdays")
        .is_some_and(|value| !value.is_null())
    {
        errors.push("Payslip work_weekdays must be a JSON array".into());
    }
    if document
        .get("standard_hours_per_day")
        .is_some_and(|value| !value.is_null())
        && !decimal_field(document, "standard_hours_per_day")
            .is_some_and(|hours| (Decimal::ONE..=Decimal::from(24)).contains(&hours))
    {
        errors.push("Payslip standard_hours_per_day must be between 1 and 24".into());
    }
    errors
}
