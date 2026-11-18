//! ISO 20022 CAMT.053 statement-file parser.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, parse_date, validation};
use crate::error::{ApiError, R};
use chrono::{DateTime, NaiveDate};
use roxmltree::{Document, Node, ParsingOptions};
use std::collections::HashSet;

const CAMT_NAMESPACE: &str = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.";
const MAX_XML_BYTES: usize = 5_000_000;
const MAX_XML_NODES: u32 = 1_000_000;
const MAX_ROWS: usize = 20_000;

fn child<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<Node<'a, 'input>> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == name)
}

fn child_text<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<&'a str> {
    child(node, name)?
        .text()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn descendant<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<Node<'a, 'input>> {
    node.descendants()
        .find(|child| child.is_element() && child.tag_name().name() == name)
}

fn descendant_text<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<&'a str> {
    descendant(node, name)?
        .text()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn date_in(container: Node<'_, '_>) -> Option<NaiveDate> {
    if let Some(date) = descendant_text(container, "Dt")
        && let Some(parsed) = parse_date(date)
    {
        return Some(parsed);
    }
    descendant_text(container, "DtTm")
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|date| date.date_naive())
}

fn entry_date(entry: Node<'_, '_>) -> Option<NaiveDate> {
    child(entry, "BookgDt")
        .and_then(date_in)
        .or_else(|| child(entry, "ValDt").and_then(date_in))
}

fn statement_nodes<'a, 'input>(node: Node<'a, 'input>) -> Vec<Node<'a, 'input>> {
    node.children()
        .filter(|child| child.is_element() && child.tag_name().name() == "Stmt")
        .collect()
}

pub(super) fn parse(xml: &str) -> R<ParsedBankStatement> {
    if xml.len() > MAX_XML_BYTES {
        return Err(ApiError::new(
            413,
            "CAMT_FILE_TOO_LARGE",
            "CAMT.053 files are limited to 5 MB",
        ));
    }
    let document = Document::parse_with_options(
        xml,
        ParsingOptions {
            nodes_limit: MAX_XML_NODES,
            ..ParsingOptions::default()
        },
    )
    .map_err(|error| validation(format!("Invalid CAMT.053 XML: {error}")))?;
    let root = document.root_element();
    let version = root
        .tag_name()
        .namespace()
        .and_then(|namespace| namespace.strip_prefix(CAMT_NAMESPACE))
        .and_then(|version| version.parse::<u8>().ok());
    if root.tag_name().name() != "Document"
        || !version.is_some_and(|version| (1..=14).contains(&version))
    {
        return Err(validation(
            "Expected an ISO 20022 CAMT.053.001.01 through CAMT.053.001.14 document",
        ));
    }
    let statement_messages = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "BkToCstmrStmt")
        .collect::<Vec<_>>();
    if statement_messages.len() != 1 {
        return Err(validation(
            "CAMT.053 must contain exactly one BkToCstmrStmt message",
        ));
    }
    let statement_message = statement_messages[0];
    let statements = statement_nodes(statement_message);
    if statements.len() != 1 {
        return Err(validation(
            "Import one CAMT.053 statement per bank statement record",
        ));
    }
    let statement = statements[0];
    let account = child(statement, "Acct")
        .ok_or_else(|| validation("CAMT.053 statement does not contain an account"))?;
    let identification = child(account, "Id").and_then(|id| {
        child(id, "IBAN")
            .and_then(|iban| iban.text())
            .map(|iban| (iban, true))
            .or_else(|| {
                child(id, "Othr")
                    .and_then(|other| child_text(other, "Id"))
                    .map(|other_id| (other_id, false))
            })
    });
    let (account_id, is_iban) = identification
        .map(|(value, is_iban)| (value.trim(), is_iban))
        .filter(|(value, _)| !value.is_empty())
        .ok_or_else(|| validation("CAMT.053 account identifier is missing"))?;
    if account_id.chars().count() > 128 || account_id.chars().any(char::is_control) {
        return Err(validation("CAMT.053 account identifier is invalid"));
    }
    let identity = if is_iban {
        BankAccountIdentity::Iban(account_id.to_owned())
    } else {
        BankAccountIdentity::AccountId(account_id.to_owned())
    };
    let account_currency = child_text(account, "Ccy").map(str::to_ascii_uppercase);
    let entries = statement
        .children()
        .filter(|node| node.is_element() && node.tag_name().name() == "Ntry")
        .collect::<Vec<_>>();
    if entries.len() > MAX_ROWS {
        return Err(ApiError::new(
            413,
            "TOO_MANY_ROWS",
            "A bank statement import is limited to 20,000 rows",
        ));
    }
    let mut lines = Vec::with_capacity(entries.len());
    for (index, entry) in entries.into_iter().enumerate() {
        let row = index + 1;
        if let Some(status) = child(entry, "Sts")
            && let Some(code) =
                descendant_text(status, "Cd").or_else(|| descendant_text(status, "Prtry"))
            && code != "BOOK"
        {
            return Err(validation(format!(
                "CAMT.053 entry {row}: only booked entries can be imported"
            )));
        }
        let amount_node = child(entry, "Amt")
            .ok_or_else(|| validation(format!("CAMT.053 entry {row}: missing amount")))?;
        let currency = if let Some(raw_currency) = amount_node.attribute("Ccy") {
            let currency = raw_currency.to_ascii_uppercase();
            if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
                return Err(validation(format!(
                    "CAMT.053 entry {row}: invalid ISO currency code"
                )));
            }
            currency
        } else {
            account_currency.clone().ok_or_else(|| {
                validation(format!("CAMT.053 entry {row}: missing ISO currency code"))
            })?
        };
        if account_currency
            .as_deref()
            .is_some_and(|account_currency| account_currency != currency)
        {
            return Err(validation(format!(
                "CAMT.053 entry {row}: entry currency differs from account currency"
            )));
        }
        let amount = amount_node
            .text()
            .and_then(crate::money::decimal_str)
            .map(crate::money::round_money)
            .filter(|amount| *amount > rust_decimal::Decimal::ZERO)
            .ok_or_else(|| {
                validation(format!(
                    "CAMT.053 entry {row}: amount must be greater than zero"
                ))
            })?;
        let direction = match child_text(entry, "CdtDbtInd") {
            Some("CRDT") => "credit",
            Some("DBIT") => "debit",
            _ => {
                return Err(validation(format!(
                    "CAMT.053 entry {row}: CdtDbtInd must be CRDT or DBIT"
                )));
            }
        };
        let date = entry_date(entry)
            .ok_or_else(|| validation(format!("CAMT.053 entry {row}: missing booked date")))?;
        let reference = child_text(entry, "AcctSvcrRef")
            .or_else(|| child_text(entry, "NtryRef"))
            .or_else(|| descendant_text(entry, "EndToEndId"))
            .or_else(|| descendant_text(entry, "TxId"))
            .filter(|reference| *reference != "NOTPROVIDED")
            .unwrap_or_default()
            .to_owned();
        if reference.chars().count() > 200 {
            return Err(validation(format!(
                "CAMT.053 entry {row}: reference is limited to 200 characters"
            )));
        }
        let mut seen_descriptions = HashSet::new();
        let description_parts = entry
            .descendants()
            .filter(|node| {
                node.is_element() && matches!(node.tag_name().name(), "AddtlNtryInf" | "Ustrd")
            })
            .filter_map(|node| node.text().map(str::trim))
            .filter(|text| !text.is_empty() && seen_descriptions.insert((*text).to_owned()))
            .collect::<Vec<_>>();
        let description = description_parts.join(" · ");
        if description.chars().count() > 1000 {
            return Err(validation(format!(
                "CAMT.053 entry {row}: description is limited to 1,000 characters"
            )));
        }
        lines.push(BankLine {
            row,
            date,
            reference,
            description: (!description.is_empty()).then_some(description),
            direction,
            amount,
            currency: Some(currency),
        });
    }
    if lines.is_empty() {
        return Err(validation(
            "CAMT.053 contains no booked transaction entries",
        ));
    }
    Ok(ParsedBankStatement { identity, lines })
}
