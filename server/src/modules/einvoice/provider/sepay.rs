//! SePay eInvoice API v1 adapter. Credentials are server-only; the request
//! carries accounting data while template/account selection comes from env.
use super::super::{CancellationResult, EInvoiceProvider, IssueResult};
use crate::error::{ApiError, R};
use futures::future::BoxFuture;
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde_json::{Value, json};
use std::{collections::BTreeMap, env, time::Duration};
use tokio::sync::Mutex;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const TOKEN_REFRESH_SKEW: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct SePayEInvoiceProviderConfig {
    pub base_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub tenant_configs: BTreeMap<String, SePayTenantConfig>,
    pub payment_method: String,
    pub timeout: Duration,
}

#[derive(Clone, serde::Deserialize)]
pub struct SePayTenantConfig {
    #[serde(rename = "providerAccountId")]
    pub provider_account_id: String,
    #[serde(rename = "templateCode")]
    pub template_code: String,
    #[serde(rename = "invoiceSeries")]
    pub invoice_series: String,
}

impl SePayEInvoiceProviderConfig {
    pub fn from_env() -> R<Self> {
        let get = |name: &str| -> R<String> {
            env::var(name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        500,
                        "EINVOICE_CONFIG",
                        format!("{name} must be configured for the SePay eInvoice adapter"),
                    )
                })
        };
        let timeout = env::var("OSP_SEPAY_EINVOICE_TIMEOUT_SEC")
            .ok()
            .map(|value| {
                value
                    .parse::<u64>()
                    .ok()
                    .filter(|seconds| (1..=120).contains(seconds))
                    .ok_or_else(|| {
                        ApiError::new(
                            500,
                            "EINVOICE_CONFIG",
                            "OSP_SEPAY_EINVOICE_TIMEOUT_SEC must be between 1 and 120",
                        )
                    })
            })
            .transpose()?
            .unwrap_or(30);
        let tenant_configs = env::var("OSP_SEPAY_EINVOICE_TENANT_CONFIG")
            .ok()
            .and_then(|value| serde_json::from_str::<BTreeMap<String, SePayTenantConfig>>(&value).ok())
            .filter(|mapping| !mapping.is_empty())
            .ok_or_else(|| ApiError::new(500, "EINVOICE_CONFIG", "OSP_SEPAY_EINVOICE_TENANT_CONFIG must map each tenant ID to providerAccountId, templateCode, and invoiceSeries"))?;
        if tenant_configs.values().any(|value| {
            value.provider_account_id.trim().is_empty()
                || value.template_code.trim().is_empty()
                || value.invoice_series.trim().is_empty()
        }) {
            return Err(ApiError::new(
                500,
                "EINVOICE_CONFIG",
                "Every SePay tenant mapping needs providerAccountId, templateCode, and invoiceSeries",
            ));
        }
        Ok(Self {
            base_url: env::var("OSP_SEPAY_EINVOICE_BASE_URL")
                .unwrap_or_else(|_| "https://einvoice-api.sepay.vn".into()),
            client_id: get("OSP_SEPAY_EINVOICE_CLIENT_ID")?,
            client_secret: get("OSP_SEPAY_EINVOICE_CLIENT_SECRET")?,
            tenant_configs,
            payment_method: get("OSP_SEPAY_EINVOICE_PAYMENT_METHOD")?,
            timeout: Duration::from_secs(timeout),
        })
    }
}

#[derive(Clone)]
struct CachedToken {
    value: String,
    expires_at: tokio::time::Instant,
}

pub struct SePayEInvoiceProvider {
    base_url: Url,
    client_id: String,
    client_secret: String,
    tenant_configs: BTreeMap<String, SePayTenantConfig>,
    payment_method: String,
    client: Client,
    token: Mutex<Option<CachedToken>>,
}

impl SePayEInvoiceProvider {
    pub fn new(config: SePayEInvoiceProviderConfig) -> R<Self> {
        let base_url = Url::parse(config.base_url.trim()).map_err(|_| {
            ApiError::new(500, "EINVOICE_CONFIG", "SePay eInvoice base URL is invalid")
        })?;
        if base_url.scheme() != "https"
            || base_url.host().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || config.client_id.trim().is_empty()
            || config.client_secret.trim().is_empty()
            || config.tenant_configs.is_empty()
            || !matches!(
                config.payment_method.as_str(),
                "TM" | "CK" | "TM/CK" | "KHAC"
            )
        {
            return Err(ApiError::new(
                500,
                "EINVOICE_CONFIG",
                "SePay requires HTTPS, credentials, account, template, series, and valid payment method",
            ));
        }
        let client = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(config.timeout.min(Duration::from_secs(10)))
            .timeout(config.timeout)
            .build()
            .map_err(|_| {
                ApiError::new(500, "EINVOICE_CONFIG", "Cannot build SePay eInvoice client")
            })?;
        Ok(Self {
            base_url,
            client_id: config.client_id,
            client_secret: config.client_secret,
            tenant_configs: config.tenant_configs,
            payment_method: config.payment_method,
            client,
            token: Mutex::new(None),
        })
    }

    fn endpoint(&self, path: &str) -> R<Url> {
        self.base_url.join(path).map_err(|_| {
            ApiError::new(
                500,
                "EINVOICE_CONFIG",
                "Cannot construct SePay eInvoice URL",
            )
        })
    }

    async fn access_token(&self, refresh: bool) -> R<String> {
        let mut cache = self.token.lock().await;
        if !refresh
            && let Some(token) = cache.as_ref()
            && token.expires_at > tokio::time::Instant::now() + TOKEN_REFRESH_SKEW
        {
            return Ok(token.value.clone());
        }
        let response = self
            .client
            .post(self.endpoint("/v1/token")?)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .send()
            .await
            .map_err(|_| {
                ApiError::new(
                    502,
                    "EINVOICE_PROVIDER_UNAVAILABLE",
                    "Cannot obtain SePay eInvoice access token",
                )
            })?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_status(status));
        }
        let value = read_json(response).await?;
        let token = value
            .pointer("/data/access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| provider_response_error("SePay token response is missing access_token"))?
            .to_owned();
        let expires = value
            .pointer("/data/expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(86_400)
            .clamp(60, 86_400);
        *cache = Some(CachedToken {
            value: token.clone(),
            expires_at: tokio::time::Instant::now() + Duration::from_secs(expires),
        });
        Ok(token)
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        ambiguous: bool,
    ) -> R<Value> {
        let url = self.endpoint(path)?;
        for refresh in [false, true] {
            let token = self.access_token(refresh).await?;
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .bearer_auth(token);
            if let Some(body) = &body {
                request = request.json(body);
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(_) if ambiguous => {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNKNOWN",
                        "SePay may have accepted the invoice request but returned no response; it was not resubmitted",
                    ));
                }
                Err(_) => {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNAVAILABLE",
                        "SePay eInvoice request failed",
                    ));
                }
            };
            if response.status() == StatusCode::UNAUTHORIZED && !refresh {
                continue;
            }
            let status = response.status();
            if !status.is_success() {
                if ambiguous && (status.is_server_error() || status == StatusCode::CONFLICT) {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNKNOWN",
                        "SePay already has this reference code or returned a server error during invoice creation; check the reference code before retrying",
                    ));
                }
                return Err(provider_status(status));
            }
            let value = match read_json(response).await {
                Ok(value) => value,
                Err(_) if ambiguous => {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNKNOWN",
                        "SePay accepted the create request but its response could not be verified; automatic resubmission is disabled",
                    ));
                }
                Err(error) => return Err(error),
            };
            if value.get("success").and_then(Value::as_bool) == Some(false) {
                let message = value
                    .pointer("/error/message")
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("SePay rejected the request");
                return Err(ApiError::new(
                    422,
                    "EINVOICE_PROVIDER_REJECTED",
                    format!("SePay rejected the e-invoice request: {message}"),
                ));
            }
            return Ok(value);
        }
        Err(ApiError::new(
            502,
            "EINVOICE_PROVIDER_TEMPORARY",
            "SePay authentication retry failed",
        ))
    }

    fn create_payload(&self, tenant_id: &str, request: &Value) -> R<Value> {
        let tenant = self.tenant_configs.get(tenant_id).ok_or_else(|| {
            ApiError::new(
                403,
                "EINVOICE_CONFIG",
                "No SePay provider account is mapped to this tenant",
            )
        })?;
        let buyer = request
            .get("buyer")
            .filter(|value| value.is_object())
            .ok_or_else(|| payload_error("buyer details are missing from the posted invoice"))?;
        if buyer
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(payload_error(
                "buyer name is missing from the tenant's customer record",
            ));
        }
        let items = request
            .get("lines")
            .or_else(|| request.get("items"))
            .and_then(Value::as_array)
            .ok_or_else(|| payload_error("invoice lines are missing"))?;
        if items.is_empty() {
            return Err(payload_error("invoice must contain at least one line"));
        }
        let mut sepay_items = Vec::with_capacity(items.len());
        for (index, line) in items.iter().enumerate() {
            let item_name = line
                .get("item_name")
                .or_else(|| line.get("name"))
                .or_else(|| line.get("description"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    payload_error(&format!("line {} has no verified item name", index + 1))
                })?;
            let unit = line
                .get("unit")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            let quantity = line
                .get("quantity")
                .or_else(|| line.get("qty"))
                .ok_or_else(|| payload_error(&format!("line {} has no quantity", index + 1)))?;
            let unit_price = line
                .get("unit_price")
                .or_else(|| line.get("price"))
                .ok_or_else(|| payload_error(&format!("line {} has no unit price", index + 1)))?;
            let tax_rate = line.get("tax_rate").ok_or_else(|| {
                payload_error(&format!("line {} has no explicit tax rate", index + 1))
            })?;
            let mut sepay_item = json!({
                "line_number": index + 1,
                "line_type": 1,
                "item_code": line.get("item_code").or_else(|| line.get("sku")),
                "item_name": item_name,
                "quantity": quantity,
                "unit_price": unit_price,
                "tax_rate": tax_rate,
                "before_discount_and_tax_amount": line.get("before_discount_and_tax_amount").or_else(|| line.get("net_amount"))
            });
            let item_object = sepay_item.as_object_mut().expect("json object");
            if let Some(unit) = unit {
                item_object.insert("unit".into(), Value::String(unit.to_owned()));
            }
            for field in [
                "tax_amount",
                "discount_amount",
                "before_discount_and_tax_amount",
            ] {
                if let Some(value) = line.get(field).filter(|value| !value.is_null()) {
                    item_object.insert(field.into(), integer_field(value, field)?);
                }
            }
            if let Some(value) = line.get("discount_tax").filter(|value| !value.is_null()) {
                item_object.insert("discount_tax".into(), value.clone());
            }
            item_object.retain(|_, value| !value.is_null());
            sepay_items.push(sepay_item);
        }
        let issue_date = request
            .get("issue_date")
            .and_then(Value::as_str)
            .ok_or_else(|| payload_error("invoice issue_date is missing"))?;
        let date = issue_date
            .get(0..10)
            .ok_or_else(|| payload_error("invoice issue_date must contain an ISO date"))?;
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err(payload_error("invoice issue_date must use YYYY-MM-DD"));
        }
        // SePay accepts only the current business date. The OSP invoice date is
        // preserved exactly, and SePay validates whether it is current.
        let issued_date = if issue_date.len() == 10 {
            format!("{issue_date} 00:00:00")
        } else {
            issue_date.to_owned()
        };
        let currency = request
            .get("currency_code")
            .or_else(|| request.get("currencyCode"))
            .filter(|value| {
                value
                    .as_str()
                    .is_some_and(|value| matches!(value, "VND" | "USD" | "CAD"))
            })
            .ok_or_else(|| payload_error("invoice currency must be VND, USD, or CAD"))?;
        Ok(json!({
            "template_code": tenant.template_code,
            "invoice_series": tenant.invoice_series,
            "issued_date": issued_date,
            "currency": currency,
            "provider_account_id": tenant.provider_account_id,
            "reference_code": request.get("idempotency_key").and_then(Value::as_str).unwrap_or_default(),
            "payment_method": self.payment_method,
            "is_draft": false,
            "buyer": buyer,
            "items": sepay_items,
            "notes": request.get("memo").or_else(|| request.get("description"))
        }))
    }
}

impl EInvoiceProvider for SePayEInvoiceProvider {
    fn code(&self) -> &str {
        "sepay"
    }

    fn validate_issue(&self, tenant_id: &str, request: &Value) -> R<()> {
        if !self.tenant_configs.contains_key(tenant_id) {
            return Err(ApiError::new(
                403,
                "EINVOICE_CONFIG",
                "No SePay provider account is mapped to this tenant",
            ));
        }
        self.create_payload(tenant_id, request).map(|_| ())
    }

    fn issue<'a>(
        &'a self,
        tenant_id: &'a str,
        request: &'a Value,
    ) -> BoxFuture<'a, R<IssueResult>> {
        Box::pin(async move {
            if !self.tenant_configs.contains_key(tenant_id) {
                return Err(ApiError::new(
                    403,
                    "EINVOICE_CONFIG",
                    "No SePay provider account is mapped to this tenant",
                ));
            }
            let state = request.get("provider_state").unwrap_or(&Value::Null);
            let create_was_started =
                state.get("_osp_create_started").and_then(Value::as_bool) == Some(true);
            let create_is_authorized =
                state.get("_osp_create_authorized").and_then(Value::as_bool) == Some(true);
            if state.get("_osp_outcome_unknown").and_then(Value::as_bool) == Some(true)
                || (create_was_started && !create_is_authorized)
            {
                let reference_code = request
                    .get("idempotency_key")
                    .and_then(Value::as_str)
                    .and_then(|value| uuid::Uuid::parse_str(value).ok())
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                let recovery = if !reference_code.is_empty() {
                    self.request(
                        reqwest::Method::GET,
                        &format!("/v1/invoices/{reference_code}"),
                        None,
                        false,
                    )
                    .await
                } else {
                    Err(provider_response_error(
                        "SePay recovery is missing the stable reference code",
                    ))
                };
                if let Ok(response) = recovery {
                    let invoice = response.get("data").unwrap_or(&response);
                    let number = invoice
                        .get("invoice_number")
                        .and_then(value_as_nonzero_string);
                    if invoice
                        .get("status")
                        .and_then(Value::as_str)
                        .is_some_and(|status| status.eq_ignore_ascii_case("issued"))
                        && let Some(number) = number
                    {
                        return Ok(IssueResult {
                            provider_reference: Some(reference_code.to_owned()),
                            serial: invoice
                                .get("invoice_series")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                            number,
                            lookup_code: invoice
                                .get("lookup_code")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                            response,
                        });
                    }
                }
                return Err(ApiError::new(
                    502,
                    "EINVOICE_PROVIDER_UNKNOWN",
                    "SePay issuance outcome remains unknown; check the SePay reference_code before taking action. Automatic resubmission is disabled.",
                ));
            }
            if let Some(tracking_code) = request
                .get("provider_reference")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                let tracking_code = uuid::Uuid::parse_str(tracking_code)
                    .map_err(|_| {
                        ApiError::new(
                            502,
                            "EINVOICE_PROVIDER_UNKNOWN",
                            "SePay tracking code is invalid; automatic resubmission is disabled",
                        )
                    })?
                    .to_string();
                let response = self
                    .request(
                        reqwest::Method::GET,
                        &format!("/v1/invoices/create/check/{tracking_code}"),
                        None,
                        false,
                    )
                    .await?;
                let data = response.get("data").unwrap_or(&response);
                let status = data
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let message = data
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if message.contains("chưa xác nhận được kết quả")
                    || message.contains("chua xac nhan duoc ket qua")
                {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNKNOWN",
                        "SePay cannot confirm the invoice outcome. The request will not be resubmitted.",
                    ));
                }
                if status.eq_ignore_ascii_case("pending") {
                    let delay = data
                        .pointer("/retry/next_retry_at")
                        .and_then(Value::as_str)
                        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                        .map(|next| {
                            (next.with_timezone(&chrono::Utc) - chrono::Utc::now())
                                .num_seconds()
                                .max(15)
                        })
                        .unwrap_or(60);
                    return Ok(pending_result(&tracking_code, response, delay));
                }
                if status.eq_ignore_ascii_case("failed") {
                    let reference_code = data
                        .get("reference_code")
                        .and_then(Value::as_str)
                        .and_then(|value| uuid::Uuid::parse_str(value).ok())
                        .map(|value| value.to_string())
                        .unwrap_or_default();
                    if !reference_code.is_empty()
                        && let Ok(details) = self
                            .request(
                                reqwest::Method::GET,
                                &format!("/v1/invoices/{reference_code}"),
                                None,
                                false,
                            )
                            .await
                    {
                        let invoice = details.get("data").unwrap_or(&details);
                        if invoice
                            .get("status")
                            .and_then(Value::as_str)
                            .is_some_and(|value| value.eq_ignore_ascii_case("issued"))
                            && let Some(number) = invoice
                                .get("invoice_number")
                                .and_then(value_as_nonzero_string)
                        {
                            return Ok(IssueResult {
                                provider_reference: Some(tracking_code.clone()),
                                serial: invoice
                                    .get("invoice_series")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned),
                                number,
                                lookup_code: invoice
                                    .get("lookup_code")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned),
                                response: details,
                            });
                        }
                    }
                    return Err(ApiError::new(
                        422,
                        "EINVOICE_PROVIDER_REJECTED",
                        "SePay failed to issue the invoice; correct the source invoice and reconcile the SePay reference before retrying",
                    ));
                }
                if !status.eq_ignore_ascii_case("success") {
                    return Err(ApiError::new(
                        502,
                        "EINVOICE_PROVIDER_UNKNOWN",
                        "SePay returned an unrecognized issuance status; automatic resubmission is disabled",
                    ));
                }
                let invoice = data.get("invoice").filter(|value| value.is_object()).ok_or_else(|| ApiError::new(502, "EINVOICE_PROVIDER_UNKNOWN", "SePay confirmed success without invoice details; automatic resubmission is disabled"))?;
                let number = invoice.get("invoice_number").and_then(value_as_nonzero_string).ok_or_else(|| ApiError::new(502, "EINVOICE_PROVIDER_UNKNOWN", "SePay confirmation has no issued invoice number; automatic resubmission is disabled"))?;
                return Ok(IssueResult {
                    provider_reference: Some(tracking_code),
                    serial: invoice
                        .get("invoice_series")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    number,
                    lookup_code: invoice
                        .get("lookup_code")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    response,
                });
            }

            if !create_is_authorized {
                return Err(ApiError::new(
                    502,
                    "EINVOICE_PROVIDER_UNKNOWN",
                    "SePay create authorization is missing; the adapter will not submit an invoice",
                ));
            }
            let payload = self.create_payload(tenant_id, request)?;
            let response = self
                .request(
                    reqwest::Method::POST,
                    "/v1/invoices/create",
                    Some(payload),
                    true,
                )
                .await?;
            let data = response.get("data").unwrap_or(&response);
            let tracking_code = data.get("tracking_code").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).ok_or_else(|| ApiError::new(502, "EINVOICE_PROVIDER_UNKNOWN", "SePay accepted the create request but returned no tracking_code; automatic resubmission is disabled"))?;
            let tracking_code = uuid::Uuid::parse_str(tracking_code)
                .map_err(|_| ApiError::new(502, "EINVOICE_PROVIDER_UNKNOWN", "SePay accepted the request but returned an invalid tracking code; automatic resubmission is disabled"))?
                .to_string();
            Ok(pending_result(&tracking_code, response, 30))
        })
    }

    fn cancel<'a>(
        &'a self,
        _tenant_id: &'a str,
        _provider_reference: &'a str,
        _reason: &'a str,
    ) -> BoxFuture<'a, R<CancellationResult>> {
        Box::pin(async {
            Err(ApiError::new(
                422,
                "EINVOICE_PROVIDER_REJECTED",
                "SePay cancellation requires a vendor-specific cancellation flow and is not enabled by this adapter",
            ))
        })
    }
}

fn pending_result(tracking_code: &str, mut response: Value, delay_seconds: i64) -> IssueResult {
    if let Some(object) = response.as_object_mut() {
        object.insert("_osp_pending".into(), Value::Bool(true));
        object.insert(
            "_osp_retry_after_seconds".into(),
            Value::from(delay_seconds.clamp(15, 3600)),
        );
    }
    IssueResult {
        provider_reference: Some(tracking_code.to_owned()),
        serial: None,
        number: String::new(),
        lookup_code: None,
        response,
    }
}

async fn read_json(response: reqwest::Response) -> R<Value> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(provider_response_error(
            "SePay response exceeds the 1 MiB limit",
        ));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        ApiError::new(
            502,
            "EINVOICE_PROVIDER_UNAVAILABLE",
            "Cannot read SePay response",
        )
    })? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(provider_response_error(
                "SePay response exceeds the 1 MiB limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| provider_response_error("SePay response is not valid JSON"))
}

fn provider_status(status: StatusCode) -> ApiError {
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
        format!("SePay eInvoice request returned HTTP {}", status.as_u16()),
    )
}
fn provider_response_error(message: &str) -> ApiError {
    ApiError::new(502, "EINVOICE_PROVIDER_RESPONSE", message)
}

fn integer_field(value: &Value, field: &str) -> R<Value> {
    if let Some(value) = value.as_i64() {
        return Ok(Value::from(value));
    }
    if let Some(value) = value.as_u64() {
        return Ok(Value::from(value));
    }
    if let Some(value) = value.as_str()
        && let Ok(parsed) = value.parse::<i64>()
    {
        return Ok(Value::from(parsed));
    }
    Err(payload_error(&format!(
        "{field} must be a whole number for SePay"
    )))
}

fn value_as_nonzero_string(value: &Value) -> Option<String> {
    let number = value.as_str().map(str::to_owned).or_else(|| {
        value
            .as_i64()
            .map(|value| value.to_string())
            .or_else(|| value.as_u64().map(|value| value.to_string()))
    })?;
    (!number.is_empty() && number != "0").then_some(number)
}

fn payload_error(message: &str) -> ApiError {
    ApiError::new(422, "EINVOICE_PAYLOAD_INVALID", message)
}
