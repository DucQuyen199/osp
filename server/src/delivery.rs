//! HTTP transport built from Axum and Tower services. Business commands stay in
//! the kernel so every API adapter shares authorization and transaction rules.
use crate::{
    error::ApiError,
    http::{self, AppState},
};
use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use opentelemetry::{global, propagation::Extractor};
use std::{path::PathBuf, sync::Arc};
use tower::{ServiceBuilder, ServiceExt};
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::CompressionLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::{DefaultOnResponse, TraceLayer},
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

pub fn router(state: Arc<AppState>) -> Router {
    let request_log = state.cfg.log;
    let files = Router::new()
        .fallback(static_file)
        // Only public files are compressed. Authenticated JSON can contain
        // secrets together with user-controlled data and stays uncompressed.
        .layer(CompressionLayer::new())
        .with_state(state.cfg.public_dir.clone());
    Router::new()
        .route("/metrics", get(http::handle))
        .route("/api/health", get(http::handle))
        .route("/api/catalog", get(http::handle))
        .route("/api/openapi.json", get(http::handle))
        .route("/api/tenants", post(http::handle))
        .route("/api/demo", post(http::handle))
        .route("/api/auth/login", post(http::handle))
        .route("/api/auth/password-reset/request", post(http::handle))
        .route("/api/auth/password-reset/complete", post(http::handle))
        .route("/api/auth/email-verification/request", post(http::handle))
        .route("/api/auth/email-verification/complete", post(http::handle))
        .route("/api/t/{tenant}/data/{module}/{entity}", get(http::handle).post(http::handle))
        .route("/api/t/{tenant}/data/{module}/{entity}/{id}", get(http::handle).patch(http::handle).delete(http::handle))
        .route("/api/t/{tenant}/data/{module}/{entity}/{id}/{action}", post(http::handle))
        .route("/api/t/{tenant}/{*path}", any(http::handle))
        .route("/api", any(http::handle))
        .route("/api/{*path}", any(http::handle))
        .method_not_allowed_fallback(|| async {
            ApiError::new(405, "METHOD_NOT_ALLOWED", "Phương thức HTTP không được hỗ trợ")
        })
        .fallback_service(files)
        .with_state(state)
        .layer(
            ServiceBuilder::new()
                .layer(middleware::from_fn(normalize_request_id))
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(TraceLayer::new_for_http().make_span_with(move |request: &Request| {
                    let parent = global::get_text_map_propagator(|propagator| {
                        propagator.extract(&HeaderExtractor(request.headers()))
                    });
                    let span = if request_log {
                        // Do not attach URL paths here: tenant and record IDs are
                        // present in API paths and must not reach trace backends.
                        tracing::info_span!("http", method = %request.method(), request_id = ?request.headers().get("x-request-id"))
                    } else {
                        tracing::debug_span!("http", method = %request.method(), request_id = ?request.headers().get("x-request-id"))
                    };
                    let _ = span.set_parent(parent);
                    span
                }).on_response(DefaultOnResponse::new().level(if request_log { tracing::Level::INFO } else { tracing::Level::DEBUG })))
                .layer(SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, HeaderValue::from_static("no-store")))
                .layer(SetResponseHeaderLayer::overriding(HeaderName::from_static("content-security-policy"), HeaderValue::from_static(CSP)))
                .layer(SetResponseHeaderLayer::overriding(HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff")))
                .layer(SetResponseHeaderLayer::overriding(HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY")))
                .layer(SetResponseHeaderLayer::overriding(HeaderName::from_static("referrer-policy"), HeaderValue::from_static("no-referrer")))
                .layer(SetResponseHeaderLayer::overriding(HeaderName::from_static("permissions-policy"), HeaderValue::from_static("camera=(), microphone=(), geolocation=()")))
                .layer(CatchPanicLayer::custom(|_: Box<dyn std::any::Any + Send>| {
                    ApiError::internal("HTTP handler panicked").into_response()
                })),
        )
}

struct HeaderExtractor<'a>(&'a HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0
            .keys()
            .filter_map(|key| key.as_str().into())
            .collect()
    }
}

async fn normalize_request_id(mut request: Request, next: Next) -> Response {
    let valid = request.headers().get("x-request-id").is_some_and(|value| {
        !value.is_empty()
            && value.len() <= 64
            && value
                .as_bytes()
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    });
    if !valid {
        request.headers_mut().remove("x-request-id");
    }
    next.run(request).await
}

async fn static_file(State(root): State<PathBuf>, request: Request) -> Response {
    let Ok(path) = percent_encoding::percent_decode_str(request.uri().path()).decode_utf8() else {
        return ApiError::not_found("Không tìm thấy").into_response();
    };
    let relative = path.trim_start_matches('/');
    if relative
        .split('/')
        .any(|part| part.starts_with('.') || part.contains(['\\', '\0', ':']))
    {
        return ApiError::not_found("Không tìm thấy").into_response();
    }
    // ServeDir owns streaming, MIME, HEAD, byte ranges, and Last-Modified/304.
    // Check the canonical target as well to preserve the symlink/junction guard.
    let target = root.join(if relative.is_empty() {
        "index.html"
    } else {
        relative
    });
    let (Ok(canonical_root), Ok(mut canonical_target)) = (
        tokio::fs::canonicalize(&root).await,
        tokio::fs::canonicalize(&target).await,
    ) else {
        return ApiError::not_found("Không tìm thấy").into_response();
    };
    if tokio::fs::metadata(&canonical_target)
        .await
        .is_ok_and(|metadata| metadata.is_dir())
    {
        let Ok(index) = tokio::fs::canonicalize(canonical_target.join("index.html")).await else {
            return ApiError::not_found("Không tìm thấy").into_response();
        };
        canonical_target = index;
    }
    if !canonical_target.starts_with(canonical_root) {
        return ApiError::not_found("Không tìm thấy").into_response();
    }
    let mut response = ServeDir::new(root)
        .oneshot(request)
        .await
        .unwrap_or_else(|never| match never {})
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}
