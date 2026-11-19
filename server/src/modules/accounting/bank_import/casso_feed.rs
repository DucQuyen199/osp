//! Casso Flow v3 transaction pull adapter.
use super::model::{BankAccountIdentity, ParsedBankStatement, validation};
use crate::error::{ApiError, R};
use crate::kernel::Kernel;
use chrono::NaiveDate;
use reqwest::{Client, StatusCode, redirect::Policy};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::LazyLock, time::Duration};
use tokio::sync::Mutex;

const API_ROOT: &str = "https://openapi.casso.vn";
const MAX_RESPONSE_BYTES: usize = 2_000_000;
const MAX_TOTAL_RESPONSE_BYTES: usize = 20_000_000;
const PAGE_SIZE: u32 = 100;
const MAX_PAGES: u32 = 20;
const MAX_RECORDS: usize = PAGE_SIZE as usize * MAX_PAGES as usize;
const DEFAULT_REQUESTS_PER_MINUTE: u32 = 2;
const DEFAULT_TOKEN_TTL_SECONDS: u64 = 900;
const MAX_CACHED_TOKENS: usize = 1024;

struct CachedToken {
    secret_fingerprint: String,
    access_token: String,
    expires_at: tokio::time::Instant,
}

static ACCESS_TOKENS: LazyLock<Mutex<HashMap<String, CachedToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) async fn fetch(
    kernel: &Kernel,
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
    let requests_per_minute = match config.get("requests_per_minute").and_then(Value::as_u64) {
        None => DEFAULT_REQUESTS_PER_MINUTE,
        Some(value @ (2 | 5 | 20)) => value as u32,
        Some(_) => {
            return Err(validation(
                "Casso requests_per_minute must match a documented plan limit: 2, 5, or 20",
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
        .map_err(|_| ApiError::internal("Cannot build Casso API client"))?;

    let access_token = get_access_token(&client, app_id, app_secret).await?;

    let mut records = Vec::new();
    let mut expected_total_pages = None;
    let mut total_response_bytes = 0usize;
    for page_number in 1..=MAX_PAGES {
        reserve_request_slot(kernel, app_id, requests_per_minute).await?;
        let response = client
            .get(format!("{API_ROOT}/flow/v3/transactions"))
            .bearer_auth(&access_token)
            .query(&[
                ("fromDate", from.to_string()),
                ("toDate", to.to_string()),
                ("page", page_number.to_string()),
                ("pageSize", PAGE_SIZE.to_string()),
                ("sort", "ASC".to_owned()),
            ])
            .send()
            .await
            .map_err(|_| provider_unavailable())?;
        let body = read_body(response, "Casso transaction endpoint").await?;
        total_response_bytes = total_response_bytes.saturating_add(body.len());
        if total_response_bytes > MAX_TOTAL_RESPONSE_BYTES {
            return Err(provider_response(
                "Casso transaction result exceeds the 20 MB sync limit; use a shorter date range",
            ));
        }
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
        let page_records = payload
            .pointer("/data/records")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                provider_response("Casso transaction response is missing data.records")
            })?;
        if total_pages > u64::from(MAX_PAGES) {
            return Err(ApiError::new(
                422,
                "BANK_FEED_PAGE_LIMIT",
                format!(
                    "Casso returned more than {MAX_RECORDS} transactions; sync a shorter date range"
                ),
            ));
        }
        if total_pages == 0 {
            if page_number == 1 && page_records.is_empty() {
                break;
            }
            return Err(provider_response(
                "Casso transaction response has an invalid totalPages value",
            ));
        }
        if total_pages < u64::from(page_number)
            || expected_total_pages.is_some_and(|expected| expected != total_pages)
        {
            return Err(provider_response(
                "Casso transaction pagination changed during the sync; retry with a shorter date range",
            ));
        }
        expected_total_pages = Some(total_pages);
        if let Some(returned_page) = payload.pointer("/data/page").and_then(Value::as_u64)
            && returned_page != u64::from(page_number)
        {
            return Err(provider_response(
                "Casso transaction response page does not match the requested page",
            ));
        }
        records.extend(page_records.iter().cloned());
        if records.len() > MAX_RECORDS {
            return Err(ApiError::new(
                422,
                "BANK_FEED_PAGE_LIMIT",
                format!(
                    "Casso returned more than {MAX_RECORDS} transactions; sync a shorter date range"
                ),
            ));
        }
        if u64::from(page_number) >= total_pages {
            break;
        }
    }

    let expected_account = expected_account.trim();
    let mut matching = Vec::new();
    for (index, record) in records.iter().enumerate() {
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
    if !records.is_empty() && matching.is_empty() {
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

async fn reserve_request_slot(kernel: &Kernel, app_id: &str, requests_per_minute: u32) -> R<()> {
    let scope_hash = hex::encode(Sha256::digest(format!("casso:{app_id}").as_bytes()));
    let interval_seconds = 60.0 / f64::from(requests_per_minute);
    let connection = kernel.pool.get().await?;
    connection
        .execute(
            "INSERT INTO osp_provider_request_limits (scope_hash, next_request_at) VALUES ($1, now()) ON CONFLICT (scope_hash) DO NOTHING",
            &[&scope_hash],
        )
        .await?;
    let row = connection
        .query_one(
            "UPDATE osp_provider_request_limits SET next_request_at = GREATEST(next_request_at, now()) + ($2 * interval '1 second'), updated_at = now() WHERE scope_hash = $1 RETURNING next_request_at - ($2 * interval '1 second')",
            &[&scope_hash, &interval_seconds],
        )
        .await?;
    let reserved_at: chrono::DateTime<chrono::Utc> = row.get(0);
    drop(connection);
    if let Ok(delay) = reserved_at
        .signed_duration_since(chrono::Utc::now())
        .to_std()
    {
        tokio::time::sleep(delay).await;
    }
    Ok(())
}

async fn get_access_token(client: &Client, app_id: &str, app_secret: &str) -> R<String> {
    let cache_key = hex::encode(Sha256::digest(app_id.as_bytes()));
    let secret_fingerprint = hex::encode(Sha256::digest(app_secret.as_bytes()));
    let now = tokio::time::Instant::now();
    let mut cache = ACCESS_TOKENS.lock().await;
    cache.retain(|_, token| token.expires_at > now);
    if let Some(cached) = cache.get(&cache_key)
        && cached.secret_fingerprint == secret_fingerprint
        && cached.expires_at > now
    {
        return Ok(cached.access_token.clone());
    }

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
        .ok_or_else(|| provider_response("Casso token response is missing access_token"))?
        .to_owned();
    let token_lifetime = token_payload
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TOKEN_TTL_SECONDS);
    let cache_lifetime = token_lifetime.saturating_sub(60).max(1);
    if cache.len() >= MAX_CACHED_TOKENS {
        if let Some(key) = cache.keys().next().cloned() {
            cache.remove(&key);
        }
    }
    cache.insert(
        cache_key,
        CachedToken {
            secret_fingerprint,
            access_token: access_token.clone(),
            expires_at: now + Duration::from_secs(cache_lifetime),
        },
    );
    Ok(access_token)
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
