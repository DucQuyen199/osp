//! Lớp HTTP: định tuyến, xác thực Bearer, giới hạn tốc độ, header bảo mật (CSP), phục vụ giao diện tĩnh.
use crate::error::{ApiError, R};
use crate::kernel::data::ListQuery;
use crate::kernel::io::ImportInput;
use crate::kernel::tenants::{AdminInput, CreateTenant};
use crate::kernel::{Actor, Kernel, Obj, PublicUser, Tenant};
use crate::money;
use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::{Value, json};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub struct AppConfig {
    pub demo: bool,
    pub signup: bool,
    pub log: bool,
    pub rate_limit_per_min: u32,
    pub public_dir: PathBuf,
}

const HTTP_DURATION_BUCKETS_MS: [u64; 9] = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500];

#[derive(Default)]
pub struct HttpMetrics {
    requests: AtomicU64,
    responses: [AtomicU64; 5],
    duration_sum_ns: AtomicU64,
    duration_buckets: [AtomicU64; HTTP_DURATION_BUCKETS_MS.len() + 1],
}

impl HttpMetrics {
    fn observe(&self, status: u16, elapsed: Duration) {
        self.requests.fetch_add(1, Ordering::Relaxed);
        if (100..600).contains(&status) {
            self.responses[usize::from(status / 100 - 1)].fetch_add(1, Ordering::Relaxed);
        }
        let nanos = elapsed.as_nanos().min(u128::from(u64::MAX)) as u64;
        self.duration_sum_ns.fetch_add(nanos, Ordering::Relaxed);
        for (index, limit) in HTTP_DURATION_BUCKETS_MS.iter().enumerate() {
            if elapsed.as_nanos() <= u128::from(*limit) * 1_000_000 {
                self.duration_buckets[index].fetch_add(1, Ordering::Relaxed);
            }
        }
        self.duration_buckets[HTTP_DURATION_BUCKETS_MS.len()].fetch_add(1, Ordering::Relaxed);
    }

    fn prometheus_text(&self, open_failures: i64, dead_outbox: i64) -> String {
        let mut output = String::from(
            "# HELP osp_http_requests_total Total HTTP requests handled by OSP.\n# TYPE osp_http_requests_total counter\n",
        );
        output.push_str(&format!(
            "osp_http_requests_total {}\n",
            self.requests.load(Ordering::Relaxed)
        ));
        output.push_str("# HELP osp_open_failures Current count of unresolved workflow and scheduled-job failures across tenants.\n# TYPE osp_open_failures gauge\n");
        output.push_str(&format!("osp_open_failures {open_failures}\n"));
        output.push_str("# HELP osp_dead_outbox_deliveries Current count of dead-letter integration deliveries across tenants.\n# TYPE osp_dead_outbox_deliveries gauge\n");
        output.push_str(&format!("osp_dead_outbox_deliveries {dead_outbox}\n"));
        output.push_str("# HELP osp_http_responses_total HTTP responses grouped by status class.\n# TYPE osp_http_responses_total counter\n");
        for (index, class) in ["1xx", "2xx", "3xx", "4xx", "5xx"].iter().enumerate() {
            output.push_str(&format!(
                "osp_http_responses_total{{status_class=\"{class}\"}} {}\n",
                self.responses[index].load(Ordering::Relaxed),
            ));
        }
        output.push_str("# HELP osp_http_request_duration_seconds HTTP request duration in seconds.\n# TYPE osp_http_request_duration_seconds histogram\n");
        for (index, limit) in HTTP_DURATION_BUCKETS_MS.iter().enumerate() {
            output.push_str(&format!(
                "osp_http_request_duration_seconds_bucket{{le=\"{}\"}} {}\n",
                f64::from(*limit as u32) / 1_000.0,
                self.duration_buckets[index].load(Ordering::Relaxed),
            ));
        }
        output.push_str(&format!(
            "osp_http_request_duration_seconds_bucket{{le=\"+Inf\"}} {}\nosp_http_request_duration_seconds_sum {}\nosp_http_request_duration_seconds_count {}\n",
            self.duration_buckets[HTTP_DURATION_BUCKETS_MS.len()].load(Ordering::Relaxed),
            self.duration_sum_ns.load(Ordering::Relaxed) as f64 / 1_000_000_000.0,
            self.requests.load(Ordering::Relaxed),
        ));
        output
    }
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value)
        .ok_or_else(|| ApiError::internal("numeric response exceeds Decimal range"))
}

fn idempotency_key(headers: &axum::http::HeaderMap) -> R<Option<String>> {
    let mut values = headers.get_all("idempotency-key").iter();
    let value = values.next();
    if values.next().is_some() {
        return Err(ApiError::new(
            400,
            "BAD_IDEMPOTENCY_KEY",
            "Chỉ được gửi một header Idempotency-Key",
        ));
    }
    value
        .map(|value| {
            let key = value.to_str().map_err(|_| {
                ApiError::new(
                    400,
                    "BAD_IDEMPOTENCY_KEY",
                    "Idempotency-Key phải là chuỗi ASCII in được",
                )
            })?;
            if key.is_empty()
                || key.len() > 200
                || !key.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
            {
                return Err(ApiError::new(
                    400,
                    "BAD_IDEMPOTENCY_KEY",
                    "Idempotency-Key phải có 1–200 ký tự ASCII in được",
                ));
            }
            Ok(key.to_owned())
        })
        .transpose()
}

fn line_decimal(line: &Value, field: &str) -> R<Decimal> {
    match line.get(field).filter(|value| !value.is_null()) {
        None => Ok(Decimal::ZERO),
        Some(value) => money::decimal(value).ok_or_else(|| {
            ApiError::validation(
                "business.preview",
                vec![format!("Line field {field} must be a valid decimal number")],
            )
        }),
    }
}

fn sum_line_field(lines: &[Value], field: &str) -> R<Decimal> {
    lines.iter().try_fold(Decimal::ZERO, |total, line| {
        total
            .checked_add(line_decimal(line, field)?)
            .ok_or_else(|| {
                ApiError::validation(
                    "business.preview",
                    vec!["Line total exceeds Decimal range".into()],
                )
            })
    })
}

fn sum_line_base_amount(lines: &[Value]) -> R<Decimal> {
    lines.iter().try_fold(Decimal::ZERO, |total, line| {
        let amount = line_decimal(line, "qty")?
            .checked_mul(line_decimal(line, "price")?)
            .ok_or_else(|| {
                ApiError::validation(
                    "business.preview",
                    vec!["Line amount exceeds Decimal range".into()],
                )
            })?;
        total.checked_add(amount).ok_or_else(|| {
            ApiError::validation(
                "business.preview",
                vec!["Document total exceeds Decimal range".into()],
            )
        })
    })
}

/// Concurrent GCRA limiter supplied by governor; zero keeps the deny-all contract.
pub struct RateLimiter {
    inner: Option<governor::DefaultKeyedRateLimiter<String>>,
    checks: std::sync::atomic::AtomicUsize,
}

impl RateLimiter {
    pub fn new(max: u32, window: Duration) -> Self {
        let inner = std::num::NonZeroU32::new(max).map(|burst| {
            let period = (window / max).max(Duration::from_nanos(1));
            let quota = governor::Quota::with_period(period)
                .expect("positive rate-limit period")
                .allow_burst(burst);
            governor::RateLimiter::keyed(quota)
        });
        Self {
            inner,
            checks: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub fn take(&self, key: &str) -> bool {
        let Some(limiter) = &self.inner else {
            return false;
        };
        if self
            .checks
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            % 1024
            == 0
        {
            limiter.retain_recent();
        }
        limiter.check_key(&key.to_owned()).is_ok()
    }
}

pub struct AppState {
    pub kernel: Arc<Kernel>,
    pub cfg: AppConfig,
    pub(crate) trusted_proxies: Vec<IpNetwork>,
    pub api_limiter: RateLimiter,
    pub auth_limiter: RateLimiter,
    pub create_limiter: RateLimiter,
    pub metrics: HttpMetrics,
    pub metrics_token: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) struct IpNetwork {
    address: IpAddr,
    prefix: u8,
}

impl IpNetwork {
    fn parse(value: &str) -> Result<Self, String> {
        let (address, prefix) = value
            .trim()
            .split_once('/')
            .map_or((value.trim(), None), |(address, prefix)| {
                (address.trim(), Some(prefix.trim()))
            });
        let address = address
            .parse::<IpAddr>()
            .map_err(|_| format!("invalid IP address in trusted proxy entry {value:?}"))?;
        let max_prefix = if address.is_ipv4() { 32 } else { 128 };
        let prefix = match prefix {
            Some(prefix) => prefix
                .parse::<u8>()
                .ok()
                .filter(|prefix| *prefix <= max_prefix)
                .ok_or_else(|| format!("invalid prefix length in trusted proxy entry {value:?}"))?,
            None => max_prefix,
        };
        if prefix == 0 {
            return Err(format!(
                "trusted proxy entry {value:?} cannot trust an entire IP address family"
            ));
        }
        Ok(Self { address, prefix })
    }

    fn contains(self, address: IpAddr) -> bool {
        match (self.address, address) {
            (IpAddr::V4(network), IpAddr::V4(address)) => {
                let mask = u32::MAX << (32 - self.prefix);
                u32::from(network) & mask == u32::from(address) & mask
            }
            (IpAddr::V6(network), IpAddr::V6(address)) => {
                let mask = u128::MAX << (128 - self.prefix);
                u128::from(network) & mask == u128::from(address) & mask
            }
            _ => false,
        }
    }
}

fn trusted_client_ip(
    peer: IpAddr,
    headers: &axum::http::HeaderMap,
    proxies: &[IpNetwork],
) -> IpAddr {
    if !proxies.iter().any(|proxy| proxy.contains(peer)) {
        return peer;
    }
    let values = headers.get_all("x-forwarded-for");
    let mut chain = Vec::new();
    for value in values.iter() {
        let Ok(value) = value.to_str() else {
            return peer;
        };
        if value.len() > 1024 {
            return peer;
        }
        for hop in value.split(',') {
            let Ok(address) = hop.trim().parse::<IpAddr>() else {
                return peer;
            };
            chain.push(address);
            if chain.len() > 32 {
                return peer;
            }
        }
    }
    let mut client = peer;
    for hop in chain.into_iter().rev() {
        if !proxies.iter().any(|proxy| proxy.contains(client)) {
            break;
        }
        client = hop;
    }
    client
}

pub(crate) fn load_trusted_proxies() -> Vec<IpNetwork> {
    let Ok(value) = std::env::var("OSP_TRUSTED_PROXIES") else {
        return Vec::new();
    };
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| match IpNetwork::parse(entry) {
            Ok(network) => Some(network),
            Err(error) => {
                tracing::warn!(%error, "ignoring invalid OSP_TRUSTED_PROXIES entry");
                None
            }
        })
        .collect()
}

enum Reply {
    Json(u16, Value),
    Raw {
        status: u16,
        content_type: &'static str,
        body: Vec<u8>,
        extra: Vec<(&'static str, String)>,
    },
}

fn json_ok(v: Value) -> R<Reply> {
    Ok(Reply::Json(200, v))
}

fn parse_query(q: Option<&str>) -> Vec<(String, String)> {
    url::form_urlencoded::parse(q.unwrap_or("").as_bytes())
        .into_owned()
        .collect()
}

fn query_usize(query: &[(String, String)], name: &str, default: usize, max: usize) -> R<usize> {
    let Some(value) = query
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
    else {
        return Ok(default);
    };
    let parsed = value.parse::<usize>().map_err(|_| {
        ApiError::new(
            422,
            "INVALID_PAGINATION",
            format!("{name} must be a non-negative integer"),
        )
    })?;
    if parsed > max {
        return Err(ApiError::new(
            422,
            "INVALID_PAGINATION",
            format!("{name} must not exceed {max}"),
        ));
    }
    Ok(parsed)
}

fn query_text(query: &[(String, String)], name: &str, max_chars: usize) -> R<Option<String>> {
    let value = query
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty());
    let Some(value) = value else {
        return Ok(None);
    };
    if value.chars().count() > max_chars {
        return Err(ApiError::new(
            422,
            "INVALID_QUERY",
            format!("{name} must not exceed {max_chars} characters"),
        ));
    }
    Ok(Some(value.to_owned()))
}

fn query_bool(query: &[(String, String)], name: &str, default: bool) -> R<bool> {
    match query
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
    {
        None => Ok(default),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(ApiError::new(
            422,
            "INVALID_QUERY",
            format!("{name} must be true or false"),
        )),
    }
}

fn reply_to_response(r: Reply) -> Response {
    match r {
        Reply::Json(status, v) => {
            let mut r = (
                StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
                axum::Json(v),
            )
                .into_response();
            r.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            r
        }
        Reply::Raw {
            status,
            content_type,
            body,
            extra,
        } => {
            let mut r = Response::new(Body::from(body));
            *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
            r.headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            let cc = if content_type.starts_with("text/html")
                || content_type.starts_with("text/javascript")
                || content_type.starts_with("text/css")
            {
                "no-cache"
            } else {
                "no-store"
            };
            r.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static(cc));
            for (k, v) in extra {
                if let Ok(v) = HeaderValue::from_str(&v) {
                    r.headers_mut().insert(HeaderName::from_static(k), v);
                }
            }
            r
        }
    }
}

fn obj(v: Value) -> R<Obj> {
    match v {
        Value::Object(o) => Ok(o),
        _ => Err(ApiError::new(
            400,
            "BAD_JSON",
            "Body phải là một đối tượng JSON hợp lệ",
        )),
    }
}

fn parse_json(body: &[u8]) -> R<Value> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice::<Value>(body)
        .map_err(|_| ApiError::new(400, "BAD_JSON", "Body phải là một đối tượng JSON hợp lệ"))
}

fn json_obj(body: &[u8]) -> R<Obj> {
    obj(parse_json(body)?)
}

fn s(o: &Obj, k: &str) -> String {
    o.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

pub async fn handle(
    State(st): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut req: Request,
) -> Response {
    // Axum strips HEAD bodies; run the same read operation as GET so headers
    // and authorization remain identical on every registered read endpoint.
    let is_metrics = req.uri().path() == "/metrics";
    let started = Instant::now();
    if req.method() == Method::HEAD {
        *req.method_mut() = Method::GET;
    }
    let ip = trusted_client_ip(addr.ip(), req.headers(), &st.trusted_proxies).to_string();
    let response = match route(&st, req, &ip).await {
        Ok(reply) => reply_to_response(reply),
        Err(error) => error.into_response(),
    };
    if !is_metrics {
        st.metrics
            .observe(response.status().as_u16(), started.elapsed());
    }
    response
}

async fn auth(
    st: &AppState,
    headers: &axum::http::HeaderMap,
) -> R<(String, Arc<Tenant>, Actor, PublicUser)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            ApiError::new(
                401,
                "UNAUTHENTICATED",
                "Thiếu hoặc sai token (Authorization: Bearer ...)",
            )
        })?
        .to_string();
    let (t, actor, user) = st.kernel.authenticate(&token).await.ok_or_else(|| {
        ApiError::new(
            401,
            "UNAUTHENTICATED",
            "Thiếu hoặc sai token (Authorization: Bearer ...)",
        )
    })?;
    if t.suspended {
        return Err(ApiError::new(
            403,
            "TENANT_SUSPENDED",
            "Doanh nghiệp đang bị tạm ngưng",
        ));
    }
    Ok((token, t, actor, user))
}

async fn route(st: &Arc<AppState>, req: Request, ip: &str) -> R<Reply> {
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_string();
    let query = parse_query(parts.uri.query());
    let segs: Vec<String> = path
        .split('/')
        .filter(|x| !x.is_empty())
        .map(|part| {
            percent_encoding::percent_decode_str(part)
                .decode_utf8()
                .map(|value| value.into_owned())
                .map_err(|_| ApiError::new(400, "BAD_PATH", "Invalid UTF-8 path"))
        })
        .collect::<R<Vec<_>>>()?;
    let k = &st.kernel;

    if path == "/metrics" {
        if method != Method::GET {
            return Err(ApiError::new(
                405,
                "METHOD_NOT_ALLOWED",
                "Phương thức HTTP không được hỗ trợ",
            ));
        }
        let Some(expected_token) = st.metrics_token.as_deref() else {
            return Err(ApiError::new(404, "NOT_FOUND", "Không tìm thấy"));
        };
        let supplied_token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or("");
        if !constant_time_token_eq(supplied_token.as_bytes(), expected_token.as_bytes()) {
            return Err(ApiError::new(404, "NOT_FOUND", "Không tìm thấy"));
        }
        let (open_failures, dead_outbox) = k.operational_alert_counts().await?;
        return Ok(Reply::Raw {
            status: 200,
            content_type: "text/plain; version=0.0.4; charset=utf-8",
            body: st
                .metrics
                .prometheus_text(open_failures, dead_outbox)
                .into_bytes(),
            extra: vec![],
        });
    }
    if segs.first().map(|x| x.as_str()) != Some("api") {
        return Err(ApiError::new(404, "NOT_FOUND", "Không tìm thấy"));
    }
    if !st.api_limiter.take(ip) {
        return Err(ApiError::new(
            429,
            "RATE_LIMITED",
            "Quá nhiều yêu cầu, thử lại sau",
        ));
    }
    let seg = |i: usize| segs.get(i).map(|x| x.as_str());
    let limit = if method == Method::POST
        && seg(1) == Some("hooks")
        && matches!(seg(2), Some("carrier" | "bank-feed"))
    {
        65_536
    } else if method == Method::POST && seg(3) == Some("documents") && seg(5) == Some("attachments")
    {
        crate::modules::document::MAX_ATTACHMENT_BYTES
    } else if seg(6) == Some("import-casso") {
        1_000_000
    } else if seg(6) == Some("import-camt053") {
        5_000_000
    } else if seg(6) == Some("import-ofx") {
        5_000_000
    } else if seg(6) == Some("import-mt940") {
        5_000_000
    } else if seg(6) == Some("import") || seg(4) == Some("import") || seg(3) == Some("import") {
        5_000_000
    } else {
        1_000_000
    };
    let bytes = axum::body::to_bytes(body, limit).await.map_err(|_| {
        ApiError::new(
            413,
            "TOO_LARGE",
            format!("Body quá lớn (>{}KB)", limit / 1000),
        )
    })?;

    // ───── Công khai ─────
    match (&method, seg(1), seg(2)) {
        (&Method::POST, Some("hooks"), Some("carrier")) => {
            if segs.len() != 5 {
                return Err(ApiError::not_found("Carrier webhook not found"));
            }
            let tenant = k.tenant(seg(3).unwrap_or_default()).await?;
            let connector_id = seg(4).unwrap_or_default();
            let signature = parts
                .headers
                .get("x-osp-signature")
                .and_then(|value| value.to_str().ok());
            return json_ok(
                crate::modules::logistics::receive_tracking_webhook(
                    k,
                    &tenant,
                    connector_id,
                    signature,
                    &bytes,
                )
                .await?,
            );
        }
        (&Method::POST, Some("hooks"), Some("bank-feed")) => {
            if segs.len() != 5 {
                return Err(ApiError::not_found("Bank feed webhook not found"));
            }
            if !parts
                .headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| {
                    value
                        .split(';')
                        .next()
                        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
                })
            {
                return Err(ApiError::new(
                    415,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "Bank feed webhooks require application/json",
                ));
            }
            let tenant = k.tenant(seg(3).unwrap_or_default()).await?;
            let connector_id = seg(4).unwrap_or_default();
            let header = |name: &str| {
                parts
                    .headers
                    .get(name)
                    .and_then(|value| value.to_str().ok())
            };
            return json_ok(
                crate::modules::accounting::receive_bank_feed_webhook(
                    k,
                    &tenant,
                    connector_id,
                    header("secure-token"),
                    header("x-sepay-signature"),
                    header("x-sepay-timestamp"),
                    &bytes,
                )
                .await?,
            );
        }
        (&Method::GET, Some("health"), None) => {
            let n: i64 = k
                .pool
                .get()
                .await?
                .query_one("SELECT count(*) FROM osp_tenants", &[])
                .await?
                .get(0);
            return json_ok(
                json!({ "status": "ok", "modules": k.reg.modules.len(), "tenants": n }),
            );
        }
        (&Method::GET, Some("catalog"), None) => return json_ok(catalog(st)),
        (&Method::GET, Some("openapi.json"), None) => {
            return json_ok(crate::openapi::build(&k.reg));
        }
        (&Method::POST, Some("tenants"), None) => {
            if !st.cfg.signup {
                return Err(ApiError::new(
                    403,
                    "SIGNUP_DISABLED",
                    "Việc tạo doanh nghiệp mới đang bị tắt",
                ));
            }
            if !st.create_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Tạo quá nhiều doanh nghiệp, thử lại sau",
                ));
            }
            let b = json_obj(&bytes)?;
            let name = s(&b, "name");
            if name.is_empty() || name.chars().count() > 120 {
                return Err(ApiError::new(422, "VALIDATION", "Thiếu hoặc sai \"name\""));
            }
            let admin = b
                .get("admin")
                .and_then(|a| a.as_object())
                .map(|a| AdminInput {
                    name: a.get("name").and_then(|v| v.as_str()).map(String::from),
                    email: a.get("email").and_then(|v| v.as_str()).map(String::from),
                    password: a.get("password").and_then(|v| v.as_str()).map(String::from),
                });
            if admin.as_ref().is_none_or(|a| {
                a.email.as_deref().is_none_or(str::is_empty)
                    || a.password.as_deref().is_none_or(str::is_empty)
            }) {
                return Err(ApiError::new(
                    422,
                    "SIGNUP_CREDENTIALS_REQUIRED",
                    "Tạo doanh nghiệp cần email và mật khẩu quản trị",
                ));
            }
            let modules = b
                .get("modules")
                .and_then(|m| m.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let (t, _token, warnings) = k
                .create_tenant(CreateTenant {
                    name,
                    vertical: b.get("vertical").and_then(|v| v.as_str()).map(String::from),
                    modules,
                    admin,
                    require_email_verification: true,
                })
                .await?;
            return Ok(Reply::Json(
                201,
                json!({ "tenantId": t.id, "emailVerificationRequired": true, "modules": t.modules, "warnings": warnings }),
            ));
        }
        (&Method::POST, Some("auth"), Some("login")) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều lần đăng nhập, thử lại sau",
                ));
            }
            let b = json_obj(&bytes)?;
            return json_ok(
                k.login(&s(&b, "tenantId"), &s(&b, "email"), &s(&b, "password"))
                    .await?,
            );
        }
        (&Method::POST, Some("auth"), Some("oidc")) if seg(3) == Some("start") => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều lần đăng nhập, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            let tenant_id = s(&body, "tenantId");
            let result = k.oidc_begin(&tenant_id).await?;
            let Some(result) = result else {
                return Err(ApiError::new(
                    404,
                    "OIDC_DISABLED",
                    "Đăng nhập doanh nghiệp hiện chưa được cấu hình",
                ));
            };
            return Ok(Reply::Raw {
                status: 200,
                content_type: "application/json",
                body: serde_json::to_vec(&json!({ "authorizationUrl": result.authorization_url }))
                    .map_err(ApiError::internal)?,
                extra: vec![("set-cookie", result.set_cookie)],
            });
        }
        (&Method::POST, Some("auth"), Some("oidc")) if seg(3) == Some("complete") => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều lần đăng nhập, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            let cookie_header = parts
                .headers
                .get(header::COOKIE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            let flow_cookie = cookie_header
                .split(';')
                .find_map(|part| {
                    let (name, value) = part.trim().split_once('=')?;
                    (name == "osp_oidc").then_some(value)
                })
                .unwrap_or("");
            let identity = k
                .oidc_finish(flow_cookie, &s(&body, "code"), &s(&body, "state"))
                .await?
                .ok_or_else(|| {
                    ApiError::new(
                        404,
                        "OIDC_DISABLED",
                        "Đăng nhập doanh nghiệp hiện chưa được cấu hình",
                    )
                })?;
            let result = k
                .login_oidc(
                    &identity.tenant_id,
                    &identity.issuer,
                    &identity.subject,
                    &identity.email,
                )
                .await?;
            return Ok(Reply::Raw {
                status: 200,
                content_type: "application/json",
                body: serde_json::to_vec(&result).map_err(ApiError::internal)?,
                extra: vec![("set-cookie", crate::kernel::auth::oidc::clear_cookie())],
            });
        }
        (&Method::POST, Some("auth"), Some("mfa")) if seg(3) == Some("complete") => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều lần xác thực, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            return json_ok(
                crate::kernel::auth::mfa::complete_login(
                    k,
                    &s(&body, "challengeToken"),
                    &s(&body, "code"),
                )
                .await?,
            );
        }
        (&Method::POST, Some("auth"), Some("password-reset")) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            match seg(3) {
                Some("request") => {
                    k.request_password_reset(&s(&body, "tenantId"), &s(&body, "email"))
                        .await?;
                    return json_ok(json!({ "ok": true }));
                }
                Some("complete") => {
                    k.complete_password_reset(&s(&body, "token"), &s(&body, "password"))
                        .await?;
                    return json_ok(json!({ "ok": true }));
                }
                _ => return Err(ApiError::new(404, "NOT_FOUND", "Không tìm thấy")),
            }
        }
        (&Method::POST, Some("auth"), Some("email-verification")) if seg(3) == Some("complete") => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            k.complete_email_verification(&s(&body, "token")).await?;
            return json_ok(json!({ "ok": true }));
        }
        (&Method::POST, Some("auth"), Some("email-verification")) if seg(3) == Some("request") => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            k.request_email_verification(&s(&body, "tenantId"), &s(&body, "email"))
                .await?;
            return json_ok(json!({ "ok": true }));
        }
        (&Method::POST, Some("demo"), None) => {
            if !st.cfg.demo {
                return Err(ApiError::new(
                    403,
                    "DEMO_DISABLED",
                    "Chế độ dùng thử đang tắt",
                ));
            }
            if !st.create_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Tạo quá nhiều bản dùng thử, thử lại sau",
                ));
            }
            let b = json_obj(&bytes)?;
            let vertical = b.get("vertical").and_then(|v| v.as_str()).map(String::from);
            let email = format!(
                "demo-{}@demo.osp",
                &Uuid::new_v4().simple().to_string()[..6]
            );
            let password = Uuid::new_v4().to_string();
            let vname = vertical
                .as_ref()
                .and_then(|v| k.verticals.get(v))
                .map(|v| v.name.clone());
            let (t, _, _) = k
                .create_tenant(CreateTenant {
                    name: format!(
                        "Dùng thử{}",
                        vname.map(|n| format!(" · {n}")).unwrap_or_default()
                    ),
                    vertical,
                    modules: vec![],
                    admin: Some(AdminInput {
                        name: Some("Quản trị demo".into()),
                        email: Some(email.clone()),
                        password: Some(password.clone()),
                    }),
                    require_email_verification: false,
                })
                .await?;
            crate::demo::seed(k, &t).await;
            let session = k.login(&t.id, &email, &password).await?;
            return Ok(Reply::Json(
                201,
                json!({ "tenantId": t.id, "token": session["token"], "user": session["user"] }),
            ));
        }
        _ => {}
    }

    // ───── Có xác thực ─────
    let (token, t, actor, user) = auth(st, &parts.headers).await?;
    if seg(1) == Some("auth") {
        match (&method, seg(2)) {
            (&Method::GET, Some("me")) => {
                return json_ok(json!({ "tenantId": t.id, "user": user }));
            }
            (&Method::POST, Some("logout")) => {
                k.revoke_token(&token).await?;
                return json_ok(json!({ "ok": true }));
            }
            _ => {}
        }
    }
    if seg(1) != Some("t") || seg(2).is_none() {
        return Err(ApiError::new(404, "NOT_FOUND", "Không tìm thấy"));
    }
    if seg(2) != Some(t.id.as_str()) {
        return Err(ApiError::new(
            403,
            "WRONG_TENANT",
            "Token không thuộc tenant này",
        ));
    }
    let rest: Vec<&str> = segs[3..].iter().map(|x| x.as_str()).collect();
    let admin = |perm: &str| k.authorize(&t, &actor, perm);
    let qnum = |name: &str, d: i64| {
        query
            .iter()
            .find(|(a, _)| a == name)
            .and_then(|(_, v)| v.parse().ok())
            .unwrap_or(d)
    };

    match (&method, rest.as_slice()) {
        (&Method::GET, ["consolidation", "groups", group_id, "trial-balance"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.consolidated_trial_balance(&actor, &t, group_id, from, to)
                    .await?,
            );
        }
        (
            &Method::POST,
            [
                "consolidation",
                "groups",
                group_id,
                "intercompany-match-preview",
            ],
        ) => {
            let body = json_obj(&bytes)?;
            return json_ok(
                k.preview_intercompany_matches(&actor, &t, group_id, &Value::Object(body))
                    .await?,
            );
        }
        (
            &Method::GET,
            [
                "consolidation",
                "groups",
                group_id,
                "trial-balance",
                "snapshots",
            ],
        ) => {
            return json_ok(
                k.list_consolidated_trial_balance_snapshots(&actor, &t, group_id)
                    .await?,
            );
        }
        (
            &Method::POST,
            [
                "consolidation",
                "groups",
                group_id,
                "trial-balance",
                "snapshots",
            ],
        ) => {
            let body = json_obj(&bytes)?;
            let from = body.get("from").and_then(Value::as_str);
            let to = body.get("to").and_then(Value::as_str);
            return Ok(Reply::Json(
                201,
                k.create_consolidated_trial_balance_snapshot(&actor, &t, group_id, from, to)
                    .await?,
            ));
        }
        (&Method::GET, ["consolidation", "trial-balance", "snapshots", snapshot_id]) => {
            return json_ok(
                k.read_consolidated_trial_balance_snapshot(&actor, &t, snapshot_id)
                    .await?,
            );
        }
        (&Method::POST, ["consolidation", "groups", group_id, "report-grants"]) => {
            let body = json_obj(&bytes)?;
            return Ok(Reply::Json(
                201,
                k.grant_consolidated_report(
                    &actor,
                    &t,
                    group_id,
                    &s(&body, "userId"),
                    &s(&body, "reportType"),
                )
                .await?,
            ));
        }
        (&Method::POST, ["consolidation", "report-grants", grant_id, "revoke"]) => {
            return json_ok(
                k.revoke_consolidated_report_grant(&actor, &t, grant_id)
                    .await?,
            );
        }
        (&Method::POST, ["consolidation", "groups", group_id, "invites"]) => {
            let body = json_obj(&bytes)?;
            let result = k
                .invite_company_group_member(&actor, &t, group_id, &s(&body, "memberTenantId"))
                .await?;
            return Ok(Reply::Json(201, result));
        }
        (&Method::POST, ["consolidation", "invites", "accept"]) => {
            let body = json_obj(&bytes)?;
            return json_ok(
                k.accept_company_group_invite(
                    &actor,
                    &t,
                    &s(&body, "ownerTenantId"),
                    &s(&body, "memberId"),
                    &s(&body, "inviteToken"),
                )
                .await?,
            );
        }
        (&Method::POST, ["consolidation", "members", member_id, "revoke"]) => {
            return json_ok(k.revoke_company_group_member(&actor, &t, member_id).await?);
        }
        (&Method::POST, ["consolidation", "shared", "revoke"]) => {
            let body = json_obj(&bytes)?;
            return json_ok(
                k.revoke_shared_company(
                    &actor,
                    &t,
                    &s(&body, "ownerTenantId"),
                    &s(&body, "memberId"),
                )
                .await?,
            );
        }
        (&Method::GET, ["auth", "sessions"]) => {
            return json_ok(k.list_my_sessions(&t, &actor, &token).await?);
        }
        (&Method::POST, ["auth", "sessions", "revoke-others"]) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let revoked = k.revoke_other_sessions(&t, &actor, &token).await?;
            return json_ok(json!({ "revokedCount": revoked }));
        }
        (&Method::GET, ["auth", "mfa", "status"]) => {
            return json_ok(crate::kernel::auth::mfa::status(k, &t, &actor).await?);
        }
        (&Method::POST, ["auth", "mfa", "setup"]) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            return json_ok(
                crate::kernel::auth::mfa::setup_start(k, &t, &actor, &s(&body, "password")).await?,
            );
        }
        (&Method::POST, ["auth", "mfa", "confirm"]) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            return json_ok(
                crate::kernel::auth::mfa::setup_confirm(k, &t, &actor, &s(&body, "code"), &token)
                    .await?,
            );
        }
        (&Method::POST, ["auth", "mfa", "disable"]) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            crate::kernel::auth::mfa::disable(
                k,
                &t,
                &actor,
                &s(&body, "password"),
                &s(&body, "code"),
                &token,
            )
            .await?;
            return json_ok(json!({ "enabled": false }));
        }
        (&Method::POST, ["auth", "mfa", "users", target_user_id, "reset"]) => {
            if !st.auth_limiter.take(ip) {
                return Err(ApiError::new(
                    429,
                    "RATE_LIMITED",
                    "Quá nhiều yêu cầu, thử lại sau",
                ));
            }
            let body = json_obj(&bytes)?;
            crate::kernel::auth::mfa::admin_reset(
                k,
                &t,
                &actor,
                target_user_id,
                &s(&body, "reason"),
            )
            .await?;
            return json_ok(json!({ "enabled": false, "sessionsRevoked": true }));
        }
        _ => {}
    }

    match (&method, rest.as_slice()) {
        (&Method::GET, ["documents", document_id, "attachments"]) => {
            let items =
                crate::modules::document::list_attachments(k, &actor, &t, document_id).await?;
            return json_ok(json!({ "items": items }));
        }
        (&Method::POST, ["documents", document_id, "attachments"]) => {
            let file_name = parts
                .headers
                .get("x-file-name")
                .and_then(|value| value.to_str().ok())
                .map(|value| {
                    percent_encoding::percent_decode_str(value)
                        .decode_utf8_lossy()
                        .into_owned()
                })
                .unwrap_or_default();
            let content_type = parts
                .headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/octet-stream");
            let attachment = crate::modules::document::upload_attachment(
                k,
                &actor,
                &t,
                document_id,
                &file_name,
                content_type,
                &bytes,
            )
            .await?;
            return Ok(Reply::Json(201, attachment));
        }
        (&Method::GET, ["documents", document_id, "attachments", attachment_id]) => {
            let attachment = crate::modules::document::download_attachment(
                k,
                &actor,
                &t,
                document_id,
                attachment_id,
            )
            .await?;
            let file_name = safe_download_name(&attachment.file_name);
            return Ok(Reply::Raw {
                status: 200,
                content_type: "application/octet-stream",
                body: attachment.content,
                extra: vec![
                    (
                        "content-disposition",
                        format!("attachment; filename=\"{file_name}\""),
                    ),
                    ("x-content-type-options", "nosniff".into()),
                    ("x-content-sha256", attachment.sha256),
                ],
            });
        }
        _ => {}
    }

    match (&method, rest.as_slice()) {
        (&Method::POST, ["business", "preview"]) => {
            let body = json_obj(&bytes)?;
            let qname = body
                .get("entity")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (module, entity) = match qname {
                "sales.quotation" => ("sales", "quotation"),
                "sales.sales_order" => ("sales", "sales_order"),
                "sales.sales_return" => ("sales", "sales_return"),
                "purchasing.purchase_order" => ("purchasing", "purchase_order"),
                "purchasing.purchase_receipt" => ("purchasing", "purchase_receipt"),
                "purchasing.purchase_return" => ("purchasing", "purchase_return"),
                _ => {
                    return Err(ApiError::validation(
                        "business.preview",
                        vec!["Only sales and purchasing line documents can be previewed".into()],
                    ));
                }
            };
            if !t.has_module(module) {
                return Err(ApiError::new(
                    404,
                    "MODULE_DISABLED",
                    "The requested business module is not enabled for this tenant",
                ));
            }
            if !k.can(&t, &actor, &format!("{qname}.create"))
                && !k.can(&t, &actor, &format!("{qname}.update"))
            {
                return Err(ApiError::new(403, "FORBIDDEN", "Insufficient permission"));
            }
            let Some(mut document) = body.get("document").and_then(Value::as_object).cloned()
            else {
                return Err(ApiError::validation(
                    "business.preview",
                    vec!["Preview requires a document object".into()],
                ));
            };
            let mut conn = k.pool.get().await?;
            let tx = crate::db::Tx::begin(&mut conn, &t.id, false).await?;
            let errors = if module == "sales" {
                crate::modules::sales::preview_document(&tx, &t, entity, &mut document).await?
            } else {
                crate::modules::purchasing::preview_document(&tx, &t, entity, &mut document).await?
            };
            if !errors.is_empty() {
                return Err(ApiError::validation(qname, errors));
            }
            let lines = document
                .get("lines")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let fallback_total = sum_line_base_amount(&lines)?;
            let total = if lines.iter().any(|line| line.get("line_total").is_some()) {
                sum_line_field(&lines, "line_total")?
            } else {
                fallback_total
            };
            let subtotal = decimal_json(sum_line_field(&lines, "net_amount")?)?;
            let discount_total = decimal_json(sum_line_field(&lines, "discount_amount")?)?;
            let tax_total = decimal_json(sum_line_field(&lines, "tax_amount")?)?;
            let total = decimal_json(total)?;
            let result = json!({
                "lines": lines,
                "subtotal": subtotal,
                "discountTotal": discount_total,
                "taxTotal": tax_total,
                "total": total
            });
            tx.commit().await?;
            return json_ok(result);
        }
        (&Method::POST, ["accounting", "bank-statements", statement_id, "import"]) => {
            let csv = std::str::from_utf8(&bytes)
                .map_err(|_| ApiError::new(400, "INVALID_CSV", "CSV body must be UTF-8 text"))?;
            return json_ok(
                crate::modules::accounting::import_statement_csv(k, &actor, &t, statement_id, csv)
                    .await?,
            );
        }
        (&Method::POST, ["accounting", "bank-statements", statement_id, "import-ofx"]) => {
            let ofx = std::str::from_utf8(&bytes)
                .map_err(|_| ApiError::new(400, "INVALID_OFX", "OFX body must be UTF-8 text"))?;
            return json_ok(
                crate::modules::accounting::import_statement_ofx(k, &actor, &t, statement_id, ofx)
                    .await?,
            );
        }
        (
            &Method::POST,
            [
                "accounting",
                "bank-statements",
                statement_id,
                "import-mt940",
            ],
        ) => {
            let mt940 = std::str::from_utf8(&bytes).map_err(|_| {
                ApiError::new(400, "INVALID_MT940", "MT940 body must be UTF-8 text")
            })?;
            return json_ok(
                crate::modules::accounting::import_statement_mt940(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    mt940,
                )
                .await?,
            );
        }
        (
            &Method::POST,
            [
                "accounting",
                "bank-statements",
                statement_id,
                "import-casso",
            ],
        ) => {
            let payload = parse_json(&bytes)?;
            return json_ok(
                crate::modules::accounting::import_statement_casso(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    &payload,
                )
                .await?,
            );
        }
        (&Method::POST, ["accounting", "bank-statements", statement_id, "sync-casso"]) => {
            let payload = parse_json(&bytes)?;
            let connector_id = payload
                .get("connectorId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "accounting.bank_statement",
                        vec!["connectorId is required".into()],
                    )
                })?;
            let from_date = payload.get("fromDate").and_then(Value::as_str);
            let to_date = payload.get("toDate").and_then(Value::as_str);
            return json_ok(
                crate::modules::accounting::sync_statement_casso(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    connector_id,
                    from_date,
                    to_date,
                )
                .await?,
            );
        }
        (&Method::POST, ["accounting", "bank-statements", statement_id, "sync-sepay"]) => {
            let payload = parse_json(&bytes)?;
            let connector_id = payload
                .get("connectorId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "accounting.bank_statement",
                        vec!["connectorId is required".into()],
                    )
                })?;
            let from_date = payload.get("fromDate").and_then(Value::as_str);
            let to_date = payload.get("toDate").and_then(Value::as_str);
            return json_ok(
                crate::modules::accounting::sync_statement_sepay(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    connector_id,
                    from_date,
                    to_date,
                )
                .await?,
            );
        }
        (&Method::POST, ["accounting", "bank-statements", statement_id, "sync-plaid"]) => {
            let payload = parse_json(&bytes)?;
            let connector_id = payload
                .get("connectorId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "accounting.bank_statement",
                        vec!["connectorId is required".into()],
                    )
                })?;
            let from_date = payload.get("fromDate").and_then(Value::as_str);
            let to_date = payload.get("toDate").and_then(Value::as_str);
            return json_ok(
                crate::modules::accounting::sync_statement_plaid(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    connector_id,
                    from_date,
                    to_date,
                )
                .await?,
            );
        }
        (
            &Method::POST,
            [
                "accounting",
                "bank-statements",
                statement_id,
                "sync-salt-edge",
            ],
        ) => {
            let payload = parse_json(&bytes)?;
            let connector_id = payload
                .get("connectorId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "accounting.bank_statement",
                        vec!["connectorId is required".into()],
                    )
                })?;
            let from_date = payload.get("fromDate").and_then(Value::as_str);
            let to_date = payload.get("toDate").and_then(Value::as_str);
            return json_ok(
                crate::modules::accounting::sync_statement_salt_edge(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    connector_id,
                    from_date,
                    to_date,
                )
                .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "salt-edge", "connect"]) => {
            let payload = parse_json(&bytes)?;
            let return_to = payload
                .get("returnTo")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "integration-hub.connector",
                        vec!["returnTo is required".into()],
                    )
                })?;
            return json_ok(
                crate::modules::accounting::create_salt_edge_connect_url(
                    k,
                    &actor,
                    &t,
                    connector_id,
                    return_to,
                )
                .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "salt-edge", "complete"]) => {
            let payload = parse_json(&bytes)?;
            let connection_id = payload
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "integration-hub.connector",
                        vec!["connectionId is required".into()],
                    )
                })?;
            return json_ok(
                crate::modules::accounting::complete_salt_edge_link(
                    k,
                    &actor,
                    &t,
                    connector_id,
                    connection_id,
                )
                .await?,
            );
        }
        (&Method::GET, ["connectors", connector_id, "salt-edge", "accounts"]) => {
            return json_ok(
                crate::modules::accounting::list_salt_edge_accounts(k, &actor, &t, connector_id)
                    .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "salt-edge", "disconnect"]) => {
            return json_ok(
                crate::modules::accounting::disconnect_salt_edge(k, &actor, &t, connector_id)
                    .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "plaid", "link-token"]) => {
            return json_ok(
                crate::modules::accounting::create_plaid_link_token(k, &actor, &t, connector_id)
                    .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "plaid", "exchange"]) => {
            let payload = parse_json(&bytes)?;
            let public_token = payload
                .get("publicToken")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation(
                        "integration-hub.connector",
                        vec!["publicToken is required".into()],
                    )
                })?;
            return json_ok(
                crate::modules::accounting::complete_plaid_link(
                    k,
                    &actor,
                    &t,
                    connector_id,
                    public_token,
                )
                .await?,
            );
        }
        (&Method::GET, ["connectors", connector_id, "plaid", "accounts"]) => {
            return json_ok(
                crate::modules::accounting::list_plaid_accounts(k, &actor, &t, connector_id)
                    .await?,
            );
        }
        (&Method::POST, ["connectors", connector_id, "plaid", "disconnect"]) => {
            return json_ok(
                crate::modules::accounting::disconnect_plaid(k, &actor, &t, connector_id).await?,
            );
        }
        (
            &Method::POST,
            [
                "accounting",
                "bank-statements",
                statement_id,
                "import-camt053",
            ],
        ) => {
            let xml = std::str::from_utf8(&bytes).map_err(|_| {
                ApiError::new(400, "INVALID_XML", "CAMT.053 body must be UTF-8 XML")
            })?;
            return json_ok(
                crate::modules::accounting::import_statement_camt053(
                    k,
                    &actor,
                    &t,
                    statement_id,
                    xml,
                )
                .await?,
            );
        }
        (
            &Method::POST,
            [
                "reports",
                "inventory",
                "replenishment",
                "purchase-requisitions",
            ],
        ) => {
            let body = json_obj(&bytes)?;
            let requisition = k
                .create_replenishment_requisition(&actor, &t, &s(&body, "warehouseId"))
                .await?;
            return Ok(Reply::Json(201, requisition));
        }
        (&Method::DELETE, []) => {
            let b = json_obj(&bytes)?;
            k.delete_tenant(&actor, &t, &s(&b, "confirm")).await?;
            return json_ok(json!({ "ok": true }));
        }
        (&Method::GET, ["meta"]) => return json_ok(k.meta(&t)?),
        (&Method::GET, ["summary"]) => return json_ok(k.summary(&actor, &t).await?),
        (&Method::GET, ["reports", "bi", "kpis", kpi_id]) => {
            let kpi = k.get(&actor, &t, "bi.kpi", kpi_id).await?;
            let report_id = kpi.get("report").and_then(Value::as_str).ok_or_else(|| {
                ApiError::validation("bi.kpi", vec!["KPI has no saved report".into()])
            })?;
            let report = k.get(&actor, &t, "bi.report", report_id).await?;
            let query = report
                .get("query")
                .filter(|query| !query.is_null())
                .ok_or_else(|| {
                    ApiError::validation("bi.report", vec!["KPI report has no saved query".into()])
                })?;
            let (source, report_query) = crate::modules::bi::report_query(query)
                .map_err(|errors| ApiError::validation("bi.report", errors))?;
            let aggregate = crate::modules::bi::aggregate_spec(query)
                .map_err(|errors| ApiError::validation("bi.report", errors))?
                .filter(|aggregate| aggregate.group_by.is_none())
                .ok_or_else(|| {
                    ApiError::validation(
                        "bi.kpi",
                        vec!["KPI report must be an ungrouped aggregate".into()],
                    )
                })?;
            let source_ent = k.ent(&t, &source)?;
            if let Some((field, _)) = report_query
                .filter
                .iter()
                .find(|(field, _)| field != "id" && source_ent.field(field).is_none())
            {
                return Err(ApiError::validation(
                    "bi.report",
                    vec![format!("Unknown report filter field: {field}")],
                ));
            }
            let data = k
                .aggregate_bi_report(
                    &actor,
                    &t,
                    &source,
                    &report_query.filter,
                    report_query.q.as_deref(),
                    &aggregate,
                    &report_query,
                )
                .await?;
            let raw_value = data
                .get("items")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("value"))
                .and_then(money::decimal)
                .unwrap_or_default();
            let target = kpi.get("target").and_then(money::decimal);
            let formula = kpi
                .get("formula")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|formula| !formula.is_empty());
            let value = if let Some(formula) = formula {
                let formula = formula.strip_prefix('=').unwrap_or(formula);
                crate::expr::validate_expr(formula).map_err(|error| {
                    ApiError::validation("bi.kpi", vec![format!("Invalid KPI formula: {error}")])
                })?;
                let context = json!({
                    "value": decimal_json(raw_value)?,
                    "target": target.map(decimal_json).transpose()?
                });
                crate::expr::eval_expr_decimal(
                    formula,
                    &crate::expr::Scope {
                        this: &context,
                        event: &kpi,
                    },
                )
                .ok_or_else(|| {
                    ApiError::validation(
                        "bi.kpi",
                        vec!["KPI formula did not produce a valid decimal number".into()],
                    )
                })?
            } else {
                raw_value
            };
            let attainment = target
                .filter(|target| *target > Decimal::ZERO)
                .map(|target| {
                    value
                        .checked_mul(Decimal::ONE_HUNDRED)
                        .and_then(|value| value.checked_div(target))
                        .ok_or_else(|| ApiError::internal("KPI attainment exceeds Decimal range"))
                })
                .transpose()?;
            return json_ok(json!({
                "kpiId": kpi_id,
                "name": kpi.get("name"),
                "reportId": report_id,
                "source": source,
                "rawValue": decimal_json(raw_value)?,
                "value": decimal_json(value)?,
                "target": target.map(decimal_json).transpose()?,
                "attainmentPercent": attainment.map(decimal_json).transpose()?
            }));
        }
        (&Method::GET, ["reports", "bi", report_id, "runs"]) => {
            return json_ok(k.list_bi_report_runs(&actor, &t, report_id).await?);
        }
        (&Method::GET, ["reports", "bi", report_id, "export"]) => {
            let csv = k.export_bi_report_csv(&actor, &t, report_id).await?;
            return Ok(Reply::Raw {
                status: 200,
                content_type: "text/csv; charset=utf-8",
                body: csv.into_bytes(),
                extra: vec![(
                    "content-disposition",
                    format!("attachment; filename=\"bi-report-{report_id}.csv\""),
                )],
            });
        }
        (&Method::GET, ["reports", "bi", report_id]) => {
            return json_ok(k.run_bi_report(&actor, &t, report_id).await?);
        }
        (&Method::GET, ["reports", "accounting", "trial-balance"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(k.accounting_trial_balance(&actor, &t, from, to).await?);
        }
        (&Method::GET, ["reports", "accounting", "income-statement"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(k.accounting_income_statement(&actor, &t, from, to).await?);
        }
        (&Method::GET, ["reports", "accounting", "balance-sheet"]) => {
            let as_of = query
                .iter()
                .find(|(key, _)| key == "asOf")
                .map(|(_, value)| value.as_str());
            return json_ok(k.accounting_balance_sheet(&actor, &t, as_of).await?);
        }
        (&Method::GET, ["reports", "accounting", "cash-flow-forecast"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.accounting_cash_flow_forecast(&actor, &t, from, to)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "accounting", "receivables-aging"]) => {
            let as_of = query
                .iter()
                .find(|(key, _)| key == "asOf")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.accounting_aging_report(&actor, &t, "receivables", as_of)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "accounting", "payables-aging"]) => {
            let as_of = query
                .iter()
                .find(|(key, _)| key == "asOf")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.accounting_aging_report(&actor, &t, "payables", as_of)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "accounting", "fx-revaluation-preview"]) => {
            let as_of = query
                .iter()
                .find(|(key, _)| key == "asOf")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.accounting_fx_revaluation_preview(&actor, &t, as_of)
                    .await?,
            );
        }
        (&Method::POST, ["accounting", "adjustment-refunds"]) => {
            let body = json_obj(&bytes)?;
            let amount = body.get("amount").and_then(money::decimal).ok_or_else(|| {
                ApiError::validation(
                    "accounting.adjustment_refund",
                    vec!["Refund amount must be a valid decimal".into()],
                )
            })?;
            let result = crate::modules::accounting::create_adjustment_refund(
                &k,
                &actor,
                &t,
                &s(&body, "kind"),
                &s(&body, "adjustmentId"),
                amount,
                &s(&body, "method"),
                &s(&body, "paymentDate"),
                &s(&body, "requestId"),
            )
            .await?;
            let status = if result.get("existing") == Some(&Value::Bool(true)) {
                200
            } else {
                201
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::GET, ["reports", "accounting", "chart-templates"]) => {
            return json_ok(k.accounting_chart_templates(&actor, &t).await?);
        }
        (
            &Method::POST,
            [
                "reports",
                "accounting",
                "chart-templates",
                template_id,
                "apply",
            ],
        ) => {
            let result = k
                .apply_accounting_chart_template(&actor, &t, template_id)
                .await?;
            let status = if result
                .get("created")
                .and_then(Value::as_array)
                .is_some_and(|created| !created.is_empty())
            {
                201
            } else {
                200
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::POST, ["reports", "accounting", "fx-revaluation-journals"]) => {
            let body = json_obj(&bytes)?;
            let result = k
                .create_accounting_fx_revaluation_draft(
                    &actor,
                    &t,
                    &s(&body, "asOf"),
                    &s(&body, "memo"),
                )
                .await?;
            let status = if result.get("existing") == Some(&Value::Bool(true)) {
                200
            } else {
                201
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::GET, ["reports", "accounting", "tax-register"])
        | (&Method::GET, ["reports", "accounting", "sales-tax-register"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(k.accounting_tax_register(&actor, &t, from, to).await?);
        }
        (&Method::GET, ["reports", "manufacturing", "wip"]) => {
            let as_of = query
                .iter()
                .find(|(key, _)| key == "asOf")
                .map(|(_, value)| value.as_str());
            return json_ok(k.manufacturing_wip_report(&actor, &t, as_of).await?);
        }
        (
            &Method::GET,
            [
                "reports",
                "agriculture",
                "crop-cycles",
                cycle_id,
                "input-costs",
            ],
        ) => {
            let cycle_id = Uuid::parse_str(cycle_id)
                .map_err(|_| ApiError::new(422, "INVALID_ID", "Mã vụ mùa không hợp lệ"))?;
            return json_ok(
                k.agriculture_crop_cycle_input_costs(&actor, &t, cycle_id)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "asset", "depreciation-schedule"]) => {
            let months = query
                .iter()
                .find(|(key, _)| key == "months")
                .map(|(_, value)| value.as_str());
            return json_ok(k.asset_depreciation_schedule(&actor, &t, months).await?);
        }
        (&Method::POST, ["reports", "manufacturing", "wip", "reconciliation-journals"]) => {
            let body = json_obj(&bytes)?;
            let result = k
                .create_manufacturing_wip_reconciliation_draft(
                    &actor,
                    &t,
                    &s(&body, "asOf"),
                    &s(&body, "offsetAccountId"),
                    &s(&body, "memo"),
                )
                .await?;
            let status = if result.get("existing") == Some(&Value::Bool(true)) {
                200
            } else {
                201
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::GET, ["reports", "inventory", "replenishment"]) => {
            return json_ok(k.inventory_replenishment_report(&actor, &t).await?);
        }
        (&Method::GET, ["reports", "sales", "return-lots"]) => {
            let order_id = query
                .iter()
                .find(|(key, _)| key == "order")
                .map(|(_, value)| value.as_str())
                .ok_or_else(|| ApiError::new(422, "MISSING_ORDER", "order is required"))?;
            return json_ok(k.sales_return_lots_report(&actor, &t, order_id).await?);
        }
        (&Method::GET, ["reports", "inventory", "lot-expiry"]) => {
            let days = query_usize(&query, "days", 90, 365)? as i32;
            let limit = query_usize(&query, "limit", 100, 500)?;
            if limit == 0 {
                return Err(ApiError::new(
                    422,
                    "INVALID_PAGINATION",
                    "limit must be between 1 and 500",
                ));
            }
            let offset = query_usize(&query, "offset", 0, 1_000_000)?;
            return json_ok(
                k.inventory_lot_expiry_report(&actor, &t, days, limit, offset)
                    .await?,
            );
        }
        (&Method::POST, ["reports", "inventory", "lot-expiry", "writeoff-counts"]) => {
            let body = json_obj(&bytes)?;
            let result = k
                .create_expiry_writeoff_count(&actor, &t, &s(&body, "warehouseId"))
                .await?;
            let status = if result.get("existing") == Some(&Value::Bool(true)) {
                200
            } else {
                201
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::GET, ["reports", "restaurant", "kitchen-board"]) => {
            let station = query
                .iter()
                .find(|(key, _)| key == "station")
                .map(|(_, value)| value.as_str());
            let page_size = query
                .iter()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(50)
                .clamp(1, 100);
            let offset = query
                .iter()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(0)
                .max(0)
                .min(i64::MAX - page_size);
            return json_ok(
                k.restaurant_kitchen_board(&actor, &t, station, page_size, offset)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "logistics", "delivery-board"]) => {
            let page_size = query
                .iter()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(100)
                .clamp(1, 200);
            let offset = query
                .iter()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(0)
                .max(0)
                .min(i64::MAX - page_size);
            return json_ok(
                k.logistics_delivery_board(&actor, &t, page_size, offset)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "hotel", "housekeeping-board"]) => {
            let page_size = query
                .iter()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(50)
                .clamp(1, 100);
            let offset = query
                .iter()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(0)
                .max(0)
                .min(i64::MAX - page_size);
            return json_ok(
                k.hotel_housekeeping_board(&actor, &t, page_size, offset)
                    .await?,
            );
        }
        (
            &Method::POST,
            [
                "reports",
                "logistics",
                "shipments",
                shipment_id,
                "redeliver",
            ],
        ) => {
            let result = k
                .create_logistics_redelivery(&actor, &t, shipment_id)
                .await?;
            let status = if result.get("existing") == Some(&Value::Bool(true)) {
                200
            } else {
                201
            };
            return Ok(Reply::Json(status, result));
        }
        (&Method::GET, ["reports", "inventory", "lots", lot_id, "traceability"]) => {
            let limit = query_usize(&query, "limit", 100, 500)?;
            if limit == 0 {
                return Err(ApiError::new(
                    422,
                    "INVALID_PAGINATION",
                    "limit must be between 1 and 500",
                ));
            }
            let offset = query_usize(&query, "offset", 0, 1_000_000)?;
            return json_ok(
                k.inventory_lot_traceability_report(&actor, &t, lot_id, limit, offset)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "inventory", "location-stock"]) => {
            let warehouse = query
                .iter()
                .find(|(key, _)| key == "warehouse")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.inventory_location_stock_report(&actor, &t, warehouse)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "inventory", "quality-holds"]) => {
            let warehouse = query
                .iter()
                .find(|(key, _)| key == "warehouse")
                .map(|(_, value)| value.as_str());
            let status = query
                .iter()
                .find(|(key, _)| key == "status")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.inventory_quality_hold_report(&actor, &t, warehouse, status)
                    .await?,
            );
        }
        (&Method::GET, ["reports", "budget", "variance"]) => {
            let period = query
                .iter()
                .find(|(key, _)| key == "period")
                .map(|(_, value)| value.as_str());
            return json_ok(k.budget_variance_report(&actor, &t, period).await?);
        }
        (&Method::GET, ["reports", "crm", "pipeline"]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(k.crm_pipeline_report(&actor, &t, from, to).await?);
        }
        (&Method::GET, ["reports", "marketing", "campaign-performance"]) => {
            let model = query
                .iter()
                .find(|(key, _)| key == "model")
                .map(|(_, value)| value.as_str())
                .unwrap_or("first_touch");
            return json_ok(k.marketing_campaign_performance(&actor, &t, model).await?);
        }
        (&Method::GET, ["reports", "helpdesk", "sla"]) => {
            let page_size = query
                .iter()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(50)
                .clamp(1, 100);
            let offset = query
                .iter()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<i64>().ok())
                .unwrap_or(0)
                .max(0)
                .min(i64::MAX - page_size);
            return json_ok(k.helpdesk_sla_report(&actor, &t, page_size, offset).await?);
        }
        (&Method::GET, ["reports", "accounting", "general-ledger", account_id]) => {
            let from = query
                .iter()
                .find(|(key, _)| key == "from")
                .map(|(_, value)| value.as_str());
            let to = query
                .iter()
                .find(|(key, _)| key == "to")
                .map(|(_, value)| value.as_str());
            return json_ok(
                k.accounting_general_ledger(&actor, &t, account_id, from, to)
                    .await?,
            );
        }
        (&Method::GET, ["events"]) => return json_ok(k.event_log(&t, qnum("limit", 100)).await?),
        (&Method::GET, ["events", "page"]) => {
            return json_ok(
                k.event_log_page(
                    &t,
                    qnum("limit", 50),
                    qnum("offset", 0),
                    query_bool(&query, "rootsOnly", false)?,
                )
                .await?,
            );
        }
        (&Method::GET, ["events", "record", record_id]) => {
            return json_ok(k.event_log_for_record(&t, record_id).await?);
        }
        (&Method::POST, ["webhooks", id, "test"]) => {
            return json_ok(
                crate::modules::integration_hub::test_webhook(k, &actor, &t, id).await?,
            );
        }
        (&Method::POST, ["connectors", id, "test"]) => {
            return json_ok(
                crate::modules::integration_hub::test_connector(k, &actor, &t, id).await?,
            );
        }
        (&Method::GET, ["audit"]) => {
            return json_ok(k.audit_log(&actor, &t, qnum("limit", 200)).await?);
        }
        (&Method::GET, ["audit", "page"]) => {
            let filter = crate::kernel::rules::AuditLogFilter {
                user_id: query_text(&query, "userId", 120)?,
                action: query_text(&query, "action", 100)?,
                target: query_text(&query, "target", 200)?,
            };
            return json_ok(
                k.audit_log_page(&actor, &t, qnum("limit", 50), qnum("offset", 0), &filter)
                    .await?,
            );
        }
        (&Method::GET, ["alerts"]) => {
            let n = if k.can(&t, &actor, "tenant.admin") {
                k.open_failure_count(&t).await?
            } else {
                0
            };
            let outbox_dead = if k.can(&t, &actor, "tenant.admin") {
                crate::modules::integration_hub::dead_delivery_count(k, &t).await?
            } else {
                0
            };
            return json_ok(json!({ "failures": n, "outboxDead": outbox_dead }));
        }
        (&Method::GET, ["outbox"]) => {
            let status = query
                .iter()
                .find(|(key, _)| key == "status")
                .map(|(_, value)| value.as_str())
                .unwrap_or("dead");
            return json_ok(
                crate::modules::integration_hub::list_deliveries(
                    k,
                    &actor,
                    &t,
                    status,
                    qnum("limit", 50),
                    qnum("offset", 0),
                )
                .await?,
            );
        }
        (&Method::POST, ["outbox", id, "retry"]) => {
            crate::modules::integration_hub::retry_delivery(k, &actor, &t, id).await?;
            return json_ok(json!({ "ok": true, "status": "pending" }));
        }
        (&Method::POST, ["outbox", id, "dismiss"]) => {
            crate::modules::integration_hub::dismiss_delivery(k, &actor, &t, id).await?;
            return json_ok(json!({ "ok": true, "status": "cancelled" }));
        }
        (&Method::GET, ["failures"]) => {
            let status = query
                .iter()
                .find(|(a, _)| a == "status")
                .map(|(_, v)| v.clone())
                .unwrap_or_else(|| "open".into());
            return json_ok(
                k.list_failure_page(&actor, &t, &status, qnum("limit", 50), qnum("offset", 0))
                    .await?,
            );
        }
        (&Method::POST, ["failures", id, "retry"]) => {
            return json_ok(k.retry_failure(&actor, &t, id).await?);
        }
        (&Method::POST, ["failures", id, "dismiss"]) => {
            k.dismiss_failure(&actor, &t, id).await?;
            return json_ok(json!({ "ok": true }));
        }
        (&Method::POST, ["jobs", "run"]) => {
            admin("tenant.admin")?;
            return json_ok(json!({ "processed": k.run_jobs(&t).await? }));
        }
        (&Method::PATCH, ["settings"]) => {
            admin("tenant.admin")?;
            return json_ok(k.update_settings(&t, &parse_json(&bytes)?).await?);
        }
        (&Method::GET, ["approvals", "approvers"]) => {
            let can_manage_approvers = [
                "workflow-approval.approval_rule.read",
                "workflow-approval.approval_rule.create",
                "workflow-approval.approval_rule.update",
            ]
            .iter()
            .any(|permission| k.can(&t, &actor, permission));
            if !can_manage_approvers {
                return Err(ApiError::forbidden(
                    "workflow-approval.approval_rule.read/create/update",
                ));
            }
            let users = k
                .list_users(&t)
                .await?
                .into_iter()
                .map(|user| json!({ "id": user.id, "name": user.name, "disabled": user.disabled }))
                .collect::<Vec<_>>();
            return json_ok(json!(users));
        }
        (&Method::GET, ["users"]) => {
            admin("tenant.admin")?;
            return json_ok(serde_json::to_value(k.list_users(&t).await?).unwrap_or_default());
        }
        (&Method::POST, ["users"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            let roles: Vec<String> = b
                .get("roles")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_else(|| vec!["viewer".into()]);
            let (u, token) = k
                .add_user(
                    &t,
                    &s(&b, "name"),
                    b.get("email").and_then(|v| v.as_str()),
                    b.get("password").and_then(|v| v.as_str()),
                    &roles,
                )
                .await?;
            let mut out = serde_json::to_value(u).unwrap_or_default();
            if let Some(tok) = token {
                out["token"] = json!(tok);
            }
            return Ok(Reply::Json(201, out));
        }
        (&Method::PATCH, ["users", id]) => {
            admin("tenant.admin")?;
            return json_ok(
                serde_json::to_value(k.update_user(&t, id, &parse_json(&bytes)?).await?)
                    .unwrap_or_default(),
            );
        }
        (&Method::POST, ["roles"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            let perms = b
                .get("permissions")
                .and_then(|p| p.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            k.add_role(&t, &s(&b, "id"), &s(&b, "name"), perms).await?;
            return Ok(Reply::Json(201, json!({ "ok": true })));
        }
        (&Method::GET, ["tokens"]) => {
            admin("tenant.admin")?;
            return json_ok(k.list_tokens(&t).await?);
        }
        (&Method::POST, ["tokens"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            let uid = b
                .get("userId")
                .and_then(|v| v.as_str())
                .unwrap_or(&user.id)
                .to_string();
            let ttl = if let Some(value) = b.get("ttlDays") {
                let days = if let Value::String(value) = value {
                    money::decimal_str(value.trim())
                } else {
                    money::decimal(value)
                }
                .ok_or_else(|| {
                    ApiError::validation(
                        "tenant.token",
                        vec!["ttlDays must be a decimal number".into()],
                    )
                })?;
                if days < Decimal::ZERO {
                    return Err(ApiError::validation(
                        "tenant.token",
                        vec!["ttlDays cannot be negative".into()],
                    ));
                }
                let seconds = days
                    .checked_mul(Decimal::from(86_400))
                    .and_then(|value| value.trunc().to_u64())
                    .ok_or_else(|| {
                        ApiError::validation(
                            "tenant.token",
                            vec!["ttlDays exceeds the supported duration".into()],
                        )
                    })?;
                Some(Duration::from_secs(seconds))
            } else {
                None
            };
            let scopes = match b.get("scopes") {
                Some(value) => Some(
                    value
                        .as_array()
                        .ok_or_else(|| {
                            ApiError::validation(
                                "tenant.token",
                                vec!["scopes must be a list".into()],
                            )
                        })?
                        .iter()
                        .map(|scope| {
                            scope.as_str().map(str::to_string).ok_or_else(|| {
                                ApiError::validation(
                                    "tenant.token",
                                    vec!["Each scope must be a string".into()],
                                )
                            })
                        })
                        .collect::<R<Vec<_>>>()?,
                ),
                None => None,
            };
            let kind = if scopes.is_some() {
                "scoped_api"
            } else {
                "api"
            };
            return Ok(Reply::Json(
                201,
                k.issue_token(
                    &t,
                    &uid,
                    kind,
                    b.get("label").and_then(|v| v.as_str()),
                    ttl,
                    scopes,
                )
                .await?,
            ));
        }
        (&Method::DELETE, ["tokens", id]) => {
            admin("tenant.admin")?;
            if !k.revoke_token_by_id(&t, id).await? {
                return Err(ApiError::not_found("Không tìm thấy token"));
            }
            return json_ok(json!({ "ok": true }));
        }
        (&Method::POST, ["modules", "enable"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            let ids: Vec<String> = b
                .get("ids")
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            return json_ok(json!({ "added": k.enable_modules(&t, &ids).await? }));
        }
        (&Method::POST, ["modules", "disable"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            k.disable_module(&t, &s(&b, "id")).await?;
            return json_ok(json!({ "ok": true }));
        }
        (&Method::POST, ["custom-fields"]) => {
            admin("tenant.admin")?;
            let b = json_obj(&bytes)?;
            let f = k
                .add_custom_field(&t, &s(&b, "entity"), b.get("field").unwrap_or(&Value::Null))
                .await?;
            return Ok(Reply::Json(
                201,
                serde_json::to_value(f).unwrap_or_default(),
            ));
        }
        (&Method::GET, ["export"]) => {
            let data = k.export_tenant(&actor, &t).await?;
            return Ok(Reply::Raw {
                status: 200,
                content_type: "application/json; charset=utf-8",
                body: serde_json::to_vec(&data).unwrap_or_default(),
                extra: vec![(
                    "content-disposition",
                    format!("attachment; filename=\"osp-{}.json\"", t.id),
                )],
            });
        }
        (&Method::GET, ["export", m, e]) => {
            let q = format!("{m}.{e}");
            let csv = k.export_csv(&actor, &t, &q).await?;
            return Ok(Reply::Raw {
                status: 200,
                content_type: "text/csv; charset=utf-8",
                body: csv.into_bytes(),
                extra: vec![(
                    "content-disposition",
                    format!("attachment; filename=\"{q}.csv\""),
                )],
            });
        }
        (&Method::POST, ["import", m, e]) => {
            let q = format!("{m}.{e}");
            let key = idempotency_key(&parts.headers)?;
            let fire = query.iter().any(|(a, v)| a == "events" && v == "true");
            let is_csv = parts
                .headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.contains("csv"));
            let input = if is_csv {
                ImportInput::Csv(String::from_utf8_lossy(&bytes).into_owned())
            } else {
                let parsed = parse_json(&bytes)?;
                let rows = match parsed {
                    Value::Array(a) => a,
                    Value::Object(mut o) => match o.remove("rows") {
                        Some(Value::Array(a)) => a,
                        _ => {
                            return Err(ApiError::new(
                                400,
                                "BAD_JSON",
                                "Cần mảng bản ghi hoặc {\"rows\":[...]}",
                            ));
                        }
                    },
                    _ => {
                        return Err(ApiError::new(
                            400,
                            "BAD_JSON",
                            "Cần mảng bản ghi hoặc {\"rows\":[...]}",
                        ));
                    }
                };
                ImportInput::Rows(
                    rows.into_iter()
                        .enumerate()
                        .map(|(index, r)| {
                            if let Value::Object(o) = r {
                                Ok(o)
                            } else {
                                Err(ApiError::new(
                                    400,
                                    "BAD_JSON",
                                    format!("Dòng {} phải là một đối tượng JSON", index + 1),
                                ))
                            }
                        })
                        .collect::<R<Vec<_>>>()?,
                )
            };
            let result = k
                .import_records(&actor, &t, &q, input, fire, key.as_deref())
                .await?;
            let status = if result["errors"].as_array().is_some_and(|a| !a.is_empty()) {
                422
            } else {
                200
            };
            return Ok(Reply::Json(status, result));
        }
        _ => {}
    }

    // Dữ liệu: /api/t/:tenant/data/:module/:entity[/:id[/:action]]
    if let ["data", m, e, tail @ ..] = rest.as_slice() {
        let q = format!("{m}.{e}");
        match (&method, tail) {
            (&Method::GET, []) => {
                let skip = ["limit", "offset", "q", "sort", "dir"];
                let lq = ListQuery {
                    filter: query
                        .iter()
                        .filter(|(a, _)| !skip.contains(&a.as_str()))
                        .cloned()
                        .collect(),
                    limit: qnum("limit", 100),
                    offset: qnum("offset", 0),
                    q: query.iter().find(|(a, _)| a == "q").map(|(_, v)| v.clone()),
                    sort: query
                        .iter()
                        .find(|(a, _)| a == "sort")
                        .map(|(_, v)| v.clone()),
                    desc: query.iter().any(|(a, v)| a == "dir" && v == "desc"),
                };
                return json_ok(k.list(&actor, &t, &q, &lq).await?);
            }
            (&Method::POST, []) => {
                let key = idempotency_key(&parts.headers)?;
                let data = json_obj(&bytes)?;
                let created = match key {
                    Some(key) => k.create_idempotent(&actor, &t, &q, data, &key).await?,
                    None => k.create(&actor, &t, &q, data).await?,
                };
                return Ok(Reply::Json(201, created));
            }
            (&Method::POST, ["create-and-act", action]) => {
                if !matches!(
                    (q.as_str(), *action),
                    ("quality.inspection_disposition", "posted")
                        | ("pharmacy.return_disposition", "posted")
                        | ("pos.cash_movement", "posted")
                ) {
                    return Err(ApiError::new(404, "NOT_FOUND", "Route không tồn tại"));
                }
                let key = idempotency_key(&parts.headers)?.ok_or_else(|| {
                    ApiError::new(
                        400,
                        "BAD_IDEMPOTENCY_KEY",
                        "Cần gửi Idempotency-Key cho tác vụ này",
                    )
                })?;
                let created = k
                    .create_and_act_idempotent(&actor, &t, &q, json_obj(&bytes)?, action, &key)
                    .await?;
                return Ok(Reply::Json(201, created));
            }
            (&Method::GET, [id]) => return json_ok(k.get(&actor, &t, &q, id).await?),
            (&Method::PATCH, [id]) => {
                return json_ok(k.update(&actor, &t, &q, id, json_obj(&bytes)?).await?);
            }
            (&Method::DELETE, [id]) => {
                k.remove(&actor, &t, &q, id).await?;
                return json_ok(json!({ "ok": true }));
            }
            (&Method::POST, ["bulk", action]) => {
                let body = json_obj(&bytes)?;
                let ids = body
                    .get("ids")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        ApiError::new(422, "BAD_BULK_INPUT", "Cần trường ids dạng mảng")
                    })?
                    .iter()
                    .map(|value| {
                        value.as_str().map(str::to_owned).ok_or_else(|| {
                            ApiError::new(422, "BAD_BULK_INPUT", "Mỗi ID phải là chuỗi UUID")
                        })
                    })
                    .collect::<R<Vec<_>>>()?;
                return json_ok(k.act_bulk(&actor, &t, &q, action, ids).await?);
            }
            (&Method::POST, [id, action]) => {
                if q == "insurance.policy" && *action == "cancelled" {
                    let body = json_obj(&bytes)?;
                    let reason = body
                        .get("cancellation_reason")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if body.len() != 1 || !(5..=500).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "insurance.policy.cancelled",
                            vec!["Cần gửi duy nhất cancellation_reason từ 5 đến 500 ký tự".into()],
                        ));
                    }
                    return json_ok(k.insurance_cancel_policy(&actor, &t, id, reason).await?);
                }
                if (q == "payments.payment_txn" && matches!(*action, "succeeded" | "failed"))
                    || (q == "payments.payment_refund" && matches!(*action, "succeeded" | "failed"))
                {
                    if !bytes.is_empty() {
                        let mut body = json_obj(&bytes)?;
                        let reference = body
                            .get("reference")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .map(str::to_owned);
                        if body.len() != 1
                            || !body.contains_key("reference")
                            || reference
                                .as_deref()
                                .is_none_or(|value| value.chars().count() > 240)
                        {
                            return Err(ApiError::validation(
                                &format!("{q}.{action}"),
                                vec![
                                    "Chỉ chấp nhận trường reference dạng chuỗi, tối đa 240 ký tự"
                                        .into(),
                                ],
                            ));
                        }
                        body.insert(
                            "reference".into(),
                            reference
                                .as_deref()
                                .filter(|value| !value.is_empty())
                                .map_or(Value::Null, |value| Value::String(value.to_owned())),
                        );
                        return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                    }
                }
                if q == "logistics.shipment" && *action == "delivered" {
                    return json_ok(
                        k.logistics_confirm_shipment_delivery(&actor, &t, id, json_obj(&bytes)?)
                            .await?,
                    );
                }
                if q == "auto-service.repair_order" && *action == "quote_declined" {
                    let body = json_obj(&bytes)?;
                    if body.len() != 1 || !body.contains_key("declined_reason") {
                        return Err(ApiError::validation(
                            "auto-service.repair_order.quote_declined",
                            vec!["Cần gửi duy nhất trường declined_reason".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "events.ticket" && matches!(*action, "sold" | "refunded") {
                    let body = json_obj(&bytes)?;
                    let field = if *action == "sold" {
                        "method"
                    } else {
                        "refund_reason"
                    };
                    if body.len() != 1 || !body.contains_key(field) {
                        return Err(ApiError::validation(
                            if *action == "sold" {
                                "events.ticket.sold"
                            } else {
                                "events.ticket.refunded"
                            },
                            vec![format!("Cần gửi duy nhất trường {field}")],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "performance.review" && *action == "returned" {
                    let body = json_obj(&bytes)?;
                    if body.len() != 1 || !body.contains_key("revision_note") {
                        return Err(ApiError::validation(
                            "performance.review.returned",
                            vec!["Provide the revision_note field when returning a review".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "performance.review" && *action == "submitted" && !bytes.is_empty() {
                    let body = json_obj(&bytes)?;
                    if body.is_empty()
                        || body.keys().any(|field| {
                            !matches!(field.as_str(), "period" | "reviewer" | "score" | "comment")
                        })
                    {
                        return Err(ApiError::validation(
                            "performance.review.submitted",
                            vec![
                                "Only review period, reviewer, score, and comment can be submitted"
                                    .into(),
                            ],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "restaurant.table_order" && *action == "completed" {
                    let body = json_obj(&bytes)?;
                    if body.len() != 1 || !body.contains_key("method") {
                        return Err(ApiError::validation(
                            "restaurant.table_order.completed",
                            vec!["Cần gửi duy nhất trường method".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "restaurant.table_order" && *action == "cancelled" && !bytes.is_empty() {
                    let body = json_obj(&bytes)?;
                    if !body.is_empty()
                        && (body.len() != 1 || !body.contains_key("cancellation_reason"))
                    {
                        return Err(ApiError::validation(
                            "restaurant.table_order.cancelled",
                            vec!["Chỉ chấp nhận trường cancellation_reason".into()],
                        ));
                    }
                    if !body.is_empty() {
                        return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                    }
                }
                if q == "insurance.claim" && matches!(*action, "approved" | "rejected" | "paid") {
                    let body = json_obj(&bytes)?;
                    let valid = match *action {
                        "approved" => body.len() == 1 && body.contains_key("approved_amount"),
                        "rejected" => body.len() == 1 && body.contains_key("rejection_reason"),
                        "paid" => {
                            body.len() == 2
                                && body.contains_key("method")
                                && body.contains_key("expense_account")
                        }
                        _ => false,
                    };
                    if !valid {
                        return Err(ApiError::validation(
                            match *action {
                                "approved" => "insurance.claim.approved",
                                "rejected" => "insurance.claim.rejected",
                                _ => "insurance.claim.paid",
                            },
                            vec!["Dữ liệu action bồi thường thiếu trường bắt buộc hoặc có trường không được hỗ trợ".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "crm.deal" && *action == "lost" {
                    let body = json_obj(&bytes)?;
                    let reason = body
                        .get("lost_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if body.len() != 1 || !(5..=1000).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "crm.deal.lost",
                            vec!["Cần gửi duy nhất lost_reason có từ 5 đến 1000 ký tự".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "helpdesk.ticket" && *action == "resolved" && !bytes.is_empty() {
                    let body = json_obj(&bytes)?;
                    let resolution = body
                        .get("resolution")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if body.len() != 1 || !(1..=4000).contains(&resolution.chars().count()) {
                        return Err(ApiError::validation(
                            "helpdesk.ticket.resolved",
                            vec!["Cần gửi duy nhất resolution có từ 1 đến 4000 ký tự".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "accounting.bank_statement_line"
                    && *action == "matched"
                    && !bytes.is_empty()
                {
                    let body = json_obj(&bytes)?;
                    let valid_shape = body.len() == 2
                        && body.contains_key("payment")
                        && body.contains_key("journal_entry");
                    let payment = body.get("payment").is_some_and(|value| {
                        value.is_null()
                            || value
                                .as_str()
                                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                    });
                    let journal_entry = body.get("journal_entry").is_some_and(|value| {
                        value.is_null()
                            || value
                                .as_str()
                                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                    });
                    let exactly_one = body.get("payment").is_some_and(|value| !value.is_null())
                        != body
                            .get("journal_entry")
                            .is_some_and(|value| !value.is_null());
                    if !valid_shape || !payment || !journal_entry || !exactly_one {
                        return Err(ApiError::validation(
                            "accounting.bank_statement_line.matched",
                            vec!["Cần gửi đúng một payment hoặc journal_entry hợp lệ; trường còn lại phải là null".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "accounting.bank_statement_line"
                    && *action == "ignored"
                    && !bytes.is_empty()
                {
                    let body = json_obj(&bytes)?;
                    let reason = body
                        .get("ignore_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if body.len() != 1 || !(1..=500).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "accounting.bank_statement_line.ignored",
                            vec!["Cần gửi duy nhất ignore_reason có từ 1 đến 500 ký tự".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "clinic.encounter" && *action == "completed" {
                    let mut body = json_obj(&bytes)?;
                    let doctor = body
                        .get("doctor")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    let diagnosis = body
                        .get("diagnosis")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    let valid = body.keys().all(|field| {
                        matches!(
                            field.as_str(),
                            "doctor" | "diagnosis" | "fee" | "no_charge_reason"
                        )
                    }) && body.contains_key("doctor")
                        && body.contains_key("diagnosis")
                        && body.contains_key("fee")
                        && body
                            .get("no_charge_reason")
                            .is_none_or(|reason| reason.is_null() || reason.as_str().is_some())
                        && !doctor.is_empty()
                        && !diagnosis.is_empty();
                    if !valid {
                        return Err(ApiError::validation(
                            "clinic.encounter.completed",
                            vec![
                                "Dữ liệu hoàn tất lượt khám không hợp lệ: cần có bác sĩ, chẩn đoán và chỉ gửi doctor, diagnosis, fee, no_charge_reason tùy chọn".into(),
                            ],
                        ));
                    }
                    body.insert("doctor".into(), serde_json::json!(doctor));
                    body.insert("diagnosis".into(), serde_json::json!(diagnosis));
                    if let Some(reason) = body
                        .get("no_charge_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                    {
                        body.insert(
                            "no_charge_reason".into(),
                            serde_json::Value::String(reason.to_owned()),
                        );
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "clinic.lab_order" && *action == "resulted" {
                    let mut body = json_obj(&bytes)?;
                    let result = body
                        .get("result")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    if body.len() != 1 || result.is_empty() {
                        return Err(ApiError::validation(
                            "clinic.lab_order.resulted",
                            vec!["Cần gửi duy nhất trường result có nội dung".into()],
                        ));
                    }
                    body.insert("result".into(), serde_json::json!(result));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "einvoice.einvoice" && *action == "cancel_requested" {
                    let mut body = json_obj(&bytes)?;
                    let reason = body
                        .get("cancellation_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    if body.len() != 1 || !(1..=2000).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "einvoice.einvoice.cancel_requested",
                            vec![
                                "Cần gửi duy nhất cancellation_reason có từ 1 đến 2.000 ký tự"
                                    .into(),
                            ],
                        ));
                    }
                    body.insert("cancellation_reason".into(), serde_json::json!(reason));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "pos.pos_session" && *action == "closed" {
                    let body = json_obj(&bytes)?;
                    let valid_cash = body
                        .get("closing_cash")
                        .and_then(crate::money::decimal)
                        .is_some_and(|cash| cash >= rust_decimal::Decimal::ZERO);
                    if body.len() != 1 || !valid_cash {
                        return Err(ApiError::validation(
                            "pos.pos_session.closed",
                            vec!["Cần gửi duy nhất closing_cash là số không âm".into()],
                        ));
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "maintenance.maintenance_request" && *action == "done" {
                    let mut body = json_obj(&bytes)?;
                    let resolution = body
                        .get("resolution")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    let has_hours = body.contains_key("labor_hours");
                    let has_rate = body.contains_key("labor_rate");
                    let allowed_shape =
                        body.len() == 1 || (body.len() == 3 && has_hours && has_rate);
                    let labor_values_valid = body
                        .get("labor_hours")
                        .and_then(crate::money::decimal)
                        .is_some_and(|hours| hours >= rust_decimal::Decimal::ZERO)
                        && body
                            .get("labor_rate")
                            .and_then(crate::money::decimal)
                            .is_some_and(|rate| rate >= rust_decimal::Decimal::ZERO);
                    if !allowed_shape
                        || resolution.is_empty()
                        || (has_hours != has_rate)
                        || (has_hours && !labor_values_valid)
                    {
                        return Err(ApiError::validation(
                            "maintenance.maintenance_request.done",
                            vec!["Cần gửi resolution và nếu có nhân công thì phải gửi cả labor_hours, labor_rate không âm".into()],
                        ));
                    }
                    body.insert("resolution".into(), serde_json::json!(resolution));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "purchasing.supplier_invoice" && *action == "disputed" {
                    let mut body = json_obj(&bytes)?;
                    let reason = body
                        .get("dispute_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    if body.len() != 1 || !(1..=500).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "purchasing.supplier_invoice.disputed",
                            vec!["Cần gửi duy nhất dispute_reason có từ 1 đến 500 ký tự".into()],
                        ));
                    }
                    body.insert("dispute_reason".into(), serde_json::json!(reason));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "purchasing.supplier_invoice" && *action == "submitted" && !bytes.is_empty()
                {
                    let mut body = json_obj(&bytes)?;
                    let note = body
                        .get("resolution_note")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    if body.len() != 1 || !(1..=1000).contains(&note.chars().count()) {
                        return Err(ApiError::validation(
                            "purchasing.supplier_invoice.submitted",
                            vec!["Cần gửi duy nhất resolution_note có từ 1 đến 1.000 ký tự".into()],
                        ));
                    }
                    body.insert("resolution_note".into(), serde_json::json!(note));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "hrm.employee" && *action == "terminated" {
                    let mut body = json_obj(&bytes)?;
                    let date = body
                        .get("termination_date")
                        .and_then(serde_json::Value::as_str)
                        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
                    if body.len() != 1 || date.is_none() {
                        return Err(ApiError::validation(
                            "hrm.employee.terminated",
                            vec![
                                "Cần gửi duy nhất termination_date theo định dạng YYYY-MM-DD"
                                    .into(),
                            ],
                        ));
                    }
                    body.insert("termination_date".into(), serde_json::json!(date.unwrap()));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "hotel.reservation" && *action == "no_show" {
                    let mut body = json_obj(&bytes)?;
                    let reason = body
                        .get("no_show_reason")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_owned();
                    if body.len() != 1 || !(1..=500).contains(&reason.chars().count()) {
                        return Err(ApiError::validation(
                            "hotel.reservation.no_show",
                            vec!["Cần gửi duy nhất no_show_reason có từ 1 đến 500 ký tự".into()],
                        ));
                    }
                    body.insert("no_show_reason".into(), serde_json::json!(reason));
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                if q == "purchasing.rfq" && *action == "quoted" {
                    let mut body = json_obj(&bytes)?;
                    let allowed = body.contains_key("quote_lines")
                        && body.keys().all(|field| {
                            matches!(
                                field.as_str(),
                                "quote_lines" | "quote_reference" | "valid_until"
                            )
                        });
                    let quote_lines_valid = body
                        .get("quote_lines")
                        .and_then(serde_json::Value::as_array)
                        .is_some();
                    let quote_reference = match body.get("quote_reference") {
                        None | Some(serde_json::Value::Null) => None,
                        Some(value) => value
                            .as_str()
                            .map(str::trim)
                            .filter(|reference| reference.chars().count() <= 120)
                            .map(|reference| (!reference.is_empty()).then(|| reference.to_owned())),
                    };
                    let reference_valid = !body.contains_key("quote_reference")
                        || body["quote_reference"].is_null()
                        || quote_reference.is_some();
                    let valid_until = match body.get("valid_until") {
                        None | Some(serde_json::Value::Null) => Some(None),
                        Some(value) => value
                            .as_str()
                            .and_then(|date| {
                                chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
                            })
                            .map(Some),
                    };
                    if !allowed || !quote_lines_valid || !reference_valid || valid_until.is_none() {
                        return Err(ApiError::validation(
                            "purchasing.rfq.quoted",
                            vec!["Cần gửi quote_lines và chỉ hỗ trợ quote_reference (tối đa 120 ký tự), valid_until hợp lệ hoặc null".into()],
                        ));
                    }
                    if body.contains_key("quote_reference") {
                        body.insert(
                            "quote_reference".into(),
                            quote_reference
                                .flatten()
                                .map_or(serde_json::Value::Null, serde_json::Value::String),
                        );
                    }
                    if body.contains_key("valid_until") {
                        body.insert(
                            "valid_until".into(),
                            valid_until
                                .flatten()
                                .map_or(serde_json::Value::Null, |date| serde_json::json!(date)),
                        );
                    }
                    return json_ok(k.update_and_act(&actor, &t, &q, id, action, body).await?);
                }
                return json_ok(k.act(&actor, &t, &q, id, action).await?);
            }
            _ => {}
        }
    }
    Err(ApiError::new(404, "NOT_FOUND", "Đường dẫn không hợp lệ"))
}

fn constant_time_token_eq(left: &[u8], right: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

fn safe_download_name(value: &str) -> String {
    let name: String = value
        .chars()
        .take(120)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let name = name.trim_matches('.');
    if name.is_empty() {
        "attachment.bin".into()
    } else {
        name.into()
    }
}

fn catalog(st: &AppState) -> Value {
    let k = &st.kernel;
    let modules: Vec<Value> = k
        .reg
        .order
        .iter()
        .map(|id| &k.reg.modules[id])
        .map(|m| {
            let mut listens: Vec<&String> = m.rules.iter().map(|r| &r.on).collect();
            listens.sort();
            listens.dedup();
            json!({
                "id": m.id, "name": m.name, "description": m.description, "category": m.category, "version": m.version,
                "core": m.core, "depends": m.depends,
                "entities": m.entities.iter().map(|e| json!({ "name": e.name, "label": e.label })).collect::<Vec<_>>(),
                "listens": listens,
            })
        })
        .collect();
    let mut verticals: Vec<_> = k.verticals.values().collect();
    verticals.sort_by(|a, b| a.id.cmp(&b.id));
    let verticals: Vec<Value> = verticals
        .into_iter()
        .map(|v| {
            let installed: Vec<String> = v.modules.iter().filter(|m| k.reg.modules.contains_key(*m)).cloned().collect();
            json!({ "id": v.id, "name": v.name, "description": v.description, "modules": k.reg.closure(&installed).unwrap_or_default(), "summaryEntities": v.summary_entities, "setupEntities": v.setup_entities, "kpis": v.kpis })
        })
        .collect();
    json!({ "demo": st.cfg.demo, "signup": st.cfg.signup, "oidc": crate::kernel::auth::oidc::enabled(), "modules": modules, "verticals": verticals })
}
