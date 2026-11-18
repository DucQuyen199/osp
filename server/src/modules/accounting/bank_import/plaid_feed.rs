//! Plaid Link exchange and transaction pull adapter for supported international markets.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, validation};
use crate::{
    error::{ApiError, R},
    money,
};
use chrono::NaiveDate;
use reqwest::{Client, StatusCode, redirect::Policy};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 2_000_000;
const PAGE_SIZE: usize = 500;
const MAX_ROWS: usize = 15_000;

pub(super) async fn create_link_token(config: &Value, client_user_id: &str) -> R<String> {
    let (client_id, secret) = credentials(config)?;
    let country_codes = config
        .get("country_codes")
        .and_then(Value::as_array)
        .ok_or_else(|| validation("Plaid connector requires country_codes"))?;
    let body = json!({
        "client_id": client_id,
        "secret": secret,
        "client_name": "OSP Suite",
        "user": { "client_user_id": client_user_id },
        "products": ["transactions"],
        "transactions": { "days_requested": 730 },
        "country_codes": country_codes,
        "language": "en"
    });
    let payload = post(config, "/link/token/create", body).await?;
    payload
        .get("link_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| provider_response("Plaid link-token response is missing link_token"))
}

pub(super) async fn exchange_public_token(
    config: &Value,
    public_token: &str,
) -> R<(String, String)> {
    let (client_id, secret) = credentials(config)?;
    let payload = post(
        config,
        "/item/public_token/exchange",
        json!({ "client_id": client_id, "secret": secret, "public_token": public_token }),
    )
    .await?;
    let access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            provider_response("Plaid token-exchange response is missing access_token")
        })?;
    let item_id = payload
        .get("item_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| provider_response("Plaid token-exchange response is missing item_id"))?;
    Ok((access_token.to_owned(), item_id.to_owned()))
}

pub(super) async fn list_accounts(config: &Value) -> R<Value> {
    let access_token = config
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Plaid connector is not linked to a bank Item"))?;
    let (client_id, secret) = credentials(config)?;
    let payload = post(
        config,
        "/accounts/get",
        json!({ "client_id": client_id, "secret": secret, "access_token": access_token }),
    )
    .await?;
    let accounts = payload
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| provider_response("Plaid account response is missing accounts"))?
        .iter()
        .map(|account| {
            json!({
                "accountId": account.get("account_id"),
                "name": account.get("name"),
                "officialName": account.get("official_name"),
                "mask": account.get("mask"),
                "type": account.get("type"),
                "subtype": account.get("subtype"),
                "currency": account.pointer("/balances/iso_currency_code")
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "accounts": accounts }))
}

pub(super) async fn remove_item(config: &Value) -> R<()> {
    let access_token = config
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Plaid connector is not linked to a bank Item"))?;
    let (client_id, secret) = credentials(config)?;
    post(
        config,
        "/item/remove",
        json!({ "client_id": client_id, "secret": secret, "access_token": access_token }),
    )
    .await?;
    Ok(())
}

pub(super) async fn fetch(
    config: &Value,
    from: NaiveDate,
    to: NaiveDate,
    expected_account_id: &str,
) -> R<ParsedBankStatement> {
    let access_token = config
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Plaid connector is not linked to a bank Item"))?;
    let expected_account_id = expected_account_id.trim();
    if expected_account_id.is_empty() {
        return Err(validation(
            "Set bank_account_id on the ledger account to the Plaid account_id",
        ));
    }
    let (client_id, secret) = credentials(config)?;
    let client = client()?;
    let mut transactions = Vec::new();
    let mut total_transactions = None;
    let mut offset = 0usize;
    loop {
        if offset > 0 {
            // Plaid documents a per-Item limit of 30 /transactions/get requests per minute.
            tokio::time::sleep(Duration::from_millis(2_100)).await;
        }
        let payload = post_with_client(
            &client,
            config,
            "/transactions/get",
            json!({
                "client_id": client_id,
                "secret": secret,
                "access_token": access_token,
                "start_date": from.to_string(),
                "end_date": to.to_string(),
                "options": {
                    "account_ids": [expected_account_id],
                    "count": PAGE_SIZE,
                    "offset": offset
                }
            }),
        )
        .await?;
        let page = payload
            .get("transactions")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                provider_response("Plaid transaction response is missing transactions")
            })?;
        let total = payload
            .get("total_transactions")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                provider_response("Plaid transaction response is missing total_transactions")
            })? as usize;
        if total > MAX_ROWS {
            return Err(ApiError::new(
                422,
                "BANK_FEED_PAGE_LIMIT",
                format!(
                    "Plaid returned more than {MAX_ROWS} transactions for this date range; sync a shorter range"
                ),
            ));
        }
        if total_transactions.is_some_and(|previous| previous != total) {
            return Err(provider_response(
                "Plaid transaction count changed while paging; retry the sync",
            ));
        }
        total_transactions = Some(total);
        if page
            .iter()
            .any(|item| item.get("account_id").and_then(Value::as_str) != Some(expected_account_id))
        {
            return Err(validation(
                "Plaid returned a transaction for a different bank account",
            ));
        }
        transactions.extend(page.iter().cloned());
        offset = offset.saturating_add(page.len());
        if offset >= total {
            break;
        }
        if page.is_empty() || offset > MAX_ROWS {
            return Err(provider_response(
                "Plaid pagination ended before all transactions were returned",
            ));
        }
    }

    let mut lines = Vec::new();
    for (index, transaction) in transactions.iter().enumerate() {
        if transaction.get("pending").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let row = index + 1;
        let id = transaction
            .get("transaction_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                validation(format!(
                    "Plaid transaction {row}: transaction_id is missing"
                ))
            })?;
        if id.len() > 160 || id.chars().any(char::is_control) {
            return Err(validation(format!(
                "Plaid transaction {row}: invalid transaction_id"
            )));
        }
        let date_text = transaction
            .get("date")
            .and_then(Value::as_str)
            .ok_or_else(|| validation(format!("Plaid transaction {row}: date is missing")))?;
        let date = NaiveDate::parse_from_str(date_text, "%Y-%m-%d")
            .map_err(|_| validation(format!("Plaid transaction {row}: invalid date")))?;
        if date < from || date > to {
            return Err(validation(format!(
                "Plaid transaction {row}: date is outside the requested statement period"
            )));
        }
        let amount_raw = transaction
            .get("amount")
            .map(|value| {
                value
                    .as_number()
                    .map(ToString::to_string)
                    .or_else(|| value.as_str().map(str::to_owned))
            })
            .flatten()
            .ok_or_else(|| validation(format!("Plaid transaction {row}: amount is missing")))?;
        let signed = money::decimal_str(&amount_raw)
            .ok_or_else(|| validation(format!("Plaid transaction {row}: invalid amount")))?;
        if signed.is_zero() || signed.abs() > Decimal::new(999_999_999_999_999_999, 4) {
            return Err(validation(format!(
                "Plaid transaction {row}: amount is zero or outside the supported financial range"
            )));
        }
        let description = transaction
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        {
            return Err(validation(format!(
                "Plaid transaction {row}: name exceeds 1,000 characters"
            )));
        }
        let currency = transaction
            .get("iso_currency_code")
            .and_then(Value::as_str)
            .filter(|value| {
                value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_alphabetic())
            })
            .map(|value| value.to_ascii_uppercase());
        lines.push(BankLine {
            row,
            date,
            reference: format!("PLAID:{id}"),
            description,
            direction: if signed.is_sign_positive() {
                "debit"
            } else {
                "credit"
            },
            amount: signed.abs(),
            currency,
        });
    }
    Ok(ParsedBankStatement {
        identity: BankAccountIdentity::AccountId(expected_account_id.to_owned()),
        lines,
    })
}

fn credentials(config: &Value) -> R<(&str, &str)> {
    let client_id = config
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Plaid connector is missing client_id"))?;
    let secret = config
        .get("secret")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Plaid connector is missing secret"))?;
    Ok((client_id, secret))
}

fn api_root(config: &Value) -> R<&'static str> {
    match config.get("environment").and_then(Value::as_str) {
        Some("sandbox") => Ok("https://sandbox.plaid.com"),
        Some("development") => Ok("https://development.plaid.com"),
        Some("production") => Ok("https://production.plaid.com"),
        _ => Err(validation(
            "Plaid environment must be sandbox, development, or production",
        )),
    }
}

fn client() -> R<Client> {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ApiError::internal("Cannot build Plaid API client"))
}

async fn post(config: &Value, path: &str, body: Value) -> R<Value> {
    let client = client()?;
    post_with_client(&client, config, path, body).await
}

async fn post_with_client(client: &Client, config: &Value, path: &str, body: Value) -> R<Value> {
    let response = client
        .post(format!("{}{}", api_root(config)?, path))
        .json(&body)
        .send()
        .await
        .map_err(|_| provider_unavailable())?;
    let status = response.status();
    let body = read_body(response).await?;
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| provider_response("Plaid endpoint returned invalid JSON"))?;
    if !status.is_success() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ApiError::new(
                429,
                "BANK_PROVIDER_RATE_LIMITED",
                "Plaid rate limit reached; try again later",
            ));
        }
        if payload.get("error_code").and_then(Value::as_str) == Some("PRODUCT_NOT_READY") {
            return Err(ApiError::new(
                409,
                "BANK_PROVIDER_NOT_READY",
                "Plaid is still preparing transactions for this bank account; try again later",
            ));
        }
        let code = payload
            .get("error_code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if code == "INVALID_PUBLIC_TOKEN"
            || code == "INVALID_ACCESS_TOKEN"
            || code == "INVALID_LINK_TOKEN"
        {
            return Err(ApiError::new(
                422,
                "BANK_PROVIDER_CREDENTIAL_REJECTED",
                "Plaid rejected the connection token; reconnect the bank account",
            ));
        }
        return Err(ApiError::new(
            502,
            "BANK_PROVIDER_REJECTED",
            format!("Plaid API rejected the request (HTTP {})", status.as_u16()),
        ));
    }
    Ok(payload)
}

async fn read_body(response: reqwest::Response) -> R<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(provider_response("Plaid response exceeds the 2 MB limit"));
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| provider_unavailable())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(provider_response("Plaid response exceeds the 2 MB limit"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn provider_unavailable() -> ApiError {
    ApiError::new(
        502,
        "BANK_PROVIDER_UNAVAILABLE",
        "Plaid request failed or timed out",
    )
}

fn provider_response(message: &str) -> ApiError {
    ApiError::new(502, "BANK_PROVIDER_RESPONSE", message)
}
