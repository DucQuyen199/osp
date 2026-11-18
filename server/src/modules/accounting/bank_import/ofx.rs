//! OFX/QFX bank statement parser for 1.x SGML and 2.x XML files.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, validation};
use crate::{
    error::{ApiError, R},
    money,
};
use chrono::NaiveDate;

const MAX_FILE_BYTES: usize = 5_000_000;
const MAX_ROWS: usize = 20_000;

fn tag_value<'a>(input: &'a str, tag: &str) -> Option<&'a str> {
    let opening = format!("<{tag}>");
    let upper = input.to_ascii_uppercase();
    let start = upper.find(&opening.to_ascii_uppercase())? + opening.len();
    let rest = &input[start..];
    let upper_rest = &upper[start..];
    let end = upper_rest
        .find(&format!("</{tag}>").to_ascii_uppercase())
        .or_else(|| upper_rest.find('<'))
        .unwrap_or(rest.len());
    let value = rest[..end].trim();
    (!value.is_empty()).then_some(value)
}

fn ofx_date(value: &str) -> Option<NaiveDate> {
    let digits = value.trim().get(..8)?;
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    NaiveDate::parse_from_str(digits, "%Y%m%d").ok()
}

fn clean_text(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .trim()
        .to_owned()
}

pub(super) fn parse(input: &str) -> R<ParsedBankStatement> {
    if input.len() > MAX_FILE_BYTES {
        return Err(ApiError::new(
            413,
            "OFX_FILE_TOO_LARGE",
            "OFX/QFX files are limited to 5 MB",
        ));
    }
    let upper = input.to_ascii_uppercase();
    if !upper.contains("<OFX>") {
        return Err(validation(
            "Expected an OFX or QFX statement containing an OFX document",
        ));
    }
    let account_tag = "<BANKACCTFROM>";
    let account_start = upper
        .find(account_tag)
        .map(|index| index + account_tag.len())
        .ok_or_else(|| validation("OFX statement does not contain a bank account"))?;
    let account_end = upper[account_start..]
        .find("</BANKACCTFROM>")
        .map(|index| account_start + index)
        .unwrap_or(input.len());
    let account = &input[account_start..account_end];
    let account_id = tag_value(account, "ACCTID")
        .ok_or_else(|| validation("OFX bank account identifier is missing"))?;
    if account_id.chars().count() > 128 || account_id.chars().any(char::is_control) {
        return Err(validation("OFX bank account identifier is invalid"));
    }
    let identity = BankAccountIdentity::AccountId(clean_text(account_id));
    let currency = tag_value(input, "CURDEF")
        .map(str::to_ascii_uppercase)
        .map(|value| {
            if value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase()) {
                Ok(value)
            } else {
                Err(validation("OFX statement has an invalid ISO currency code"))
            }
        })
        .transpose()?;
    let transactions = upper
        .match_indices("<STMTTRN>")
        .map(|(start, _)| {
            let block_start = start + "<STMTTRN>".len();
            let rest = &input[block_start..];
            let upper_rest = &upper[block_start..];
            let end = upper_rest
                .find("</STMTTRN>")
                .or_else(|| upper_rest.find("<STMTTRN>"))
                .unwrap_or(rest.len());
            &rest[..end]
        })
        .collect::<Vec<_>>();
    if transactions.is_empty() {
        return Err(validation("OFX statement contains no bank transactions"));
    }
    if transactions.len() > MAX_ROWS {
        return Err(ApiError::new(
            413,
            "TOO_MANY_ROWS",
            "A bank statement import is limited to 20,000 rows",
        ));
    }
    let mut lines = Vec::with_capacity(transactions.len());
    for (index, transaction) in transactions.into_iter().enumerate() {
        let row = index + 1;
        let amount = tag_value(transaction, "TRNAMT")
            .and_then(money::decimal_str)
            .map(money::round_money)
            .filter(|amount| !amount.is_zero())
            .ok_or_else(|| {
                validation(format!(
                    "OFX transaction {row}: amount must be a valid non-zero number"
                ))
            })?;
        let direction = if amount.is_sign_positive() {
            "credit"
        } else {
            "debit"
        };
        let date = tag_value(transaction, "DTPOSTED")
            .and_then(ofx_date)
            .ok_or_else(|| {
                validation(format!(
                    "OFX transaction {row}: posted date is missing or invalid"
                ))
            })?;
        let reference = tag_value(transaction, "FITID")
            .map(clean_text)
            .unwrap_or_default();
        if reference.chars().count() > 200 {
            return Err(validation(format!(
                "OFX transaction {row}: reference is limited to 200 characters"
            )));
        }
        let mut description = [
            tag_value(transaction, "NAME"),
            tag_value(transaction, "MEMO"),
        ]
        .into_iter()
        .flatten()
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
        description.dedup();
        let description = description.join(" · ");
        if description.chars().count() > 1000 {
            return Err(validation(format!(
                "OFX transaction {row}: description is limited to 1,000 characters"
            )));
        }
        lines.push(BankLine {
            row,
            date,
            reference,
            description: (!description.is_empty()).then_some(description),
            direction,
            amount: amount.abs(),
            currency: currency.clone(),
        });
    }
    Ok(ParsedBankStatement { identity, lines })
}
