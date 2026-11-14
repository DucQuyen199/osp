//! Payroll policy and record invariants.
use super::*;
pub(super) fn valid_period(period: &str) -> bool {
    period.len() == 7
        && period
            .as_bytes()
            .get(0..4)
            .is_some_and(|year| year.iter().all(u8::is_ascii_digit))
        && period.as_bytes().get(4) == Some(&b'-')
        && period
            .get(5..7)
            .and_then(|month| month.parse::<u32>().ok())
            .is_some_and(|month| (1..=12).contains(&month))
}

pub(super) fn validate_tax_policy(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let from = document
        .get("effective_from")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let to = document
        .get("effective_to")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    if from.is_none() || from.is_some_and(|date| date.day() != 1) {
        errors.push("Payroll tax policy must start on the first day of a month".into());
    }
    if let (Some(from), Some(to)) = (from, to)
        && to < from
    {
        errors.push("Payroll tax policy end date cannot precede its effective date".into());
    }
    for field in ["personal_allowance", "dependent_allowance"] {
        if !decimal_field(document, field).is_some_and(|amount| amount >= Decimal::ZERO) {
            errors.push(format!("{field} must be non-negative"));
        }
    }
    if !decimal_field(document, "rounding_unit").is_some_and(|unit| unit > Decimal::ZERO) {
        errors.push("Tax rounding_unit must be greater than zero".into());
    }
    if !decimal_field(document, "nonresident_rate")
        .is_some_and(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate))
    {
        errors.push("nonresident_rate must be between 0 and 100 percent".into());
    }
    if document
        .get("tax_account")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        errors.push("Payroll tax policy requires a tax liability account".into());
    }
    let bands = document.get("resident_brackets").and_then(Value::as_array);
    match bands {
        Some(bands) if !bands.is_empty() => {
            let mut prior_upper = Decimal::ZERO;
            for (index, band) in bands.iter().enumerate() {
                let rate = band.get("rate").and_then(crate::money::decimal);
                if !rate.is_some_and(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate))
                {
                    errors.push(format!(
                        "Resident tax bracket {} has an invalid rate",
                        index + 1
                    ));
                }
                let upper = match band.get("upper") {
                    Some(Value::Null) | None => None,
                    Some(value) => crate::money::decimal(value),
                };
                match upper {
                    Some(upper) if upper > prior_upper => prior_upper = upper,
                    None if index + 1 == bands.len() => {}
                    _ => errors.push(format!(
                        "Resident tax bracket {} must have an increasing upper bound; only the last bracket may be unbounded",
                        index + 1
                    )),
                }
            }
            if bands
                .last()
                .is_some_and(|band| band.get("upper").is_some_and(|upper| !upper.is_null()))
            {
                errors.push("The final resident tax bracket must have upper set to null".into());
            }
        }
        _ => errors.push("resident_brackets must be a non-empty ordered JSON array".into()),
    }
    errors
}
pub(super) fn validate_contribution_policy(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let from = document
        .get("effective_from")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let to = document
        .get("effective_to")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    if from.is_none() || from.is_some_and(|date| date.day() != 1) {
        errors.push("Payroll contribution policy must start on the first day of a month".into());
    }
    if let (Some(from), Some(to)) = (from, to)
        && to < from
    {
        errors
            .push("Payroll contribution policy end date cannot precede its effective date".into());
    }
    if !matches!(
        document.get("basis").and_then(Value::as_str),
        Some("salary" | "gross")
    ) {
        errors.push("Contribution basis must be salary or gross".into());
    }
    for field in ["employee_rate", "employer_rate"] {
        if !decimal_field(document, field)
            .is_some_and(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate))
        {
            errors.push(format!("{field} must be between 0 and 100 percent"));
        }
    }
    if document
        .get("monthly_base_cap")
        .is_some_and(|cap| !cap.is_null())
        && !decimal_field(document, "monthly_base_cap").is_some_and(|cap| cap > Decimal::ZERO)
    {
        errors.push("monthly_base_cap must be empty or positive".into());
    }
    for field in ["liability_account", "employer_expense_account"] {
        if document
            .get(field)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            errors.push(format!("Contribution policy requires {field}"));
        }
    }
    errors
}
pub(super) fn validate_adjustment(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if !document
        .get("period")
        .and_then(Value::as_str)
        .is_some_and(valid_period)
    {
        errors.push("Payroll adjustment period must use YYYY-MM format".into());
    }
    if !matches!(
        document.get("kind").and_then(Value::as_str),
        Some("addition" | "deduction")
    ) {
        errors.push("Payroll adjustment kind must be addition or deduction".into());
    }
    if !decimal_field(document, "amount").is_some_and(|amount| amount > Decimal::ZERO) {
        errors.push("Payroll adjustment amount must be greater than zero".into());
    }
    if document.get("kind").and_then(Value::as_str) == Some("deduction")
        && document.get("account").and_then(Value::as_str).is_none()
    {
        errors
            .push("Payroll deductions require an asset or liability account for accounting".into());
    } else if document.get("kind").and_then(Value::as_str) == Some("addition")
        && document
            .get("account")
            .is_some_and(|account| !account.is_null())
    {
        errors.push("Payroll addition account is determined by the payroll expense policy".into());
    }
    if document.get("kind").and_then(Value::as_str) == Some("deduction")
        && document.get("taxable").and_then(Value::as_bool) == Some(false)
    {
        errors.push("The taxable flag applies to additions, not payroll deductions".into());
    }
    if document
        .get("reason")
        .and_then(Value::as_str)
        .is_some_and(|reason| reason.trim().is_empty())
    {
        errors.push("Payroll adjustment requires a reason".into());
    }
    errors
}
pub(super) fn validate_overtime_entry(document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if document
        .get("date")
        .and_then(Value::as_str)
        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        .is_none()
    {
        errors.push("Overtime entry requires a valid date".into());
    }
    if !decimal_field(document, "hours")
        .is_some_and(|hours| hours > Decimal::ZERO && hours <= Decimal::from(24))
    {
        errors.push("Overtime hours must be greater than zero and at most 24".into());
    }
    if !decimal_field(document, "multiplier")
        .is_some_and(|multiplier| (Decimal::ONE..=Decimal::from(5)).contains(&multiplier))
    {
        errors.push("Overtime multiplier must be between 1 and 5".into());
    }
    if document
        .get("employee")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        errors.push("Overtime entry requires an employee".into());
    }
    if document
        .get("reason")
        .and_then(Value::as_str)
        .is_none_or(|reason| reason.trim().is_empty())
    {
        errors.push("Overtime entry requires a reason".into());
    }
    errors
}
pub(super) fn validate_contribution_remittance(
    document: &Value,
    requires_payment: bool,
) -> Vec<String> {
    let mut errors = Vec::new();
    if !document
        .get("period")
        .and_then(Value::as_str)
        .is_some_and(valid_period)
    {
        errors.push("Contribution remittance period must use YYYY-MM format".into());
    }
    if document
        .get("policy")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        errors.push("Contribution remittance requires a policy".into());
    }
    if !decimal_field(document, "amount").is_some_and(|amount| amount > Decimal::ZERO) {
        errors.push("Contribution remittance amount must be positive".into());
    }
    if let Some(method) = document.get("payment_method").and_then(Value::as_str)
        && !matches!(method, "cash" | "bank")
    {
        errors.push("Contribution remittance payment method must be cash or bank".into());
    }
    if let Some(date) = document.get("payment_date").and_then(Value::as_str)
        && chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
    {
        errors.push("Contribution remittance payment date must be a valid date".into());
    }
    if requires_payment {
        if !matches!(
            document.get("payment_method").and_then(Value::as_str),
            Some("cash" | "bank")
        ) {
            errors.push("Contribution remittance requires a cash or bank payment method".into());
        }
        if document
            .get("payment_date")
            .and_then(Value::as_str)
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
            .is_none()
        {
            errors.push("Contribution remittance requires a valid payment date".into());
        }
    }
    errors
}
