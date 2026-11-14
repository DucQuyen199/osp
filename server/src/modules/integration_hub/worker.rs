//! Durable webhook delivery worker with leases, bounded retries, and SSRF guards.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use futures::{StreamExt, stream};
use hmac::{Hmac, KeyInit, Mac};
use reqwest::redirect::Policy;
use serde_json::Value;
use sha2::Sha256;
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};
use tokio::net::lookup_host;
use url::{Host, Url};
use uuid::Uuid;

const BATCH_SIZE: i64 = 20;
const MAX_ATTEMPTS: i32 = 8;

struct Delivery {
    id: Uuid,
    tenant_id: String,
    webhook_id: Uuid,
    event_type: String,
    payload: Value,
    attempts: i32,
}

struct Destination {
    url: String,
    secret: Option<String>,
    events: Option<Value>,
}

/// Claim and deliver one bounded batch. The function can be called by the
/// embedded worker or from an operational command without changing delivery
/// semantics.
pub async fn run_once(kernel: &Kernel) -> R<usize> {
    let deliveries = claim(kernel).await?;
    let count = deliveries.len();
    stream::iter(deliveries)
        .for_each_concurrent(8, |delivery| async move {
            if let Err(error) = process(kernel, &delivery).await {
                tracing::error!(outbox_id = %delivery.id, error = %error, "outbox item processing failed");
            }
        })
        .await;
    Ok(count)
}

pub async fn list_deliveries(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    status: &str,
) -> R<Value> {
    kernel.authorize(tenant, actor, "tenant.admin")?;
    if !matches!(
        status,
        "pending" | "processing" | "retry" | "delivered" | "dead" | "cancelled"
    ) {
        return Err(ApiError::new(
            400,
            "INVALID_STATUS",
            "Unsupported outbox status",
        ));
    }
    let conn = kernel.pool.get().await?;
    let rows = conn.query(
        "SELECT jsonb_build_object('id', id, 'webhookId', webhook_id, 'eventId', event_id, 'eventType', event_type, 'status', status, 'attempts', attempts, 'error', last_error, 'createdAt', created_at, 'deliveredAt', delivered_at) FROM osp_outbox WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 200",
        &[&tenant.id, &status],
    ).await?;
    Ok(Value::Array(
        rows.into_iter().map(|row| row.get(0)).collect(),
    ))
}

pub async fn dead_delivery_count(kernel: &Kernel, tenant: &Tenant) -> R<i64> {
    let conn = kernel.pool.get().await?;
    Ok(conn
        .query_one(
            "SELECT count(*) FROM osp_outbox WHERE tenant_id = $1 AND status = 'dead'",
            &[&tenant.id],
        )
        .await?
        .get(0))
}

pub async fn retry_delivery(kernel: &Kernel, actor: &Actor, tenant: &Tenant, id: &str) -> R<()> {
    kernel.authorize(tenant, actor, "tenant.admin")?;
    let id = Uuid::parse_str(id).map_err(|_| ApiError::not_found("Outbox item not found"))?;
    let conn = kernel.pool.get().await?;
    let changed = conn.execute(
        "UPDATE osp_outbox SET status = 'pending', attempts = 0, available_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1 AND tenant_id = $2 AND status = 'dead'",
        &[&id, &tenant.id],
    ).await?;
    if changed == 0 {
        return Err(ApiError::not_found("Dead-letter item not found"));
    }
    Ok(())
}

pub async fn dismiss_delivery(kernel: &Kernel, actor: &Actor, tenant: &Tenant, id: &str) -> R<()> {
    kernel.authorize(tenant, actor, "tenant.admin")?;
    let id = Uuid::parse_str(id).map_err(|_| ApiError::not_found("Outbox item not found"))?;
    let conn = kernel.pool.get().await?;
    let changed = conn.execute(
        "UPDATE osp_outbox SET status = 'cancelled', locked_at = NULL WHERE id = $1 AND tenant_id = $2 AND status = 'dead'",
        &[&id, &tenant.id],
    ).await?;
    if changed == 0 {
        return Err(ApiError::not_found("Dead-letter item not found"));
    }
    Ok(())
}

async fn claim(kernel: &Kernel) -> R<Vec<Delivery>> {
    let mut conn = kernel.pool.get().await?;
    let tx = conn.transaction().await?;
    let rows = tx
        .query(
            "WITH ready AS ( \
               SELECT id FROM osp_outbox \
               WHERE ((status IN ('pending', 'retry') AND available_at <= now()) \
                   OR (status = 'processing' AND locked_at < now() - interval '2 minutes')) \
               ORDER BY available_at, created_at \
               FOR UPDATE SKIP LOCKED LIMIT $1 \
             ) \
             UPDATE osp_outbox o \
             SET status = 'processing', attempts = o.attempts + 1, locked_at = now() \
             FROM ready WHERE o.id = ready.id \
             RETURNING o.id, o.tenant_id, o.webhook_id, o.event_type, o.payload, o.attempts",
            &[&BATCH_SIZE],
        )
        .await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|row| Delivery {
            id: row.get(0),
            tenant_id: row.get(1),
            webhook_id: row.get(2),
            event_type: row.get(3),
            payload: row.get(4),
            attempts: row.get(5),
        })
        .collect())
}

async fn process(kernel: &Kernel, delivery: &Delivery) -> R<()> {
    let Some(destination) = load_destination(kernel, delivery).await? else {
        finish_cancelled(kernel, delivery.id).await?;
        return Ok(());
    };
    if !crate::modules::integration_hub::application::subscribes_to(
        destination.events.as_ref(),
        &delivery.event_type,
    ) {
        finish_cancelled(kernel, delivery.id).await?;
        return Ok(());
    }
    match send(&destination, delivery).await {
        Ok(()) => finish_delivered(kernel, delivery.id).await,
        Err(failure) => finish_failed(kernel, delivery, failure).await,
    }
}

async fn load_destination(kernel: &Kernel, delivery: &Delivery) -> R<Option<Destination>> {
    let tenant = kernel.tenant(&delivery.tenant_id).await?;
    if tenant.suspended || !tenant.has_module("integration-hub") {
        return Ok(None);
    }
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &delivery.tenant_id, false).await?;
    let row = tx
        .query_opt(
            "SELECT url, secret, events FROM integration_hub__webhook WHERE tenant_id = $1 AND id = $2 AND active = true",
            &[&delivery.tenant_id, &delivery.webhook_id],
        )
        .await?;
    tx.commit().await?;
    Ok(row.map(|row| Destination {
        url: row.get(0),
        secret: row.get(1),
        events: row.get(2),
    }))
}

async fn send(destination: &Destination, delivery: &Delivery) -> Result<(), Failure> {
    let url =
        Url::parse(&destination.url).map_err(|_| Failure::permanent("invalid webhook URL"))?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(Failure::permanent("webhook URL violates HTTPS policy"));
    }
    let host = url
        .host()
        .ok_or_else(|| Failure::permanent("webhook URL has no host"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15));
    match host {
        Host::Domain(domain) => {
            let resolved: Vec<SocketAddr> = lookup_host((domain, port))
                .await
                .map_err(|_| Failure::retryable("webhook DNS resolution failed"))?
                .collect();
            if resolved.is_empty() || resolved.iter().any(|address| !is_public_ip(address.ip())) {
                return Err(Failure::permanent(
                    "webhook host resolves to a private or reserved address",
                ));
            }
            let pinned: Vec<SocketAddr> = resolved
                .iter()
                .map(|address| SocketAddr::new(address.ip(), 0))
                .collect();
            builder = builder.resolve_to_addrs(domain, &pinned);
        }
        Host::Ipv4(address) if is_public_ip(IpAddr::V4(address)) => {}
        Host::Ipv6(address) if is_public_ip(IpAddr::V6(address)) => {}
        _ => return Err(Failure::permanent("webhook host is not publicly routable")),
    }

    let client = builder
        .build()
        .map_err(|_| Failure::retryable("webhook HTTP client initialization failed"))?;
    let body = serde_json::to_vec(&delivery.payload)
        .map_err(|_| Failure::permanent("webhook event serialization failed"))?;
    let mut request = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            "X-OSP-Event-Id",
            delivery.payload["id"].as_str().unwrap_or_default(),
        )
        .header("X-OSP-Event-Type", &delivery.event_type);
    if let Some(secret) = destination
        .secret
        .as_deref()
        .filter(|secret| !secret.is_empty())
    {
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret.as_bytes())
            .map_err(|_| Failure::permanent("webhook signing configuration is invalid"))?;
        mac.update(&body);
        request = request.header(
            "X-OSP-Signature",
            format!("sha256={}", hex::encode(mac.finalize().into_bytes())),
        );
    }
    let response = request.body(body).send().await.map_err(|error| {
        if error.is_timeout() {
            Failure::retryable("webhook request timed out")
        } else {
            Failure::retryable("webhook connection or TLS request failed")
        }
    })?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else if status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429 {
        Err(Failure::permanent(format!(
            "webhook returned HTTP {}",
            status.as_u16()
        )))
    } else {
        Err(Failure::retryable(format!(
            "webhook returned HTTP {}",
            status.as_u16()
        )))
    }
}

struct Failure {
    permanent: bool,
    message: String,
}

impl Failure {
    fn permanent(message: impl Into<String>) -> Self {
        Self {
            permanent: true,
            message: message.into(),
        }
    }

    fn retryable(message: impl Into<String>) -> Self {
        Self {
            permanent: false,
            message: message.into(),
        }
    }
}

async fn finish_delivered(kernel: &Kernel, id: Uuid) -> R<()> {
    let conn = kernel.pool.get().await?;
    conn.execute(
        "UPDATE osp_outbox SET status = 'delivered', delivered_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1 AND status = 'processing'",
        &[&id],
    )
    .await?;
    Ok(())
}

async fn finish_cancelled(kernel: &Kernel, id: Uuid) -> R<()> {
    let conn = kernel.pool.get().await?;
    conn.execute(
        "UPDATE osp_outbox SET status = 'cancelled', locked_at = NULL WHERE id = $1 AND status = 'processing'",
        &[&id],
    )
    .await?;
    Ok(())
}

async fn finish_failed(kernel: &Kernel, delivery: &Delivery, failure: Failure) -> R<()> {
    let dead = failure.permanent || delivery.attempts >= MAX_ATTEMPTS;
    let status = if dead { "dead" } else { "retry" };
    let backoff = 5_i64
        .saturating_mul(1_i64 << (delivery.attempts.saturating_sub(1).clamp(0, 10) as u32))
        .min(3600);
    let conn = kernel.pool.get().await?;
    conn.execute(
        "UPDATE osp_outbox SET status = $2, available_at = now() + ($3 * interval '1 second'), locked_at = NULL, last_error = $4 WHERE id = $1 AND status = 'processing'",
        &[&delivery.id, &status, &backoff, &failure.message],
    )
    .await?;
    if dead {
        tracing::warn!(outbox_id = %delivery.id, event_type = %delivery.event_type, attempts = delivery.attempts, error = %failure.message, "webhook delivery moved to dead-letter");
    }
    Ok(())
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_unspecified()
        || address.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && (b == 0 || b == 168))
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19 || b == 51))
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let global_unicast = segments[0] & 0xe000 == 0x2000;
    let special_2001 = segments[0] == 0x2001 && segments[1] <= 0x01ff;
    let documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0);
    global_unicast && !special_2001 && !documentation && segments[0] != 0x2002
}
