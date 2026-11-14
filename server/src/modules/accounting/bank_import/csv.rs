use super::model::{BankLine, parse_date, validation};
use crate::error::{ApiError, R};
use rust_decimal::Decimal;
use std::collections::HashMap;

fn column(headers: &HashMap<String, usize>, names: &[&str]) -> Option<usize> {
    names.iter().find_map(|name| headers.get(*name).copied())
}

fn parse_amount(value: &str) -> Option<Decimal> {
    let mut normalized = value.trim().replace([' ', '\u{00a0}', '\''], "");
    if normalized.is_empty() {
        return Some(Decimal::ZERO);
    }

    let (decimal, grouping) = match (normalized.contains('.'), normalized.contains(',')) {
        (true, true) => {
            let decimal = if normalized.rfind('.')? > normalized.rfind(',')? {
                '.'
            } else {
                ','
            };
            (Some(decimal), Some(if decimal == '.' { ',' } else { '.' }))
        }
        (true, false) => (Some('.'), None),
        (false, true) => (Some(','), None),
        (false, false) => (None, None),
    };

    if let Some(decimal) = decimal {
        let decimal_count = normalized.matches(decimal).count();
        if decimal_count > 1 {
            // Repeated same separators are thousands groups (e.g. 1.234.567).
            if grouping.is_some() || !valid_grouping(&normalized, decimal) {
                return None;
            }
            normalized = normalized.replace(decimal, "");
        } else {
            let split = normalized.rfind(decimal)?;
            let whole = &normalized[..split];
            let fraction = &normalized[split + decimal.len_utf8()..];
            if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            if let Some(grouping) = grouping {
                if !valid_grouping(whole, grouping) {
                    return None;
                }
                normalized = format!("{}.{}", whole.replace(grouping, ""), fraction);
            } else if fraction.len() == 3
                && !whole.is_empty()
                && whole.len() <= 3
                && whole.bytes().all(|byte| byte.is_ascii_digit())
            {
                // In bank exports, a single 3-digit suffix is a grouped integer.
                normalized = format!("{whole}{fraction}");
            } else if (1..=2).contains(&fraction.len())
                && whole.bytes().all(|byte| byte.is_ascii_digit())
            {
                normalized = format!("{whole}.{fraction}");
            } else {
                return None;
            }
        }
    }
    crate::money::decimal_str(&normalized)
        .map(crate::money::round_money)
        .filter(|amount| *amount >= Decimal::ZERO)
}

fn valid_grouping(value: &str, separator: char) -> bool {
    let groups = value.split(separator).collect::<Vec<_>>();
    !groups.is_empty()
        && (1..=3).contains(&groups[0].len())
        && groups[0].bytes().all(|byte| byte.is_ascii_digit())
        && groups[1..]
            .iter()
            .all(|group| group.len() == 3 && group.bytes().all(|byte| byte.is_ascii_digit()))
}

fn direction(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "credit" | "in" | "deposit" => Some("credit"),
        "debit" | "out" | "withdrawal" => Some("debit"),
        _ => None,
    }
}

fn detect_delimiter(header: &str) -> u8 {
    let mut counts = [(b',', 0_usize), (b';', 0), (b'\t', 0)];
    let mut quoted = false;
    let mut chars = header.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '"' {
            if quoted && chars.peek() == Some(&'"') {
                chars.next();
            } else {
                quoted = !quoted;
            }
        } else if !quoted {
            for (delimiter, count) in &mut counts {
                if character == char::from(*delimiter) {
                    *count += 1;
                }
            }
        }
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .filter(|(_, count)| *count > 0)
        .map(|(delimiter, _)| delimiter)
        .unwrap_or(b',')
}

pub(super) fn parse_csv(csv_text: &str) -> R<Vec<BankLine>> {
    let delimiter = detect_delimiter(csv_text.lines().next().unwrap_or_default());
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .trim(csv::Trim::All)
        .flexible(false)
        .from_reader(csv_text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| validation(format!("CSV header: {error}")))?
        .iter()
        .enumerate()
        .map(|(index, name)| {
            (
                name.trim()
                    .trim_start_matches('\u{feff}')
                    .to_ascii_lowercase(),
                index,
            )
        })
        .collect::<HashMap<_, _>>();
    let date_col = column(&headers, &["transaction_date", "date"])
        .ok_or_else(|| validation("CSV requires a transaction_date or date column"))?;
    let reference_col = column(&headers, &["reference", "ref", "transaction_id"]);
    let description_col = column(&headers, &["description", "memo", "details"]);
    let direction_col = column(&headers, &["direction", "type"]);
    let amount_col = column(&headers, &["amount"]);
    let debit_col = column(&headers, &["debit"]);
    let credit_col = column(&headers, &["credit"]);
    let signed_amount = amount_col.zip(direction_col);
    let split_amounts = debit_col.zip(credit_col);
    if signed_amount.is_none() && split_amounts.is_none() {
        return Err(validation(
            "CSV requires amount + direction, or both debit and credit columns",
        ));
    }

    let mut lines = Vec::new();
    for (index, row) in reader.records().enumerate() {
        let row_number = index + 2;
        let row = row.map_err(|error| validation(format!("CSV row {row_number}: {error}")))?;
        if row.iter().all(|field| field.trim().is_empty()) {
            continue;
        }
        if lines.len() >= 20_000 {
            return Err(ApiError::new(
                413,
                "TOO_MANY_ROWS",
                "A bank statement import is limited to 20,000 rows",
            ));
        }
        let get =
            |index: Option<usize>| index.and_then(|index| row.get(index)).unwrap_or("").trim();
        let date = parse_date(get(Some(date_col)))
            .ok_or_else(|| validation(format!("CSV row {row_number}: invalid transaction date")))?;
        let (direction, amount) = if let Some((amount_col, direction_col)) = signed_amount {
            let amount = parse_amount(get(Some(amount_col))).ok_or_else(|| {
                validation(format!(
                    "CSV row {row_number}: amount must be a nonnegative number"
                ))
            })?;
            let direction = direction(get(Some(direction_col))).ok_or_else(|| {
                validation(format!(
                    "CSV row {row_number}: direction must be credit/debit, in/out, or deposit/withdrawal"
                ))
            })?;
            (direction, amount)
        } else {
            let (debit_col, credit_col) = split_amounts.expect("validated split amount headers");
            let debit = parse_amount(get(Some(debit_col))).ok_or_else(|| {
                validation(format!("CSV row {row_number}: debit must be nonnegative"))
            })?;
            let credit = parse_amount(get(Some(credit_col))).ok_or_else(|| {
                validation(format!("CSV row {row_number}: credit must be nonnegative"))
            })?;
            if (debit > Decimal::ZERO) == (credit > Decimal::ZERO) {
                return Err(validation(format!(
                    "CSV row {row_number}: enter a positive amount in exactly one of debit or credit"
                )));
            }
            if debit > Decimal::ZERO {
                ("debit", debit)
            } else {
                ("credit", credit)
            }
        };
        if amount <= Decimal::ZERO {
            return Err(validation(format!(
                "CSV row {row_number}: amount must be greater than zero"
            )));
        }
        let description = get(description_col);
        if description.chars().count() > 1000 {
            return Err(validation(format!(
                "CSV row {row_number}: description is limited to 1,000 characters"
            )));
        }
        let reference = get(reference_col);
        if reference.chars().count() > 200 {
            return Err(validation(format!(
                "CSV row {row_number}: reference is limited to 200 characters"
            )));
        }
        lines.push(BankLine {
            row: row_number,
            date,
            reference: reference.to_owned(),
            description: (!description.is_empty()).then(|| description.to_owned()),
            direction,
            amount,
            currency: None,
        });
    }
    if lines.is_empty() {
        return Err(validation("CSV contains no transaction rows"));
    }
    Ok(lines)
}
