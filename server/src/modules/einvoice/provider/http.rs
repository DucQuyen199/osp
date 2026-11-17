//! Configurable HTTPS adapter for providers that implement the OSP REST contract.
use super::{CancellationResult, EInvoiceProvider, IssueResult};
use crate::error::{ApiError, R};
use futures::future::BoxFuture;
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde_json::{Value, json};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct HttpEInvoiceProviderConfig {
    pub code: String,
    pub endpoint: String,
    pub bearer_token: Option<String>,
    pub timeout: Duration,
}

/// HTTP client for an explicitly configured REST-compatible invoice service.
/// Vendor-specific SDKs should implement [`EInvoiceProvider`] directly when
/// they use a different payload or response contract.
#[derive(Clone)]
pub struct HttpEInvoiceProvider {
    code: String,
    endpoint: Url,
    bearer_token: Option<String>,
    client: Client,
}

impl HttpEInvoiceProvider {
    pub fn new(config: HttpEInvoiceProviderConfig) -> R<Self> {
        let endpoint = Url::parse(config.endpoint.trim())
            .map_err(|_| ApiError::new(500, "EINVOICE_CONFIG", "E-invoice endpoint is invalid"))?;
        if endpoint.scheme() != "https"
            || endpoint.host().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || config.code.trim().is_empty()
            || config.timeout.is_zero()
            || config.timeout > Duration::from_secs(120)
        {
            return Err(ApiError::new(
                500,
                "EINVOICE_CONFIG",
                "E-invoice provider requires a code, HTTPS endpoint, and positive timeout",
            ));
        }
        let client = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(config.timeout.min(Duration::from_secs(10)))
            .timeout(config.timeout)
            .build()
            .map_err(|_| ApiError::new(500, "EINVOICE_CONFIG", "Cannot build provider client"))?;
        Ok(Self {
            code: config.code.trim().to_owned(),
            endpoint,
            bearer_token: config
                .bearer_token
                .map(|token| token.trim().to_owned())
                .filter(|token| !token.is_empty()),
            client,
        })
    }

    fn cancellation_endpoint(&self, provider_reference: &str) -> R<Url> {
        let mut endpoint = self.endpoint.clone();
        endpoint
            .path_segments_mut()
            .map_err(|_| ApiError::new(500, "EINVOICE_CONFIG", "Provider URL cannot be extended"))?
            .pop_if_empty()
            .push("invoices")
            .push(provider_reference)
            .push("cancel");
        Ok(endpoint)
    }

    async fn send_json(
        &self,
        url: Url,
        tenant_id: &str,
        body: Value,
        idempotency_key: Option<&str>,
    ) -> R<Value> {
        let mut request = self
            .client
            .post(url)
            .header("X-OSP-Tenant-ID", tenant_id)
            .json(&body);
        if let Some(token) = &self.bearer_token {
            request = request.bearer_auth(token);
        }
        if let Some(key) = idempotency_key {
            request = request.header("Idempotency-Key", format!("{tenant_id}:{key}"));
        }
        let response = request.send().await.map_err(|_| {
            ApiError::new(
                502,
                "EINVOICE_PROVIDER_UNAVAILABLE",
                "E-invoice provider request failed",
            )
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_status_error(status));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(ApiError::new(
                502,
                "EINVOICE_PROVIDER_RESPONSE",
                "Provider response exceeds the 1 MiB limit",
            ));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            ApiError::new(
                502,
                "EINVOICE_PROVIDER_UNAVAILABLE",
                "Cannot read provider response",
            )
        })? {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(ApiError::new(
                    502,
                    "EINVOICE_PROVIDER_RESPONSE",
                    "Provider response exceeds the 1 MiB limit",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let parsed: Value = serde_json::from_slice(&bytes).map_err(|_| {
            ApiError::new(
                502,
                "EINVOICE_PROVIDER_RESPONSE",
                "Provider must return a JSON object",
            )
        })?;
        if !parsed.is_object() {
            return Err(ApiError::new(
                502,
                "EINVOICE_PROVIDER_RESPONSE",
                "Provider must return a JSON object",
            ));
        }
        Ok(parsed)
    }
}

impl EInvoiceProvider for HttpEInvoiceProvider {
    fn code(&self) -> &str {
        &self.code
    }

    fn issue<'a>(
        &'a self,
        tenant_id: &'a str,
        request: &'a Value,
    ) -> BoxFuture<'a, R<IssueResult>> {
        Box::pin(async move {
            let response = self
                .send_json(
                    self.endpoint.clone(),
                    tenant_id,
                    request.clone(),
                    request.get("idempotency_key").and_then(Value::as_str),
                )
                .await?;
            let number = response
                .get("number")
                .and_then(Value::as_str)
                .filter(|number| !number.trim().is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_RESPONSE",
                        "Provider response is missing invoice number",
                    )
                })?;
            Ok(IssueResult {
                provider_reference: response
                    .get("provider_reference")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                serial: response
                    .get("serial")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                number: number.to_owned(),
                lookup_code: response
                    .get("lookup_code")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                response,
            })
        })
    }

    fn cancel<'a>(
        &'a self,
        tenant_id: &'a str,
        provider_reference: &'a str,
        reason: &'a str,
    ) -> BoxFuture<'a, R<CancellationResult>> {
        Box::pin(async move {
            if provider_reference.trim().is_empty() || reason.trim().is_empty() {
                return Err(ApiError::new(
                    400,
                    "EINVOICE_CANCELLATION",
                    "Provider reference and cancellation reason are required",
                ));
            }
            let idempotency_key = format!("cancel:{provider_reference}");
            let response = self
                .send_json(
                    self.cancellation_endpoint(provider_reference)?,
                    tenant_id,
                    json!({ "reason": reason }),
                    Some(&idempotency_key),
                )
                .await?;
            Ok(CancellationResult {
                provider_reference: response
                    .get("provider_reference")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                response,
            })
        })
    }
}

fn provider_status_error(status: StatusCode) -> crate::error::ApiError {
    let retryable = status.is_server_error()
        || matches!(
            status,
            StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS
        );
    ApiError::new(
        if retryable { 502 } else { 422 },
        if retryable {
            "EINVOICE_PROVIDER_TEMPORARY"
        } else {
            "EINVOICE_PROVIDER_REJECTED"
        },
        format!(
            "E-invoice provider rejected request (HTTP {})",
            status.as_u16()
        ),
    )
}
