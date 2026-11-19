//! SePay API v2 bank transaction pull adapter.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, validation};
use crate::{
    error::{ApiError, R},
    money,
};
use chrono::{NaiveDate, NaiveDateTime};
use reqwest::{Client, StatusCode, redirect::Policy};
use rust_decimal::Decimal;
use serde_json::Value;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 2_000_000;
const PAGE_SIZE: u32 = 100;
const MAX_PAGES: u64 = 200;

pub(super) async fn fetch(
    config: &Value,
    from: NaiveDate,
    to: NaiveDate,
    expected_account_number: &str,
) -> R<ParsedBankStatement> {
    let token = config
        .get("api_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("SePay connector is missing api_token"))?;
    let provider_account_id = config
        .get("bank_account_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("SePay connector is missing bank_account_id"))?;
    let root = match config.get("environment").and_then(Value::as_str) {
        Some("sandbox") => "https://userapi-sandbox.sepay.vn/v2",
        Some("production") => "https://userapi.sepay.vn/v2",
        _ => {
            return Err(validation(
                "SePay environment must be sandbox or production",
            ));
        }
    };
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ApiError::internal("Cannot build SePay API client"))?;

    let mut records = Vec::new();
    let mut last_page = None;
    for page in 1..=MAX_PAGES {
        let response = client
            .get(format!("{root}/transactions"))
            .bearer_auth(token)
            .query(&[
                ("bank_account_id", provider_account_id),
                ("transaction_date_from", &format!("{} 00:00:00", from)),
                ("transaction_date_to", &format!("{} 23:59:59", to)),
                ("transaction_date_sort", "asc"),
                ("page", &page.to_string()),
                ("per_page", &PAGE_SIZE.to_string()),
            ])
            .send()
            .await
            .map_err(|_| provider_unavailable())?;
        let body = read_body(response, "SePay transaction endpoint").await?;
        let payload: Value = serde_json::from_slice(&body)
            .map_err(|_| provider_response("SePay transaction endpoint returned invalid JSON"))?;
        if payload.get("status").and_then(Value::as_str) != Some("success") {
            return Err(provider_response("SePay rejected the transaction query"));
        }
        let page_records = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| provider_response("SePay transaction response is missing data"))?;
        let page_meta = payload.pointer("/meta/pagination").ok_or_else(|| {
            provider_response("SePay transaction response is missing pagination metadata")
        })?;
        let current = page_meta
            .get("current_page")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                provider_response("SePay pagination metadata is missing current_page")
            })?;
        let pages = page_meta
            .get("last_page")
            .and_then(Value::as_u64)
            .ok_or_else(|| provider_response("SePay pagination metadata is missing last_page"))?;
        if current != page || pages > MAX_PAGES {
            return Err(ApiError::new(
                422,
                "BANK_FEED_PAGE_LIMIT",
                format!(
                    "SePay returned {pages} pages; the limit is {MAX_PAGES}. Sync a shorter date range."
                ),
            ));
        }
        if let Some(prior) = last_page
            && prior != pages
        {
            return Err(provider_response(
                "SePay pagination changed while fetching; retry the sync",
            ));
        }
        last_page = Some(pages);
        if records.len().saturating_add(page_records.len())
            > (PAGE_SIZE as usize * MAX_PAGES as usize)
        {
            return Err(ApiError::new(
                413,
                "TOO_MANY_ROWS",
                "SePay sync is limited to 20,000 transactions",
            ));
        }
        records.extend(page_records.iter().cloned());
        if page >= pages || pages == 0 {
            break;
        }
    }

    let expected_number = expected_account_number.trim();
    let mut lines = Vec::with_capacity(records.len());
    for (index, record) in records.iter().enumerate() {
        let row = index + 1;
        let record_account_id = record
            .get("bank_account_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                validation(format!(
                    "SePay transaction {row}: bank_account_id is missing"
                ))
            })?;
        if record_account_id != provider_account_id {
            return Err(validation(format!(
                "SePay transaction {row}: bank account UUID does not match the connector"
            )));
        }
        let account_number = record
            .get("account_number")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                validation(format!(
                    "SePay transaction {row}: account_number is missing"
                ))
            })?;
        if account_number.trim() != expected_number {
            return Err(validation(format!(
                "SePay transaction {row}: account number does not match the selected ledger account"
            )));
        }
        let id = record
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                validation(format!(
                    "SePay transaction {row}: stable transaction id is missing"
                ))
            })?;
        if id.len() > 160 || id.chars().any(char::is_control) {
            return Err(validation(format!(
                "SePay transaction {row}: invalid transaction id"
            )));
        }
        let date_text = record
            .get("transaction_date")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                validation(format!(
                    "SePay transaction {row}: transaction_date is missing"
                ))
            })?;
        let date = NaiveDateTime::parse_from_str(date_text, "%Y-%m-%d %H:%M:%S")
            .map(|value| value.date())
            .or_else(|_| NaiveDate::parse_from_str(date_text, "%Y-%m-%d"))
            .map_err(|_| {
                validation(format!("SePay transaction {row}: invalid transaction_date"))
            })?;
        if date < from || date > to {
            return Err(validation(format!(
                "SePay transaction {row}: date is outside the requested statement period"
            )));
        }
        let amount_in = record
            .get("amount_in")
            .map(value_as_decimal)
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let amount_out = record
            .get("amount_out")
            .map(value_as_decimal)
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        if amount_in < Decimal::ZERO
            || amount_out < Decimal::ZERO
            || (amount_in.is_zero() == amount_out.is_zero())
        {
            return Err(validation(format!(
                "SePay transaction {row}: exactly one of amount_in or amount_out must be positive"
            )));
        }
        let direction_field = record.get("transfer_type").and_then(Value::as_str);
        let (direction, amount) = if amount_in > Decimal::ZERO {
            ("credit", amount_in)
        } else {
            ("debit", amount_out)
        };
        if direction_field
            .is_some_and(|value| !matches!((value, direction), ("in", "credit") | ("out", "debit")))
        {
            return Err(validation(format!(
                "SePay transaction {row}: transfer_type conflicts with transaction amount"
            )));
        }
        if amount > Decimal::new(999_999_999_999_999_999, 4) {
            return Err(validation(format!(
                "SePay transaction {row}: amount exceeds supported financial range"
            )));
        }
        let description = record
            .get("transaction_content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        {
            return Err(validation(format!(
                "SePay transaction {row}: transaction_content exceeds 1,000 characters"
            )));
        }
        lines.push(BankLine {
            row,
            date,
            reference: format!("SEPAY:{id}"),
            description,
            direction,
            amount,
            // Currency is supplied by the connector's explicit account setting.
            // SePay transaction payloads do not include a currency field.
            currency: None,
        });
    }
    Ok(ParsedBankStatement {
        identity: BankAccountIdentity::AccountId(expected_number.to_owned()),
        lines,
    })
}

fn value_as_decimal(value: &Value) -> R<Decimal> {
    let raw = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_number().map(ToString::to_string))
        .ok_or_else(|| validation("SePay transaction amount must be a number"))?;
    money::decimal_str(&raw).ok_or_else(|| validation("SePay transaction amount is invalid"))
}

async fn read_body(response: reqwest::Response, endpoint: &str) -> R<Vec<u8>> {
    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .filter(|value| value.bytes().all(|byte| byte.is_ascii_digit()));
            let message = retry_after.map_or_else(
                || "SePay rate limit reached; try again later".to_owned(),
                |seconds| format!("SePay rate limit reached; retry after {seconds} seconds"),
            );
            return Err(ApiError::new(429, "BANK_PROVIDER_RATE_LIMITED", message));
        }
        let status_code = if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            422
        } else if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT {
            502
        } else {
            422
        };
        return Err(ApiError::new(
            status_code,
            "BANK_PROVIDER_REJECTED",
            format!("{endpoint} rejected the request (HTTP {})", status.as_u16()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(provider_response("SePay response exceeds the 2 MB limit"));
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| provider_unavailable())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(provider_response("SePay response exceeds the 2 MB limit"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn provider_unavailable() -> ApiError {
    ApiError::new(
        502,
        "BANK_PROVIDER_UNAVAILABLE",
        "SePay request failed or timed out",
    )
}

fn provider_response(message: &str) -> ApiError {
    ApiError::new(502, "BANK_PROVIDER_RESPONSE", message)
}
