//! Transport contracts independent of PostgreSQL availability.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use osp_server::{
    db, defs,
    http::{AppConfig, RateLimiter},
    kernel::{Kernel, KernelCfg},
};
use std::{net::SocketAddr, path::Path, sync::Arc, time::Duration};
use tower::ServiceExt;

fn app(public: &Path, rate: u32) -> Router {
    let definitions = Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions");
    let registry =
        defs::Registry::new(defs::load_dir(&definitions.join("modules")).unwrap()).unwrap();
    let kernel = Arc::new(Kernel::new(
        registry,
        vec![],
        db::make_pool("postgresql://unused:unused@127.0.0.1:1/unused", 1).unwrap(),
        KernelCfg::default(),
    ));
    osp_server::router(osp_server::app_state(
        kernel,
        AppConfig {
            demo: false,
            signup: false,
            log: false,
            rate_limit_per_min: rate,
            public_dir: public.into(),
        },
    ))
}

fn request(method: &str, uri: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(uri)
        .extension(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()))
}

fn security(response: &axum::response::Response) {
    let headers = response.headers();
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(headers["x-frame-options"], "DENY");
    assert_eq!(headers["referrer-policy"], "no-referrer");
    assert!(
        headers["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'")
    );
    assert!(!headers["x-request-id"].is_empty());
}

#[tokio::test]
async fn static_streaming_head_range_and_revalidation() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("index.html"),
        "<!doctype html><title>OSP</title>",
    )
    .unwrap();
    std::fs::write(directory.path().join("file.txt"), "0123456789").unwrap();
    let app = app(directory.path(), 100);
    let response = app
        .clone()
        .oneshot(request("GET", "/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    security(&response);
    assert!(
        response.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    assert_eq!(response.headers()["cache-control"], "no-cache");
    let modified = response.headers()["last-modified"].clone();
    let head = app
        .clone()
        .oneshot(request("HEAD", "/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["content-length"], "33");
    assert!(to_bytes(head.into_body(), 100).await.unwrap().is_empty());
    let response = app
        .clone()
        .oneshot(
            request("GET", "/file.txt")
                .header("range", "bytes=2-5")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
    assert_eq!(
        &to_bytes(response.into_body(), 100).await.unwrap()[..],
        b"2345"
    );
    let response = app
        .oneshot(
            request("GET", "/")
                .header("if-modified-since", modified)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    security(&response);
}

#[tokio::test]
async fn static_gzip_and_encoded_file_names() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("a+b.txt"), "literal plus").unwrap();
    std::fs::write(
        directory.path().join("large.css"),
        "body { color: red; }\n".repeat(500),
    )
    .unwrap();
    let app = app(directory.path(), 100);
    for uri in ["/a+b.txt", "/a%2Bb.txt"] {
        let response = app
            .clone()
            .oneshot(request("GET", uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert_eq!(
            &to_bytes(response.into_body(), 100).await.unwrap()[..],
            b"literal plus"
        );
    }
    let response = app
        .oneshot(
            request("GET", "/large.css")
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["content-encoding"], "gzip");
    assert!(to_bytes(response.into_body(), 20_000).await.unwrap().len() < 500);
}

#[tokio::test]
async fn paths_cannot_escape_public_or_expose_hidden_files() {
    let directory = tempfile::tempdir().unwrap();
    let public = directory.path().join("public");
    std::fs::create_dir(&public).unwrap();
    std::fs::write(directory.path().join("secret.txt"), "secret").unwrap();
    std::fs::write(public.join(".env"), "hidden").unwrap();
    let app = app(&public, 100);
    for uri in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2e%2e%5csecret.txt",
        "/.env",
        "/%2eenv",
        "/C%3A/secret.txt",
        "/%00.txt",
        "/%E2%82X",
    ] {
        let response = app
            .clone()
            .oneshot(request("GET", uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
        security(&response);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
}

#[tokio::test]
async fn api_contract_errors_ids_and_body_limit() {
    let directory = tempfile::tempdir().unwrap();
    let app = app(directory.path(), 100);
    let response = app
        .clone()
        .oneshot(
            request("GET", "/api/catalog")
                .header("x-request-id", "review-123")
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    security(&response);
    assert_eq!(response.headers()["x-request-id"], "review-123");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(!response.headers().contains_key("content-encoding"));
    let response = app
        .clone()
        .oneshot(
            request("GET", "/api/catalog")
                .header("x-request-id", "x".repeat(100))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["x-request-id"].len(), 36);
    let response = app
        .clone()
        .oneshot(
            request("GET", "/api/t/missing/data/crm/lead")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    security(&response);
    let response = app
        .clone()
        .oneshot(
            request("POST", "/api/tenants")
                .body(Body::from(vec![b'x'; 1_000_001]))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    security(&response);
    let json: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1000).await.unwrap()).unwrap();
    assert_eq!(json["error"]["code"], "TOO_LARGE");
    // Malformed UTF-8 used to panic when the handwritten decoder sliced a code point.
    let response = app
        .oneshot(request("GET", "/api/%E2%82X").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    security(&response);
}

#[tokio::test]
async fn governor_limits_api_but_leaves_static_available() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("index.html"), "OSP").unwrap();
    let app = app(directory.path(), 1);
    let first = app
        .clone()
        .oneshot(request("GET", "/api/catalog").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let limited = app
        .clone()
        .oneshot(request("GET", "/api/catalog").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.headers()["retry-after"], "60");
    security(&limited);
    let page = app
        .oneshot(request("GET", "/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
}

#[tokio::test]
async fn native_axum_methods_and_head_keep_security_contract() {
    let directory = tempfile::tempdir().unwrap();
    let app = app(directory.path(), 100);
    let head = app
        .clone()
        .oneshot(request("HEAD", "/api/catalog").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    security(&head);
    assert!(to_bytes(head.into_body(), 100).await.unwrap().is_empty());
    let invalid = app
        .oneshot(request("PUT", "/api/catalog").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::METHOD_NOT_ALLOWED);
    security(&invalid);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(invalid.into_body(), 1000).await.unwrap()).unwrap();
    assert_eq!(body["error"]["code"], "METHOD_NOT_ALLOWED");
}

#[test]
fn governor_serializes_competing_requests_and_isolates_keys() {
    let limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));
    let accepted: usize = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..64)
            .map(|_| {
                let limiter = limiter.clone();
                scope.spawn(move || usize::from(limiter.take("same-client")))
            })
            .collect();
        handles
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .sum()
    });
    assert_eq!(accepted, 10);
    assert!(limiter.take("other-client"));
    assert!(!RateLimiter::new(0, Duration::from_secs(60)).take("client"));
}
