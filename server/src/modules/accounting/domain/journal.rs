use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn amount(document: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(document.get(field)?)
}

pub(super) fn validate_lines(document: &Value) -> Vec<String> {
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return vec!["Journal entry requires debit and credit lines".into()];
    };
    if lines.len() < 2 {
        return vec!["Journal entry requires at least two lines".into()];
    }
    let mut debit_total = Decimal::ZERO;
    let mut credit_total = Decimal::ZERO;
    let mut errors = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let n = index + 1;
        if line
            .get("account")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            errors.push(format!("lines[{n}].account is required"));
        }
        if line.get("department").is_some_and(|value| !value.is_null())
            && line
                .get("department")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_none()
        {
            errors.push(format!(
                "lines[{n}].department must be a valid department id"
            ));
        }
        let (Some(debit), Some(credit)) = (amount(line, "debit"), amount(line, "credit")) else {
            errors.push(format!("lines[{n}] has an invalid debit or credit amount"));
            continue;
        };
        if debit < Decimal::ZERO || credit < Decimal::ZERO {
            errors.push(format!(
                "lines[{n}] debit and credit amounts cannot be negative"
            ));
            continue;
        }
        if (debit > Decimal::ZERO) == (credit > Decimal::ZERO) {
            errors.push(format!(
                "lines[{n}] must contain exactly one debit or credit amount"
            ));
        }
        let Some(next_debit_total) = debit_total.checked_add(debit) else {
            errors.push("Journal debit total exceeds the supported decimal range".into());
            continue;
        };
        let Some(next_credit_total) = credit_total.checked_add(credit) else {
            errors.push("Journal credit total exceeds the supported decimal range".into());
            continue;
        };
        debit_total = next_debit_total;
        credit_total = next_credit_total;
    }
    if !crate::money::within_tolerance(debit_total, credit_total, Decimal::new(5, 3)) {
        errors.push("Total debits must equal total credits".into());
    }
    errors
}
