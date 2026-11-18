//! Durable tenant-scoped issuance and cancellation worker.
use super::{EInvoiceProvider, HttpEInvoiceProvider, HttpEInvoiceProviderConfig};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use futures::{StreamExt, stream};
use serde_json::{Map, Value};
use std::{env, time::Duration};
use uuid::Uuid;

const BATCH_SIZE: i64 = 10;
const LEASE_SECONDS: i64 = 180;
const DEFAULT_PROVIDER_CONCURRENCY: usize = 2;
const MAX_PROVIDER_CONCURRENCY: usize = 16;
const MAX_AUTOMATIC_ATTEMPTS: i64 = 8;

struct Job {
    tenant_id: String,
    id: Uuid,
    lease_token: String,
    operation: String,
    request_payload: Value,
    provider_reference: Option<String>,
    cancellation_reason: Option<String>,
    attempts: i64,
}

/// Process one bounded batch from every tenant with e-invoice enabled.
/// Without OSP_EINVOICE_ENDPOINT the queue remains untouched.
pub async fn run_once(kernel: &Kernel) -> R<usize> {
    let Some(provider) = configured_provider()? else {
        return Ok(0);
    };
    run_once_with_provider(kernel, &provider).await
}

/// Process a bounded batch using an injected vendor adapter.
pub async fn run_once_with_provider(kernel: &Kernel, provider: &dyn EInvoiceProvider) -> R<usize> {
    let concurrency = provider_concurrency()?;
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
    let mut processed = 0;
    for tenant_id in tenant_ids {
        let tenant = match kernel.tenant(&tenant_id).await {
            Ok(tenant) => tenant,
            Err(error) => {
                tracing::warn!(tenant_id = %tenant_id, error = %error, "e-invoice worker could not load tenant");
                continue;
            }
        };
        if tenant.suspended || !tenant.has_module("einvoice") {
            continue;
        }
        let jobs = claim(kernel, &tenant, BATCH_SIZE).await?;
        processed += jobs.len();
        stream::iter(jobs)
            .for_each_concurrent(concurrency, |job| {
                let tenant = tenant.clone();
                async move {
                    if let Err(error) = process(kernel, &tenant, provider, &job).await {
                        tracing::error!(einvoice_id = %job.id, tenant_id = %job.tenant_id, error = %error, "e-invoice job failed");
                    }
                }
            })
            .await;
    }
    Ok(processed)
}

fn provider_concurrency() -> R<usize> {
    let Ok(value) = env::var("OSP_EINVOICE_CONCURRENCY") else {
        return Ok(DEFAULT_PROVIDER_CONCURRENCY);
    };
    value
        .parse::<usize>()
        .ok()
        .filter(|value| (1..=MAX_PROVIDER_CONCURRENCY).contains(value))
        .ok_or_else(|| {
            ApiError::new(
                500,
                "EINVOICE_CONFIG",
                format!(
                    "OSP_EINVOICE_CONCURRENCY must be between 1 and {MAX_PROVIDER_CONCURRENCY}"
                ),
            )
        })
}

fn configured_provider() -> R<Option<HttpEInvoiceProvider>> {
    let Ok(endpoint) = env::var("OSP_EINVOICE_ENDPOINT") else {
        return Ok(None);
    };
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Ok(None);
    }
    let timeout = match env::var("OSP_EINVOICE_TIMEOUT_SEC") {
        Ok(value) => value
            .parse::<u64>()
            .ok()
            .filter(|seconds| (1..=120).contains(seconds))
            .ok_or_else(|| {
                ApiError::new(
                    500,
                    "EINVOICE_CONFIG",
                    "OSP_EINVOICE_TIMEOUT_SEC must be between 1 and 120",
                )
            })?,
        Err(_) => 30,
    };
    Ok(Some(HttpEInvoiceProvider::new(
        HttpEInvoiceProviderConfig {
            code: env::var("OSP_EINVOICE_PROVIDER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "rest".into()),
            endpoint: endpoint.to_owned(),
            bearer_token: env::var("OSP_EINVOICE_TOKEN").ok(),
            timeout: Duration::from_secs(timeout),
        },
    )?))
}

async fn claim(kernel: &Kernel, tenant: &Tenant, limit: i64) -> R<Vec<Job>> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let lease_token = Uuid::new_v4().to_string();
    let rows = tx
        .query(
            "WITH ready AS ( \
               SELECT id FROM einvoice__einvoice \
               WHERE tenant_id = $1 AND status IN ('pending', 'cancellation_pending') \
                 AND (lease_until IS NULL OR lease_until <= now()) \
               ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $2 \
             ) \
             UPDATE einvoice__einvoice e \
             SET attempts = COALESCE(e.attempts, 0) + 1, lease_until = now() + ($3::bigint * interval '1 second'), lease_token = $4, updated_at = now() \
             FROM ready WHERE e.tenant_id = $1 AND e.id = ready.id \
             RETURNING e.id, e.operation, e.request_payload, e.provider_reference, e.cancellation_reason, e.attempts::bigint",
            &[&tenant.id, &limit, &LEASE_SECONDS, &lease_token],
        )
        .await?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|row| Job {
            tenant_id: tenant.id.clone(),
            id: row.get(0),
            lease_token: lease_token.clone(),
            operation: row
                .get::<_, Option<String>>(1)
                .unwrap_or_else(|| "issue".into()),
            request_payload: row.get::<_, Option<Value>>(2).unwrap_or(Value::Null),
            provider_reference: row.get(3),
            cancellation_reason: row.get(4),
            attempts: row.get(5),
        })
        .collect())
}

async fn process(
    kernel: &Kernel,
    tenant: &Tenant,
    provider: &dyn EInvoiceProvider,
    job: &Job,
) -> R<()> {
    let result = match job.operation.as_str() {
        "issue" => {
            let mut request = job.request_payload.clone();
            if let Some(object) = request.as_object_mut() {
                object.insert("idempotency_key".into(), Value::String(job.id.to_string()));
            }
            provider.issue(&tenant.id, &request).await.map(|result| {
                let mut patch = Map::new();
                patch.insert("provider".into(), Value::String(provider.code().to_owned()));
                patch.insert("number".into(), Value::String(result.number));
                put_optional(&mut patch, "serial", result.serial);
                put_optional(&mut patch, "lookup_code", result.lookup_code);
                put_optional(&mut patch, "provider_reference", result.provider_reference);
                patch.insert("provider_response".into(), result.response);
                patch.insert("provider_error".into(), Value::Null);
                patch.insert("lease_until".into(), Value::Null);
                patch.insert("lease_token".into(), Value::Null);
                ("issued", patch)
            })
        }
        "cancel" => {
            let reference = job.provider_reference.as_deref().unwrap_or_default();
            let reason = job.cancellation_reason.as_deref().unwrap_or_default();
            provider
                .cancel(&tenant.id, reference, reason)
                .await
                .map(|result| {
                    let mut patch = Map::new();
                    if let Some(reference) = result.provider_reference {
                        patch.insert("provider_reference".into(), Value::String(reference));
                    }
                    patch.insert("cancellation_response".into(), result.response);
                    patch.insert("provider_error".into(), Value::Null);
                    patch.insert("lease_until".into(), Value::Null);
                    patch.insert("lease_token".into(), Value::Null);
                    ("cancelled", patch)
                })
        }
        _ => Err(ApiError::new(
            500,
            "EINVOICE_OPERATION",
            "Unsupported e-invoice operation",
        )),
    };
    match result {
        Ok((action, mut patch)) => {
            patch.insert("retry_at".into(), Value::Null);
            finish(kernel, tenant, job, action, patch).await
        }
        Err(error) => {
            let mut patch = Map::new();
            patch.insert(
                "provider_error".into(),
                Value::String(format!("{}: {}", error.code, error.message)),
            );
            let retry_at =
                if is_transient_provider_error(&error) && job.attempts < MAX_AUTOMATIC_ATTEMPTS {
                    let delay = retry_delay_seconds(job.attempts);
                    let next = chrono::Utc::now()
                        .checked_add_signed(chrono::Duration::seconds(delay))
                        .ok_or_else(|| {
                            ApiError::internal("E-invoice retry time exceeds supported date range")
                        })?;
                    Some(Value::String(next.to_rfc3339()))
                } else {
                    None
                };
            patch.insert("retry_at".into(), retry_at.unwrap_or(Value::Null));
            patch.insert("lease_until".into(), Value::Null);
            patch.insert("lease_token".into(), Value::Null);
            finish(kernel, tenant, job, "failed", patch).await
        }
    }
}

fn is_transient_provider_error(error: &ApiError) -> bool {
    matches!(
        error.code.as_str(),
        "EINVOICE_PROVIDER_UNAVAILABLE" | "EINVOICE_PROVIDER_TEMPORARY"
    )
}

fn retry_delay_seconds(attempts: i64) -> i64 {
    let exponent = attempts.saturating_sub(1).clamp(0, 9) as u32;
    (60_i64 * 2_i64.pow(exponent)).min(6 * 60 * 60)
}

async fn finish(
    kernel: &Kernel,
    tenant: &Tenant,
    job: &Job,
    action: &str,
    patch: Map<String, Value>,
) -> R<()> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &job.tenant_id, true).await?;
    let lease = tx
        .query_opt(
            "SELECT lease_token FROM einvoice__einvoice WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&job.tenant_id, &job.id],
        )
        .await?;
    if lease
        .as_ref()
        .and_then(|row| row.get::<_, Option<String>>(0))
        .as_deref()
        != Some(job.lease_token.as_str())
    {
        tx.commit().await?;
        return Ok(());
    }
    let entity = kernel.ent(tenant, "einvoice.einvoice")?;
    kernel
        .update_in(
            &tx,
            &Actor::System,
            tenant,
            &entity,
            &job.id.to_string(),
            patch,
            &Opts::top(),
        )
        .await?;
    kernel
        .act_in(
            &tx,
            &Actor::System,
            tenant,
            &entity,
            &job.id.to_string(),
            action,
            &Opts::top(),
        )
        .await?;
    tx.commit().await
}

fn put_optional(patch: &mut Map<String, Value>, key: &str, value: Option<String>) {
    patch.insert(
        key.to_owned(),
        value.map(Value::String).unwrap_or(Value::Null),
    );
}
