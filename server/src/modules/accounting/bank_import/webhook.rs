//! Public bank-feed webhook receivers. Provider payloads are authenticated first,
//! tenant/account mapping is resolved server-side, and lines go through the same
//! draft-only idempotent import transaction as manual/API imports.
use super::{casso, model::BankAccountIdentity, persistence};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sha2::Sha256;
use std::env;
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
const MAX_WEBHOOK_BYTES: usize = 65_536;
const MAX_CASSO_EVENTS: usize = 100;

pub async fn receive_bank_feed_webhook(
    kernel: &Kernel,
    tenant: &Tenant,
    connector_id: &str,
    casso_secure_token: Option<&str>,
    sepay_signature: Option<&str>,
    sepay_timestamp: Option<&str>,
    raw_body: &[u8],
) -> R<Value> {
    if tenant.suspended {
        return Err(ApiError::new(
            403,
            "TENANT_SUSPENDED",
            "Tenant is suspended",
        ));
    }
    if !tenant.has_module("accounting") || !tenant.has_module("integration-hub") {
        return Err(ApiError::new(
            404,
            "NOT_FOUND",
            "Bank feed webhook not found",
        ));
    }
    if raw_body.is_empty() || raw_body.len() > MAX_WEBHOOK_BYTES {
        return Err(ApiError::new(
            413,
            "TOO_LARGE",
            "Bank feed webhook body is empty or too large",
        ));
    }
    let connector_id = Uuid::parse_str(connector_id).map_err(|_| {
        ApiError::new(
            404,
            "BANK_FEED_CONNECTOR_NOT_FOUND",
            "Bank feed connector not found",
        )
    })?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let row = tx.query_opt(
        "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND kind = 'bank_feed' AND enabled = true FOR SHARE",
        &[&tenant.id, &connector_id],
    ).await?.ok_or_else(|| ApiError::new(404, "BANK_FEED_CONNECTOR_NOT_FOUND", "Bank feed connector not found"))?;
    let config: Value = row.get(0);
    let adapter = config
        .get("adapter")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match adapter {
        "sepay_bank_feed" => {
            let secret = webhook_secret(&config)?;
            verify_sepay_signature(&secret, sepay_signature, sepay_timestamp, raw_body)?;
            let payload: Value = serde_json::from_slice(raw_body)
                .map_err(|_| invalid("SePay webhook body must be valid JSON"))?;
            let event = parse_sepay_event(&payload)?;
            let expected_account = config
                .get("webhook_account_number")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        503,
                        "BANK_FEED_WEBHOOK_UNCONFIGURED",
                        "Configure webhook_account_number on the SePay connector",
                    )
                })?;
            if event.account_number != expected_account.trim() {
                return Err(ApiError::new(
                    403,
                    "BANK_FEED_ACCOUNT_MISMATCH",
                    "SePay webhook account does not match this connector",
                ));
            }
            let statement_id = resolve_draft_statement(
                tenant,
                &tx,
                "sepay",
                &event.account_number,
                event.line.date,
            )
            .await?;
            tx.commit().await?;
            drop(conn);
            let result = persistence::import_lines(
                kernel,
                &Actor::System,
                tenant,
                statement_id,
                vec![event.line],
                Some(BankAccountIdentity::AccountId(
                    expected_account.trim().to_owned(),
                )),
                "SEPAY",
                "SePay webhook transaction",
            )
            .await?;
            Ok(
                json!({"success": true, "duplicate": result.get("imported").and_then(Value::as_u64) == Some(0)}),
            )
        }
        "casso_bank_feed" => {
            let secret = webhook_secret(&config)?;
            verify_casso_token(&secret, casso_secure_token)?;
            let payload: Value = serde_json::from_slice(raw_body)
                .map_err(|_| invalid("Casso webhook body must be valid JSON"))?;
            let provider_error = payload
                .get("error")
                .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
            if provider_error != Some(0) {
                return Err(invalid("Casso webhook error must be zero"));
            }
            let parsed = casso::parse(&payload)?;
            if parsed.lines.len() > MAX_CASSO_EVENTS {
                return Err(ApiError::new(
                    413,
                    "TOO_MANY_ROWS",
                    "Casso webhook is limited to 100 transactions per request",
                ));
            }
            let BankAccountIdentity::Casso(account_id) = parsed.identity else {
                return Err(invalid("Casso webhook did not identify its bank account"));
            };
            let configured_account = config
                .get("webhook_account_id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        503,
                        "BANK_FEED_WEBHOOK_UNCONFIGURED",
                        "Configure webhook_account_id on the Casso connector",
                    )
                })?;
            if account_id != configured_account.trim() {
                return Err(ApiError::new(
                    403,
                    "BANK_FEED_ACCOUNT_MISMATCH",
                    "Casso webhook account does not match this connector",
                ));
            }
            let statement_ids = resolve_draft_statements(
                tenant,
                &tx,
                "casso",
                &account_id,
                &parsed
                    .lines
                    .iter()
                    .map(|line| line.date)
                    .collect::<Vec<_>>(),
            )
            .await?;
            if statement_ids.windows(2).any(|pair| pair[0] != pair[1]) {
                return Err(invalid(
                    "Casso webhook transactions must belong to one draft statement",
                ));
            }
            let statement_id = statement_ids
                .first()
                .copied()
                .ok_or_else(|| invalid("Casso webhook contains no transactions"))?;
            tx.commit().await?;
            drop(conn);
            let result = persistence::import_lines(
                kernel,
                &Actor::System,
                tenant,
                statement_id,
                parsed.lines,
                Some(BankAccountIdentity::Casso(account_id)),
                "CASSO",
                "Casso webhook transaction",
            )
            .await?;
            Ok(
                json!({"success": true, "duplicate": result.get("imported").and_then(Value::as_u64) == Some(0)}),
            )
        }
        _ => Err(ApiError::new(
            404,
            "BANK_FEED_CONNECTOR_NOT_FOUND",
            "Connector is not an eligible bank feed",
        )),
    }
}

fn webhook_secret(config: &Value) -> R<String> {
    let name = config
        .get("webhook_secret_env")
        .and_then(Value::as_str)
        .filter(|value| {
            value.starts_with("OSP_BANK_WEBHOOK_SECRET_")
                && value.len() <= 80
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
        .ok_or_else(|| {
            ApiError::new(
                503,
                "BANK_FEED_WEBHOOK_UNCONFIGURED",
                "Configure webhook_secret_env on the bank feed connector",
            )
        })?;
    env::var(name)
        .ok()
        .filter(|secret| (32..=512).contains(&secret.len()))
        .ok_or_else(|| {
            ApiError::new(
                503,
                "BANK_FEED_WEBHOOK_SECRET_UNAVAILABLE",
                "Bank feed webhook runtime secret is missing or weak",
            )
        })
}

fn verify_casso_token(secret: &str, supplied: Option<&str>) -> R<()> {
    let supplied = supplied.unwrap_or_default().as_bytes();
    let expected = secret.as_bytes();
    if supplied.len() != expected.len() || !bool::from(supplied.ct_eq(expected)) {
        return Err(ApiError::new(
            401,
            "INVALID_BANK_FEED_SIGNATURE",
            "Missing or invalid Casso webhook secret",
        ));
    }
    Ok(())
}

fn verify_sepay_signature(
    secret: &str,
    signature: Option<&str>,
    timestamp: Option<&str>,
    body: &[u8],
) -> R<()> {
    let timestamp = timestamp
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| {
            ApiError::new(
                401,
                "INVALID_BANK_FEED_SIGNATURE",
                "Missing or invalid SePay timestamp",
            )
        })?;
    let now = Utc::now().timestamp();
    if timestamp.abs_diff(now) > 300 {
        return Err(ApiError::new(
            401,
            "EXPIRED_BANK_FEED_WEBHOOK",
            "SePay webhook timestamp is outside the five-minute replay window",
        ));
    }
    let signature = signature
        .and_then(|value| value.strip_prefix("sha256="))
        .and_then(|value| hex::decode(value).ok())
        .filter(|value| value.len() == 32)
        .ok_or_else(|| {
            ApiError::new(
                401,
                "INVALID_BANK_FEED_SIGNATURE",
                "Missing or invalid SePay signature",
            )
        })?;
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(secret.as_bytes()).map_err(|_| {
        ApiError::internal("Cannot initialize SePay webhook signature verification")
    })?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&signature).map_err(|_| {
        ApiError::new(
            401,
            "INVALID_BANK_FEED_SIGNATURE",
            "Missing or invalid SePay signature",
        )
    })
}

struct SePayEvent {
    account_number: String,
    line: super::model::BankLine,
}

fn parse_sepay_event(payload: &Value) -> R<SePayEvent> {
    let value = |key: &str| {
        payload.get(key).and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.as_number().map(ToString::to_string))
        })
    };
    let id = value("id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid("SePay webhook transaction id is required"))?;
    if id.len() > 160 || id.chars().any(char::is_control) {
        return Err(invalid("SePay webhook transaction id is invalid"));
    }
    let account_number = value("accountNumber")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid("SePay webhook accountNumber is required"))?;
    let direction = match value("transferType").as_deref() {
        Some("in") => "credit",
        Some("out") => "debit",
        _ => return Err(invalid("SePay transferType must be in or out")),
    };
    let amount = payload
        .get("transferAmount")
        .and_then(crate::money::decimal)
        .filter(|value| *value > Decimal::ZERO)
        .ok_or_else(|| invalid("SePay transferAmount must be positive"))?;
    let date_text =
        value("transactionDate").ok_or_else(|| invalid("SePay transactionDate is required"))?;
    let date = NaiveDateTime::parse_from_str(&date_text, "%Y-%m-%d %H:%M:%S")
        .map(|value| value.date())
        .or_else(|_| DateTime::parse_from_rfc3339(&date_text).map(|value| value.date_naive()))
        .or_else(|_| NaiveDate::parse_from_str(&date_text, "%Y-%m-%d"))
        .map_err(|_| invalid("SePay transactionDate is invalid"))?;
    let description = value("description")
        .or_else(|| value("content"))
        .filter(|value| !value.trim().is_empty());
    if description
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1000 || value.chars().any(char::is_control))
    {
        return Err(invalid("SePay webhook description is invalid"));
    }
    Ok(SePayEvent {
        account_number: account_number.trim().to_owned(),
        line: super::model::BankLine {
            row: 1,
            date,
            reference: format!("SEPAY:{id}"),
            description,
            direction,
            amount,
            currency: None,
        },
    })
}

async fn resolve_draft_statement(
    tenant: &Tenant,
    tx: &Tx<'_>,
    provider: &str,
    account_id: &str,
    date: NaiveDate,
) -> R<Uuid> {
    let ids = resolve_draft_statements(tenant, tx, provider, account_id, &[date]).await?;
    ids.first().copied().ok_or_else(|| {
        ApiError::not_found("No matching draft bank statement covers this transaction date")
    })
}

async fn resolve_draft_statements(
    tenant: &Tenant,
    tx: &Tx<'_>,
    provider: &str,
    account_id: &str,
    dates: &[NaiveDate],
) -> R<Vec<Uuid>> {
    let account_field = if provider == "casso" {
        "casso_bank_account_id"
    } else {
        "bank_account_id"
    };
    let mut resolved = Vec::with_capacity(dates.len());
    for date in dates {
        let query = format!(
            "SELECT s.id FROM accounting__bank_statement s JOIN accounting__account a ON a.tenant_id = s.tenant_id AND a.id = s.account WHERE s.tenant_id = $1 AND s.status = 'draft' AND s.start_date <= $2 AND s.end_date >= $2 AND a.kind = 'asset' AND a.code ~ '^112[0-9]*$' AND a.{account_field} = $3 ORDER BY s.id LIMIT 2"
        );
        let rows = tx.query(&query, &[&tenant.id, date, &account_id]).await?;
        if rows.len() != 1 {
            return Err(ApiError::new(
                if rows.is_empty() { 404 } else { 409 },
                if rows.is_empty() {
                    "BANK_FEED_DRAFT_STATEMENT_NOT_FOUND"
                } else {
                    "BANK_FEED_DRAFT_STATEMENT_AMBIGUOUS"
                },
                if rows.is_empty() {
                    "No matching draft bank statement covers this transaction date"
                } else {
                    "More than one draft bank statement covers this transaction"
                },
            ));
        }
        resolved.push(rows[0].get(0));
    }
    Ok(resolved)
}

fn invalid(message: &str) -> ApiError {
    ApiError::validation("accounting.bank_feed_webhook", vec![message.to_owned()])
}
