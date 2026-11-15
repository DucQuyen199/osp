//! Tenant-scoped notification delivery worker.
mod smtp;

use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Kernel,
};
use futures::{StreamExt, stream};
use serde_json::json;
use std::{env, time::Duration};
use uuid::Uuid;

const BATCH_SIZE: i64 = 20;
const MAX_ATTEMPTS: i64 = 8;
const DEFAULT_DELIVERY_CONCURRENCY: usize = 4;
const MAX_DELIVERY_CONCURRENCY: usize = 64;

#[derive(Clone)]
struct Provider {
    channel: &'static str,
    endpoint: String,
    token: Option<String>,
    sender: Option<String>,
}

struct Message {
    tenant_id: String,
    id: Uuid,
    channel: String,
    recipient: Option<String>,
    recipient_email: Option<String>,
    subject: Option<String>,
    body: Option<String>,
    attachment_name: Option<String>,
    attachment_content_type: Option<String>,
    attachment_content: Option<String>,
    attempts: i64,
    is_auth: bool,
}

struct Failure {
    retryable: bool,
    message: &'static str,
}

#[derive(Clone, Copy)]
enum DeliveryTarget<'a> {
    Smtp(&'a smtp::SmtpSender),
    Provider(&'a Provider),
}

fn delivery_concurrency() -> R<usize> {
    let Ok(value) = env::var("OSP_COMM_CONCURRENCY") else {
        return Ok(DEFAULT_DELIVERY_CONCURRENCY);
    };
    value
        .parse::<usize>()
        .ok()
        .filter(|value| (1..=MAX_DELIVERY_CONCURRENCY).contains(value))
        .ok_or_else(|| {
            ApiError::new(
                500,
                "COMM_CONFIG",
                format!("OSP_COMM_CONCURRENCY must be between 1 and {MAX_DELIVERY_CONCURRENCY}"),
            )
        })
}

async fn process_batch(
    kernel: &Kernel,
    messages: Vec<Message>,
    target: DeliveryTarget<'_>,
    authentication_mail: bool,
    concurrency: usize,
) -> u32 {
    let count = messages.len() as u32;
    stream::iter(messages)
        .for_each_concurrent(concurrency, |message| async move {
            let result = match target {
                DeliveryTarget::Smtp(sender) => deliver_smtp(kernel, sender, &message).await,
                DeliveryTarget::Provider(provider) => deliver(kernel, provider, &message).await,
            };
            let result = if authentication_mail {
                process_auth_delivery(kernel, &message, result).await
            } else {
                process_delivery(kernel, &message, result).await
            };
            if let Err(error) = result {
                tracing::error!(
                    tenant_id = %message.tenant_id,
                    message_id = %message.id,
                    error = %error,
                    "communication delivery state could not be saved"
                );
            }
        })
        .await;
    count
}

fn providers() -> Vec<Provider> {
    [
        (
            "email",
            "OSP_COMM_EMAIL_ENDPOINT",
            "OSP_COMM_EMAIL_TOKEN",
            "OSP_COMM_EMAIL_FROM",
        ),
        (
            "sms",
            "OSP_COMM_SMS_ENDPOINT",
            "OSP_COMM_SMS_TOKEN",
            "OSP_COMM_SMS_FROM",
        ),
    ]
    .into_iter()
    .filter_map(|(channel, endpoint_key, token_key, sender_key)| {
        let endpoint = env::var(endpoint_key).ok()?.trim().to_owned();
        if endpoint.is_empty() {
            return None;
        }
        Some(Provider {
            channel,
            endpoint,
            token: env::var(token_key).ok().filter(|value| !value.is_empty()),
            sender: env::var(sender_key).ok().filter(|value| !value.is_empty()),
        })
    })
    .collect()
}

/// Claims and delivers a bounded batch. No provider configuration means the
/// queue remains untouched; network requests happen outside PostgreSQL txs.
pub async fn run_once(kernel: &Kernel) -> R<u32> {
    let providers = providers();
    let smtp = smtp::SmtpSender::from_env()?;
    if providers.is_empty() && smtp.is_none() {
        return Ok(0);
    }
    let concurrency = delivery_concurrency()?;
    let tenant_ids: Vec<String> = {
        let conn = kernel.pool.get().await?;
        conn.query(
            "SELECT id FROM osp_tenants WHERE NOT suspended ORDER BY id",
            &[],
        )
        .await?
        .into_iter()
        .map(|row| row.get(0))
        .collect()
    };
    let mut processed = 0_u32;
    for tenant_id in tenant_ids {
        let tenant = match kernel.tenant(&tenant_id).await {
            Ok(tenant) => tenant,
            Err(error) => {
                tracing::warn!(tenant_id = %tenant_id, error = %error, "communication worker could not load tenant");
                continue;
            }
        };
        if tenant.suspended {
            continue;
        }
        if let Some(smtp) = &smtp {
            processed += process_batch(
                kernel,
                claim_auth_mail(kernel, &tenant_id).await?,
                DeliveryTarget::Smtp(smtp),
                true,
                concurrency,
            )
            .await;
        } else {
            for provider in providers
                .iter()
                .filter(|provider| provider.channel == "email")
            {
                processed += process_batch(
                    kernel,
                    claim_auth_mail(kernel, &tenant_id).await?,
                    DeliveryTarget::Provider(provider),
                    true,
                    concurrency,
                )
                .await;
            }
        }
        if !tenant.has_module("communication") {
            continue;
        }
        if let Some(smtp) = &smtp {
            processed += process_batch(
                kernel,
                claim(kernel, &tenant_id, "email").await?,
                DeliveryTarget::Smtp(smtp),
                false,
                concurrency,
            )
            .await;
        }
        for provider in providers
            .iter()
            .filter(|provider| !(smtp.is_some() && provider.channel == "email"))
        {
            processed += process_batch(
                kernel,
                claim(kernel, &tenant_id, provider.channel).await?,
                DeliveryTarget::Provider(provider),
                false,
                concurrency,
            )
            .await;
        }
    }
    Ok(processed)
}

async fn claim_auth_mail(kernel: &Kernel, tenant_id: &str) -> R<Vec<Message>> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, tenant_id, true).await?;
    tx.execute(
        "UPDATE osp_auth_mail_outbox m SET status = 'failed', body = '', last_error = 'authentication link expired before delivery', updated_at = now() WHERE m.tenant_id = $1 AND m.status IN ('queued', 'retry', 'processing') AND ((m.created_at <= now() - interval '30 minutes' AND EXISTS (SELECT 1 FROM osp_sessions s WHERE s.tenant_id = m.tenant_id AND s.user_id = m.user_id AND s.kind = 'reset' AND s.created_at <= m.created_at)) OR (m.created_at <= now() - interval '24 hours' AND EXISTS (SELECT 1 FROM osp_sessions s WHERE s.tenant_id = m.tenant_id AND s.user_id = m.user_id AND s.kind = 'verify_email' AND s.created_at <= m.created_at)))",
        &[&tenant_id],
    )
    .await?;
    let rows = tx
        .query(
            "WITH ready AS (SELECT id FROM osp_auth_mail_outbox WHERE tenant_id = $1 AND ((status IN ('queued', 'retry') AND available_at <= now()) OR (status = 'processing' AND available_at <= now())) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE osp_auth_mail_outbox m SET status = 'processing', attempts = m.attempts + 1, available_at = now() + interval '2 minutes', last_error = NULL, updated_at = now() FROM ready WHERE m.tenant_id = $1 AND m.id = ready.id RETURNING m.id, m.recipient, m.subject, m.body, m.attempts::bigint",
            &[&tenant_id, &BATCH_SIZE],
        )
        .await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|row| Message {
            tenant_id: tenant_id.to_owned(),
            id: row.get(0),
            channel: "email".into(),
            recipient: row.get(1),
            recipient_email: Some(row.get(1)),
            subject: row.get(2),
            body: row.get(3),
            attachment_name: None,
            attachment_content_type: None,
            attachment_content: None,
            attempts: row.get(4),
            is_auth: true,
        })
        .collect())
}

async fn finish_auth_mail(
    kernel: &Kernel,
    message: &Message,
    status: &str,
    error: Option<&str>,
    retry_after: Option<u64>,
) -> R<()> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &message.tenant_id, true).await?;
    tx.execute(
        "UPDATE osp_auth_mail_outbox SET status = $3, body = CASE WHEN $3 IN ('sent', 'failed') THEN '' ELSE body END, last_error = $4, available_at = CASE WHEN $5::bigint IS NULL THEN now() ELSE now() + ($5 * interval '1 second') END, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'processing'",
        &[&message.tenant_id, &message.id, &status, &error, &retry_after.map(|value| value as i64)],
    )
    .await?;
    tx.commit().await
}

fn retry_delay(attempts: i64) -> u64 {
    let exponent = attempts.clamp(1, 8) as u32 - 1;
    (15_u64.saturating_mul(2_u64.pow(exponent))).min(3600)
}

async fn claim(kernel: &Kernel, tenant_id: &str, channel: &str) -> R<Vec<Message>> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, tenant_id, true).await?;
    let rows = tx
        .query(
            "WITH ready AS (SELECT id FROM communication__message_log WHERE tenant_id = $1 AND channel = $2 AND ((status IN ('queued', 'retry') AND (available_at IS NULL OR available_at <= now())) OR (status = 'processing' AND (available_at IS NULL OR available_at <= now()))) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $3) UPDATE communication__message_log m SET status = 'processing', attempts = COALESCE(m.attempts, 0) + 1, available_at = now() + interval '2 minutes', last_error = NULL, updated_at = now() FROM ready WHERE m.tenant_id = $1 AND m.id = ready.id RETURNING m.id, m.channel, m.recipient, m.recipient_email, m.subject, m.body, m.attachment_name, m.attachment_content_type, m.attachment_content, COALESCE(m.attempts, 1)::bigint",
            &[&tenant_id, &channel, &BATCH_SIZE],
        )
        .await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|row| Message {
            tenant_id: tenant_id.to_owned(),
            id: row.get(0),
            channel: row.get(1),
            recipient: row.get(2),
            recipient_email: row.get(3),
            subject: row.get(4),
            body: row.get(5),
            attachment_name: row.get(6),
            attachment_content_type: row.get(7),
            attachment_content: row.get(8),
            attempts: row.get(9),
            is_auth: false,
        })
        .collect())
}

async fn deliver(kernel: &Kernel, provider: &Provider, message: &Message) -> Result<(), Failure> {
    let endpoint = reqwest::Url::parse(&provider.endpoint).map_err(|_| Failure {
        retryable: false,
        message: "provider endpoint is invalid",
    })?;
    if endpoint.scheme() != "https"
        || endpoint.host().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return Err(Failure {
            retryable: false,
            message: "provider endpoint must use HTTPS without embedded credentials",
        });
    }
    let destination = resolve_destination(kernel, message, provider.channel).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Failure {
            retryable: true,
            message: "HTTP client initialization failed",
        })?;
    let mut request = client.post(endpoint).json(&json!({
        "channel": message.channel,
        "to": destination,
        "from": provider.sender,
        "subject": message.subject,
        "text": message.body,
        "attachment": match (&message.attachment_name, &message.attachment_content_type, &message.attachment_content) {
            (Some(name), Some(content_type), Some(content)) => Some(json!({ "filename": name, "contentType": content_type, "content": content })),
            _ => None,
        },
        "tenantId": message.tenant_id,
        "messageId": message.id,
    }));
    if let Some(token) = &provider.token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|_| Failure {
        retryable: true,
        message: "provider connection failed",
    })?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Err(Failure {
            retryable: true,
            message: "provider temporarily rejected delivery",
        })
    } else {
        Err(Failure {
            retryable: false,
            message: "provider rejected delivery",
        })
    }
}

async fn deliver_smtp(
    kernel: &Kernel,
    smtp: &smtp::SmtpSender,
    message: &Message,
) -> Result<(), Failure> {
    let destination = resolve_destination(kernel, message, "email").await?;
    smtp.send(
        &destination,
        message.subject.as_deref().unwrap_or_default(),
        message.body.as_deref().unwrap_or_default(),
        message.attachment_name.as_deref(),
        message.attachment_content_type.as_deref(),
        message.attachment_content.as_deref(),
    )
    .await
}

async fn resolve_destination(
    kernel: &Kernel,
    message: &Message,
    channel: &str,
) -> Result<String, Failure> {
    if let Some(address) = message
        .recipient_email
        .as_deref()
        .map(str::trim)
        .filter(|address| !address.is_empty())
    {
        if channel != "email" || address.parse::<lettre::message::Mailbox>().is_err() {
            return Err(Failure {
                retryable: false,
                message: "direct recipient address is invalid for this channel",
            });
        }
        return Ok(address.to_owned());
    }
    if message.is_auth {
        if channel != "email" {
            return Err(Failure {
                retryable: false,
                message: "authentication mail cannot use a non-email channel",
            });
        }
        return message
            .recipient
            .as_deref()
            .map(str::trim)
            .filter(|address| !address.is_empty())
            .map(str::to_owned)
            .ok_or(Failure {
                retryable: false,
                message: "authentication message has no email recipient",
            });
    }
    let recipient_value = message
        .recipient
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    let Some(recipient_id) = Uuid::parse_str(recipient_value).ok() else {
        // Older BI snapshots stored literal email addresses in `recipient`.
        // Continue delivering those queued rows while all new messages use
        // the explicit recipient_email field.
        if channel == "email" && recipient_value.parse::<lettre::message::Mailbox>().is_ok() {
            return Ok(recipient_value.to_owned());
        }
        return Err(Failure {
            retryable: false,
            message: "message has no valid tenant recipient",
        });
    };
    let tenant = kernel
        .tenant(&message.tenant_id)
        .await
        .map_err(|_| Failure {
            retryable: true,
            message: "tenant lookup failed",
        })?;
    let mut conn = kernel.pool.get().await.map_err(|_| Failure {
        retryable: true,
        message: "database unavailable during recipient lookup",
    })?;
    let tx = Tx::begin(&mut conn, &tenant.id, false)
        .await
        .map_err(|_| Failure {
            retryable: true,
            message: "database unavailable during recipient lookup",
        })?;
    let row = tx
        .query_opt(
            "SELECT email, phone FROM master_data__party WHERE tenant_id = $1 AND id = $2",
            &[&tenant.id, &recipient_id],
        )
        .await
        .map_err(|_| Failure {
            retryable: true,
            message: "database unavailable during recipient lookup",
        })?;
    tx.commit().await.map_err(|_| Failure {
        retryable: true,
        message: "database unavailable during recipient lookup",
    })?;
    let Some(row) = row else {
        return Err(Failure {
            retryable: false,
            message: "recipient was not found in this tenant",
        });
    };
    let destination: Option<String> = if channel == "email" {
        row.get(0)
    } else {
        row.get(1)
    };
    destination
        .filter(|value| !value.trim().is_empty())
        .ok_or(Failure {
            retryable: false,
            message: "recipient has no address for this channel",
        })
}

async fn process_auth_delivery(
    kernel: &Kernel,
    message: &Message,
    result: Result<(), Failure>,
) -> R<()> {
    let (status, error, retry_after) = delivery_state(message.attempts, result);
    finish_auth_mail(kernel, message, status, error, retry_after).await
}

async fn process_delivery(
    kernel: &Kernel,
    message: &Message,
    result: Result<(), Failure>,
) -> R<()> {
    let (status, error, retry_after) = delivery_state(message.attempts, result);
    finish(kernel, message, status, error, retry_after).await
}

fn delivery_state(
    attempts: i64,
    result: Result<(), Failure>,
) -> (&'static str, Option<&'static str>, Option<u64>) {
    match result {
        Ok(()) => ("sent", None, None),
        Err(failure) => {
            let terminal = !failure.retryable || attempts >= MAX_ATTEMPTS;
            let status = if terminal { "failed" } else { "retry" };
            let delay = retry_delay(attempts);
            (status, Some(failure.message), (!terminal).then_some(delay))
        }
    }
}

async fn finish(
    kernel: &Kernel,
    message: &Message,
    status: &str,
    error: Option<&str>,
    retry_after: Option<u64>,
) -> R<()> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &message.tenant_id, true).await?;
    tx.execute(
        "UPDATE communication__message_log SET status = $3, last_error = $4, available_at = CASE WHEN $5::bigint IS NULL THEN NULL ELSE now() + ($5 * interval '1 second') END, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'processing'",
        &[&message.tenant_id, &message.id, &status, &error, &retry_after.map(|value| value as i64)],
    )
    .await?;
    tx.commit().await
}
