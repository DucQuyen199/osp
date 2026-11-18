//! Casso Flow v3 transaction pull adapter.
use super::model::{BankAccountIdentity, ParsedBankStatement, validation};
use crate::error::{ApiError, R};
use chrono::NaiveDate;
use reqwest::{Client, StatusCode, redirect::Policy};
use serde_json::{Value, json};
use std::time::Duration;

const API_ROOT: &str = "https://openapi.casso.vn";
const MAX_RESPONSE_BYTES: usize = 2_000_000;
const PAGE_SIZE: u32 = 1000;

pub(super) async fn fetch(
    config: &Value,
    from: NaiveDate,
    to: NaiveDate,
    expected_account: &str,
) -> R<ParsedBankStatement> {
    let app_id = config
        .get("app_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Casso connector is missing app_id"))?;
    let app_secret = config
        .get("app_secret")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation("Casso connector is missing app_secret"))?;
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ApiError::internal("Cannot build Casso API client"))?;

    let token_response = client
        .post(format!("{API_ROOT}/oauth/token"))
        .json(&json!({ "app_id": app_id, "app_secret": app_secret }))
        .send()
        .await
        .map_err(|_| provider_unavailable())?;
    let token_body = read_body(token_response, "Casso token endpoint").await?;
    let token_payload: Value = serde_json::from_slice(&token_body)
        .map_err(|_| provider_response("Casso token endpoint returned invalid JSON"))?;
    let access_token = token_payload
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| provider_response("Casso token response is missing access_token"))?;

    let response = client
        .get(format!("{API_ROOT}/flow/v3/transactions"))
        .bearer_auth(access_token)
        .query(&[
            ("fromDate", from.to_string()),
            ("toDate", to.to_string()),
            ("page", "1".to_owned()),
            ("pageSize", PAGE_SIZE.to_string()),
            ("sort", "ASC".to_owned()),
        ])
        .send()
        .await
        .map_err(|_| provider_unavailable())?;
    let body = read_body(response, "Casso transaction endpoint").await?;
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| provider_response("Casso transaction endpoint returned invalid JSON"))?;
    if payload.get("error").and_then(Value::as_i64) != Some(0) {
        return Err(provider_response("Casso rejected the transaction query"));
    }
    let total_pages = payload
        .pointer("/data/totalPages")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            provider_response("Casso transaction response is missing data.totalPages")
        })?;
    let page = payload
        .pointer("/data/records")
        .and_then(Value::as_array)
        .ok_or_else(|| provider_response("Casso transaction response is missing data.records"))?;
    if total_pages > 1 {
        return Err(ApiError::new(
            422,
            "BANK_FEED_PAGE_LIMIT",
            format!(
                "Casso returned more than {PAGE_SIZE} transactions for this date range; sync a shorter date range"
            ),
        ));
    }

    let expected_account = expected_account.trim();
    let mut matching = Vec::new();
    for (index, record) in page.iter().enumerate() {
        let account = record
            .get("bankSubAccId")
            .or_else(|| record.get("bank_sub_acc_id"))
            .and_then(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| value.as_number().map(ToString::to_string))
            })
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                validation(format!(
                    "Casso transaction {}: bankSubAccId is missing",
                    index + 1
                ))
            })?;
        if account.trim() == expected_account {
            matching.push(record.clone());
        }
    }
    if !page.is_empty() && matching.is_empty() {
        return Err(validation(
            "Casso returned transactions, but none match the bank account configured on the selected ledger account",
        ));
    }
    let lines = if matching.is_empty() {
        Vec::new()
    } else {
        super::casso::parse(&json!({ "data": matching }))?.lines
    };
    Ok(ParsedBankStatement {
        identity: BankAccountIdentity::Casso(expected_account.to_owned()),
        lines,
    })
}

async fn read_body(response: reqwest::Response, endpoint: &str) -> R<Vec<u8>> {
    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("x-rate-limit-retry-after-seconds")
                .and_then(|value| value.to_str().ok())
                .filter(|value| value.bytes().all(|byte| byte.is_ascii_digit()));
            let message = retry_after.map_or_else(
                || "Casso rate limit reached; try again later".to_owned(),
                |seconds| format!("Casso rate limit reached; retry after {seconds} seconds"),
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
        return Err(provider_response("Casso response exceeds the 2 MB limit"));
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| provider_unavailable())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(provider_response("Casso response exceeds the 2 MB limit"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn provider_unavailable() -> ApiError {
    ApiError::new(
        502,
        "BANK_PROVIDER_UNAVAILABLE",
        "Casso request failed or timed out",
    )
}

fn provider_response(message: &str) -> ApiError {
    ApiError::new(502, "BANK_PROVIDER_RESPONSE", message)
}
