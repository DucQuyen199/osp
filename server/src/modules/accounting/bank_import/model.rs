use crate::error::ApiError;
use chrono::NaiveDate;
use rust_decimal::Decimal;

#[derive(Clone)]
pub(super) struct BankLine {
    pub(super) row: usize,
    pub(super) date: NaiveDate,
    pub(super) reference: String,
    pub(super) description: Option<String>,
    pub(super) direction: &'static str,
    pub(super) amount: Decimal,
    pub(super) currency: Option<String>,
}

#[derive(Clone)]
pub(super) enum BankAccountIdentity {
    AccountId(String),
    Iban(String),
    Casso(String),
}

pub(super) struct ParsedBankStatement {
    pub(super) identity: BankAccountIdentity,
    pub(super) lines: Vec<BankLine>,
}

pub(super) fn validation(message: impl Into<String>) -> ApiError {
    ApiError::validation("accounting.bank_statement_line", vec![message.into()])
}

pub(super) fn parse_date(value: &str) -> Option<NaiveDate> {
    ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"]
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(value.trim(), format).ok())
}
