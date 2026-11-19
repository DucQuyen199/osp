//! Salt Edge Account Information API v6 bank feed.
use super::model::{BankAccountIdentity, BankLine, ParsedBankStatement, validation};
use crate::{
    error::{ApiError, R},
    money,
};
use chrono::NaiveDate;
use reqwest::{Client, Method, StatusCode, redirect::Policy};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::{collections::HashSet, time::Duration};

const API_ROOT: &str = "https://www.saltedge.com/api/v6";
const MAX_RESPONSE_BYTES: usize = 2_000_000;
const PAGE_SIZE: usize = 250;
const MAX_ROWS: usize = 20_000;
const MAX_PAGES: usize = 100;

pub(super) async fn create_customer(config: &Value, identifier: &str) -> R<String> {
    let payload = request(
        config,
        Method::POST,
        "/customers",
        None,
        Some(json!({"data": {"identifier": identifier}})),
    )
    .await?;
    payload
        .pointer("/data/customer_id")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .ok_or_else(|| provider_response("Salt Edge customer response is missing customer_id"))
}

pub(super) async fn create_connect_url(
    config: &Value,
    return_to: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> R<String> {
    let customer_id = config
        .get("customer_id")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .ok_or_else(|| validation("Salt Edge customer has not been provisioned"))?;
    let payload = request(
        config,
        Method::POST,
        "/connections/connect",
        None,
        Some(json!({
            "data": {
                "customer_id": customer_id,
                "consent": {
                    "scopes": ["accounts", "transactions"],
                    "from_date": from.to_string(),
                    "to_date": to.to_string()
                },
                "attempt": {
                    "fetch_scopes": ["accounts", "transactions"],
                    "fetch_from_date": from.to_string(),
                    "fetch_to_date": to.to_string(),
                    "locale": "en",
                    "return_to": return_to,
                    "custom_fields": {"integration": "osp"}
                },
                "return_connection_id": true,
                "return_error_class": true,
                "automatic_refresh": true
            }
        })),
    )
    .await?;
    let url = payload
        .pointer("/data/connect_url")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("https://www.saltedge.com/"))
        .ok_or_else(|| provider_response("Salt Edge response is missing a secure connect_url"))?;
    Ok(url.to_owned())
}

pub(super) async fn verify_connection(config: &Value, connection_id: &str) -> R<()> {
    if !valid_id(connection_id) {
        return Err(validation("Salt Edge connection_id is invalid"));
    }
    let customer_id = config
        .get("customer_id")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .ok_or_else(|| validation("Salt Edge connector has no customer_id"))?;
    let payload = request(
        config,
        Method::GET,
        &format!("/connections/{connection_id}"),
        None,
        None,
    )
    .await?;
    let remote_customer = payload
        .pointer("/data/customer_id")
        .and_then(Value::as_str)
        .ok_or_else(|| provider_response("Salt Edge connection response is missing customer_id"))?;
    if remote_customer != customer_id {
        return Err(ApiError::new(
            403,
            "BANK_PROVIDER_OWNERSHIP_MISMATCH",
            "Salt Edge connection does not belong to this tenant connector",
        ));
    }
    Ok(())
}

pub(super) async fn list_accounts(config: &Value) -> R<Value> {
    let connection_id = linked_connection_id(config)?;
    verify_connection(config, connection_id).await?;
    let accounts = list_accounts_for_connection(config, connection_id).await?;
    Ok(json!({ "accounts": accounts }))
}

pub(super) async fn remove_connection(config: &Value) -> R<()> {
    let connection_id = linked_connection_id(config)?;
    verify_connection(config, connection_id).await?;
    request(
        config,
        Method::DELETE,
        &format!("/connections/{connection_id}"),
        None,
        None,
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
    let connection_id = linked_connection_id(config)?;
    let expected_account_id = expected_account_id.trim();
    if !valid_id(expected_account_id) {
        return Err(validation(
            "Set bank_account_id to the Salt Edge account ID",
        ));
    }
    verify_connection(config, connection_id).await?;
    let accounts = list_accounts_for_connection(config, connection_id).await?;
    if !accounts.iter().any(|account| {
        account.get("accountId").and_then(Value::as_str) == Some(expected_account_id)
    }) {
        return Err(ApiError::new(
            422,
            "BANK_ACCOUNT_IDENTITY_MISMATCH",
            "The mapped Salt Edge account does not belong to this linked connection",
        ));
    }

    let mut transactions = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen_cursors = HashSet::new();
    for _ in 0..MAX_PAGES {
        let mut query = vec![
            ("connection_id", connection_id.to_owned()),
            ("account_id", expected_account_id.to_owned()),
            ("pending", "false".to_owned()),
            ("duplicated", "false".to_owned()),
            ("per_page", PAGE_SIZE.to_string()),
        ];
        if let Some(cursor) = cursor.as_ref() {
            query.push(("from_id", cursor.clone()));
        }
        let payload = request(config, Method::GET, "/transactions", Some(&query), None).await?;
        let page = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| provider_response("Salt Edge transaction response is missing data"))?;
        if transactions.len().saturating_add(page.len()) > MAX_ROWS {
            return Err(ApiError::new(
                422,
                "BANK_FEED_PAGE_LIMIT",
                format!(
                    "Salt Edge returned more than {MAX_ROWS} transactions for this account; the statement date filter is applied after fetching provider history. Use a narrower consent window by relinking, or import a statement file"
                ),
            ));
        }
        if page
            .iter()
            .any(|row| row.get("account_id").and_then(Value::as_str) != Some(expected_account_id))
        {
            return Err(validation(
                "Salt Edge returned a transaction for a different bank account",
            ));
        }
        transactions.extend(page.iter().cloned());
        let next = payload
            .pointer("/meta/next_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        match next {
            Some(next) if !page.is_empty() => {
                if !valid_id(&next) || !seen_cursors.insert(next.clone()) {
                    return Err(provider_response(
                        "Salt Edge returned an invalid or repeated pagination cursor",
                    ));
                }
                cursor = Some(next);
            }
            _ => break,
        }
    }
    if cursor.is_some() {
        return Err(ApiError::new(
            422,
            "BANK_FEED_PAGE_LIMIT",
            "Salt Edge exceeded the maximum number of pages for this account; the statement date filter is applied after fetching provider history. Use a narrower consent window by relinking, or import a statement file",
        ));
    }

    let mut lines = Vec::new();
    let mut seen_ids = HashSet::new();
    for (index, transaction) in transactions.iter().enumerate() {
        let row = index + 1;
        let id = transaction
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
            .ok_or_else(|| validation(format!("Salt Edge transaction {row}: invalid id")))?;
        if !seen_ids.insert(id.to_owned()) {
            continue;
        }
        if transaction
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|value| value != "posted")
            || transaction.get("duplicated").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let date_text = transaction
            .get("made_on")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                validation(format!("Salt Edge transaction {row}: made_on is missing"))
            })?;
        let date = NaiveDate::parse_from_str(date_text, "%Y-%m-%d").map_err(|_| {
            validation(format!("Salt Edge transaction {row}: invalid made_on date"))
        })?;
        if date < from || date > to {
            continue;
        }
        let raw_amount = transaction
            .get("amount")
            .and_then(|value| {
                value
                    .as_number()
                    .map(ToString::to_string)
                    .or_else(|| value.as_str().map(str::to_owned))
            })
            .ok_or_else(|| validation(format!("Salt Edge transaction {row}: amount is missing")))?;
        let signed = money::decimal_str(&raw_amount)
            .ok_or_else(|| validation(format!("Salt Edge transaction {row}: invalid amount")))?;
        if signed.is_zero() || signed.abs() > Decimal::new(999_999_999_999_999_999, 4) {
            return Err(validation(format!(
                "Salt Edge transaction {row}: amount is zero or outside the supported financial range"
            )));
        }
        let description = transaction
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        {
            return Err(validation(format!(
                "Salt Edge transaction {row}: description exceeds 1,000 characters"
            )));
        }
        let currency = transaction
            .get("currency_code")
            .and_then(Value::as_str)
            .filter(|value| {
                value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_alphabetic())
            })
            .map(|value| value.to_ascii_uppercase());
        lines.push(BankLine {
            row,
            date,
            reference: format!("SALTEDGE:{id}"),
            description,
            // Salt Edge reports incoming amounts as positive and outgoing as negative.
            direction: if signed.is_sign_negative() {
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

async fn list_accounts_for_connection(config: &Value, connection_id: &str) -> R<Vec<Value>> {
    let mut accounts = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen_cursors = HashSet::new();
    for _ in 0..MAX_PAGES {
        let mut query = vec![
            ("connection_id", connection_id.to_owned()),
            ("per_page", PAGE_SIZE.to_string()),
        ];
        if let Some(cursor) = cursor.as_ref() {
            query.push(("from_id", cursor.clone()));
        }
        let payload = request(config, Method::GET, "/accounts", Some(&query), None).await?;
        let page = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| provider_response("Salt Edge account response is missing data"))?;
        if accounts.len().saturating_add(page.len()) > MAX_ROWS {
            return Err(provider_response(
                "Salt Edge account list exceeds the configured limit",
            ));
        }
        if page.iter().any(|account| {
            account.get("connection_id").and_then(Value::as_str) != Some(connection_id)
        }) {
            return Err(ApiError::new(
                403,
                "BANK_PROVIDER_OWNERSHIP_MISMATCH",
                "Salt Edge returned an account for a different connection",
            ));
        }
        accounts.extend(page.iter().map(|account| {
            json!({
                "accountId": account.get("id"),
                "name": account.get("name"),
                "nature": account.get("nature"),
                "currency": account.get("currency_code")
            })
        }));
        let next = payload
            .pointer("/meta/next_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        match next {
            Some(next) if !page.is_empty() => {
                if !valid_id(&next) || !seen_cursors.insert(next.clone()) {
                    return Err(provider_response(
                        "Salt Edge returned an invalid or repeated account pagination cursor",
                    ));
                }
                cursor = Some(next);
            }
            _ => break,
        }
    }
    if cursor.is_some() {
        return Err(provider_response(
            "Salt Edge exceeded the maximum account pages",
        ));
    }
    Ok(accounts)
}

fn linked_connection_id(config: &Value) -> R<&str> {
    config
        .get("connection_id")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .ok_or_else(|| validation("Salt Edge connector is not linked to a bank connection"))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|byte| byte.is_ascii_digit())
}

async fn request(
    config: &Value,
    method: Method,
    path: &str,
    query: Option<&[(&'static str, String)]>,
    body: Option<Value>,
) -> R<Value> {
    let (app_id, secret) = credentials(config)?;
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ApiError::internal("Cannot build Salt Edge API client"))?;
    let mut request = client
        .request(method, format!("{API_ROOT}{path}"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("App-id", app_id)
        .header("Secret", secret);
    if let Some(query) = query {
        request = request.query(query);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|_| provider_unavailable())?;
    let status = response.status();
    let body = read_body(response).await?;
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| provider_response("Salt Edge returned invalid JSON"))?;
    if !status.is_success() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ApiError::new(
                429,
                "BANK_PROVIDER_RATE_LIMITED",
                "Salt Edge rate limit reached; try again later",
            ));
        }
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(ApiError::new(
                422,
                "BANK_PROVIDER_CREDENTIAL_REJECTED",
                "Salt Edge rejected the application credentials or customer access",
            ));
        }
        return Err(ApiError::new(
            502,
            "BANK_PROVIDER_REJECTED",
            format!(
                "Salt Edge API rejected the request (HTTP {})",
                status.as_u16()
            ),
        ));
    }
    Ok(payload)
}

fn credentials(config: &Value) -> R<(&str, &str)> {
    let app_id = config
        .get("app_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Salt Edge connector is missing app_id"))?;
    let secret = config
        .get("secret")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Salt Edge connector is missing secret"))?;
    Ok((app_id, secret))
}

async fn read_body(response: reqwest::Response) -> R<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(provider_response(
            "Salt Edge response exceeds the 2 MB limit",
        ));
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| provider_unavailable())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(provider_response(
                "Salt Edge response exceeds the 2 MB limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn provider_unavailable() -> ApiError {
    ApiError::new(
        502,
        "BANK_PROVIDER_UNAVAILABLE",
        "Salt Edge request failed or timed out",
    )
}

fn provider_response(message: &str) -> ApiError {
    ApiError::new(502, "BANK_PROVIDER_RESPONSE", message)
}
