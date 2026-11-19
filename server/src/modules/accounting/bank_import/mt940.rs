//! SWIFT MT940 customer statement text import.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, validation};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;

const MAX_ROWS: usize = 20_000;
const MAX_INPUT_BYTES: usize = 5_000_000;

#[derive(Default)]
struct Entry {
    tag: String,
    value: String,
}

pub(super) fn parse(input: &str) -> Result<ParsedBankStatement, crate::error::ApiError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(validation("MT940 statement exceeds the 5 MB limit"));
    }
    let mut fields = Vec::<Entry>::new();
    let mut current: Option<usize> = None;
    for raw_line in input.trim_start_matches('\u{feff}').lines() {
        let line = raw_line.trim_end_matches('\r').trim();
        if line.is_empty()
            || line == "-}"
            || line.starts_with("{1:")
            || line.starts_with("{2:")
            || line.starts_with("{3:")
            || line == "{4:"
        {
            continue;
        }
        if let Some(rest) = line.strip_prefix(':')
            && let Some((tag, value)) = rest.split_once(':')
            && valid_tag(tag)
        {
            if matches!(
                tag,
                "20" | "21" | "25" | "28C" | "60F" | "60M" | "61" | "62F" | "62M" | "64" | "86"
            ) {
                fields.push(Entry {
                    tag: tag.to_owned(),
                    value: value.to_owned(),
                });
                current = Some(fields.len() - 1);
                continue;
            }
            current = None;
            continue;
        }
        if let Some(index) = current {
            let entry = &mut fields[index];
            if entry.value.len() + line.len() + 1 > 4_000 {
                return Err(validation(format!(
                    "MT940 field :{}: exceeds the supported length",
                    entry.tag
                )));
            }
            if !entry.value.is_empty() {
                entry.value.push(' ');
            }
            entry.value.push_str(line);
        }
    }

    let values = |tag: &str| {
        fields
            .iter()
            .filter(|entry| entry.tag == tag)
            .map(|entry| entry.value.trim())
            .collect::<Vec<_>>()
    };
    let reference = one_required(&values("20"), "transaction reference :20:")?;
    let account = one_required(&values("25"), "account identification :25:")?;
    let statement_number = one_required(&values("28C"), "statement number :28C:")?;
    let opening = one_required(
        &balance_values(&fields, true),
        "opening balance :60F: or :60M:",
    )?;
    let closing = one_required(
        &balance_values(&fields, false),
        "closing balance :62F: or :62M:",
    )?;
    let (currency, _) = parse_balance(opening, "opening balance")?;
    let (closing_currency, _) = parse_balance(closing, "closing balance")?;
    if currency != closing_currency {
        return Err(validation(
            "MT940 opening and closing balance currencies do not match",
        ));
    }
    if reference.is_empty() || reference.len() > 16 || statement_number.is_empty() {
        return Err(validation("MT940 statement reference or number is invalid"));
    }
    let account = account.strip_prefix('/').unwrap_or(account).trim();
    if account.is_empty() || account.len() > 128 || account.chars().any(char::is_control) {
        return Err(validation("MT940 account identification is invalid"));
    }
    let identity = if looks_like_iban(account) {
        BankAccountIdentity::Iban(account.to_ascii_uppercase())
    } else {
        BankAccountIdentity::AccountId(account.to_owned())
    };

    let transactions = fields
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.tag == "61")
        .collect::<Vec<_>>();
    if transactions.is_empty() {
        return Err(validation("MT940 statement contains no :61: transactions"));
    }
    if transactions.len() > MAX_ROWS {
        return Err(validation(format!(
            "MT940 statement exceeds the {MAX_ROWS} transaction limit"
        )));
    }
    let mut lines = Vec::with_capacity(transactions.len());
    for (row_index, (field_index, transaction)) in transactions.iter().enumerate() {
        let row = row_index + 1;
        let (value_date, entry_date, direction, amount, bank_reference) =
            parse_transaction(&transaction.value)
                .map_err(|message| validation(format!("MT940 transaction {row}: {message}")))?;
        let date = entry_date.unwrap_or(value_date);
        let description = fields
            .iter()
            .skip(field_index + 1)
            .take_while(|entry| entry.tag != "61")
            .find(|entry| entry.tag == "86")
            .map(|entry| entry.value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if description.as_ref().is_some_and(|value| {
            value.chars().count() > 1_000 || value.chars().any(char::is_control)
        }) {
            return Err(validation(format!(
                "MT940 transaction {row}: description is invalid or exceeds 1,000 characters"
            )));
        }
        let stable_reference = bank_reference
            .filter(|value| !value.is_empty())
            .map(|value| format!("MT940:{value}"))
            .unwrap_or_else(|| format!("MT940:{reference}:{statement_number}:{row}"));
        if stable_reference.len() > 160 || stable_reference.chars().any(char::is_control) {
            return Err(validation(format!(
                "MT940 transaction {row}: bank reference is invalid"
            )));
        }
        lines.push(BankLine {
            row,
            date,
            reference: stable_reference,
            description,
            direction,
            amount,
            currency: Some(currency.clone()),
        });
    }
    Ok(ParsedBankStatement { identity, lines })
}

fn valid_tag(tag: &str) -> bool {
    let bytes = tag.as_bytes();
    (bytes.len() == 2 && bytes.iter().all(u8::is_ascii_digit))
        || (bytes.len() == 3
            && bytes[..2].iter().all(u8::is_ascii_digit)
            && bytes[2].is_ascii_uppercase())
}

fn balance_values<'a>(fields: &'a [Entry], opening: bool) -> Vec<&'a str> {
    let tags: &[&str] = if opening {
        &["60F", "60M"]
    } else {
        &["62F", "62M"]
    };
    fields
        .iter()
        .filter(|entry| tags.contains(&entry.tag.as_str()))
        .map(|entry| entry.value.trim())
        .collect()
}

fn one_required<'a>(values: &[&'a str], label: &str) -> Result<&'a str, crate::error::ApiError> {
    if values.len() != 1 || values[0].is_empty() {
        return Err(validation(format!("MT940 requires exactly one {label}")));
    }
    Ok(values[0])
}

fn parse_balance(value: &str, label: &str) -> Result<(String, Decimal), crate::error::ApiError> {
    let bytes = value.as_bytes();
    if !value.is_ascii() || bytes.len() < 11 || !matches!(bytes[0], b'C' | b'D') {
        return Err(validation(format!("MT940 {label} is invalid")));
    }
    parse_swift_date(&value[1..7])
        .map_err(|_| validation(format!("MT940 {label} has an invalid date")))?;
    let currency = &value[7..10];
    if !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(validation(format!("MT940 {label} has an invalid currency")));
    }
    let amount = parse_amount(&value[10..])
        .map_err(|_| validation(format!("MT940 {label} has an invalid amount")))?;
    Ok((currency.to_owned(), amount))
}

fn parse_transaction(
    value: &str,
) -> Result<
    (
        NaiveDate,
        Option<NaiveDate>,
        &'static str,
        Decimal,
        Option<String>,
    ),
    String,
> {
    if !value.is_ascii() {
        return Err("transaction fields must be ASCII".into());
    }
    let bytes = value.as_bytes();
    if bytes.len() < 12 || !bytes[..6].iter().all(u8::is_ascii_digit) {
        return Err("invalid value date or transaction format".into());
    }
    let value_date = parse_swift_date(&value[..6]).map_err(|_| "invalid value date")?;
    let mut cursor = 6;
    let entry_date = if bytes
        .get(cursor..cursor + 4)
        .is_some_and(|part| part.len() == 4 && part.iter().all(u8::is_ascii_digit))
    {
        let raw = &value[cursor..cursor + 4];
        cursor += 4;
        Some(parse_entry_date(raw, value_date).map_err(|_| "invalid entry date")?)
    } else {
        None
    };
    let first = *bytes.get(cursor).ok_or("missing debit/credit indicator")?;
    let (direction, indicator_len) = match first {
        b'C' => ("credit", 1),
        b'D' => ("debit", 1),
        b'R' | b'E' | b'F' | b'L' => match bytes.get(cursor + 1) {
            Some(b'C') => ("credit", 2),
            Some(b'D') => ("debit", 2),
            _ => return Err("invalid debit/credit indicator".into()),
        },
        _ => return Err("invalid debit/credit indicator".into()),
    };
    cursor += indicator_len;
    // MT940 permits an optional one-letter funds code between the debit/credit
    // indicator and the amount (for example, `CUSD123,45`).
    if bytes.get(cursor).is_some_and(u8::is_ascii_alphabetic) {
        cursor += 1;
    }
    let amount_end = value[cursor..]
        .find(|character: char| character.is_ascii_alphabetic())
        .map(|offset| cursor + offset)
        .ok_or("missing transaction type code")?;
    let amount = parse_amount(&value[cursor..amount_end]).map_err(|_| "invalid amount")?;
    if amount <= Decimal::ZERO {
        return Err("amount must be positive".into());
    }
    cursor = amount_end;
    if value.len() < cursor + 4 {
        return Err("transaction type code is incomplete".into());
    }
    cursor += 4;
    let rest = value[cursor..].trim();
    let bank_reference = rest
        .split_once("//")
        .map(|(_, reference)| reference.trim())
        .filter(|reference| !reference.is_empty())
        .map(str::to_owned);
    Ok((value_date, entry_date, direction, amount, bank_reference))
}

fn parse_amount(value: &str) -> Result<Decimal, ()> {
    let normalized = value.trim().replace(',', ".");
    if normalized.is_empty()
        || normalized.matches('.').count() > 1
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return Err(());
    }
    normalized.parse().map_err(|_| ())
}

fn parse_swift_date(value: &str) -> Result<NaiveDate, ()> {
    if value.len() != 6 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    let short_year = value[..2].parse::<i32>().map_err(|_| ())?;
    let year = if short_year >= 70 {
        1900 + short_year
    } else {
        2000 + short_year
    };
    let date = format!("{year}{}", &value[2..]);
    NaiveDate::parse_from_str(&date, "%Y%m%d").map_err(|_| ())
}

fn parse_entry_date(value: &str, value_date: NaiveDate) -> Result<NaiveDate, ()> {
    if value.len() != 4 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    let year = value_date.year();
    let date = NaiveDate::parse_from_str(&format!("{year}{value}"), "%Y%m%d").map_err(|_| ())?;
    if date.signed_duration_since(value_date).num_days() > 183 {
        NaiveDate::from_ymd_opt(year - 1, date.month(), date.day()).ok_or(())
    } else if value_date.signed_duration_since(date).num_days() > 183 {
        NaiveDate::from_ymd_opt(year + 1, date.month(), date.day()).ok_or(())
    } else {
        Ok(date)
    }
}

fn looks_like_iban(account: &str) -> bool {
    let bytes = account.as_bytes();
    (15..=34).contains(&bytes.len())
        && bytes[0].is_ascii_uppercase()
        && bytes[1].is_ascii_uppercase()
        && bytes[2..].iter().all(u8::is_ascii_alphanumeric)
}
