//! OSP Suite — máy chủ Rust + PostgreSQL.
//!
//!   osp-server                          dùng DATABASE_URL, hoặc (bản dev) PostgreSQL nhúng tự khởi động
//!
//! Biến môi trường:
//!   DATABASE_URL        postgresql://user:pass@host/db  (vai trò KHÔNG được là superuser — xem docs/SECURITY.md)
//!   OSP_PORT / PORT     cổng (mặc định 3000)
//!   OSP_DEFS            thư mục definitions/ (mặc định ../definitions)
//!   OSP_PUBLIC          thư mục giao diện (mặc định client-dist; build giao diện trước)
//!   OSP_MODULES         danh sách module cần cài (phân cách bằng dấu phẩy)
//!   OSP_DEMO / OSP_SIGNUP   1/0
//!   OSP_JOBS_INTERVAL_SEC   chu kỳ tác vụ theo lịch (mặc định 60; 0 = tắt)
//!   OSP_PG_DIR          (PostgreSQL nhúng) thư mục dữ liệu, mặc định ./data/pg
//!   NODE_ENV=production hoặc OSP_ENV=production   tắt demo mặc định, bật log JSON
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig};
use opentelemetry_sdk::{Resource, propagation::TraceContextPropagator, trace::SdkTracerProvider};
use osp_server::{
    app_state, build_kernel, default_public_dir, http::AppConfig, router,
    spawn_communication_worker, spawn_einvoice_worker, spawn_outbox_worker, spawn_scheduler,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

fn flag(name: &str, default: bool) -> bool {
    match std::env::var(name) {
        Ok(v) => matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"),
        Err(_) => default,
    }
}

fn main() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(osp_server::WORKER_STACK_BYTES)
        .build()
        .expect("Tokio runtime")
        .block_on(run());
}

async fn run() {
    let production = std::env::var("OSP_ENV")
        .or_else(|_| std::env::var("NODE_ENV"))
        .is_ok_and(|v| v == "production");
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    let tracer_provider = init_observability(production, filter);

    let process_role = std::env::var("OSP_PROCESS_ROLE").unwrap_or_else(|_| "all".into());
    if !matches!(process_role.as_str(), "api" | "worker" | "all") {
        fatal("OSP_PROCESS_ROLE must be api, worker, or all");
    }

    // Giữ tiến trình PostgreSQL nhúng sống suốt vòng đời máy chủ
    #[cfg(feature = "embedded-pg")]
    let mut embedded: Option<postgresql_embedded::PostgreSQL> = None;

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            #[cfg(feature = "embedded-pg")]
            {
                let dir = PathBuf::from(
                    std::env::var("OSP_PG_DIR").unwrap_or_else(|_| "./data/pg".into()),
                );
                let pg_port: u16 = std::env::var("OSP_PG_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(54329);
                let (pg, url) = osp_server::embedded::start(dir, pg_port)
                    .await
                    .unwrap_or_else(|e| {
                        fatal(&format!("Không khởi động được PostgreSQL nhúng: {e}"))
                    });
                embedded = Some(pg);
                url
            }
            #[cfg(not(feature = "embedded-pg"))]
            fatal("Thiếu DATABASE_URL (bản này không có PostgreSQL nhúng)")
        }
    };

    let defs_dir =
        PathBuf::from(std::env::var("OSP_DEFS").unwrap_or_else(|_| "../definitions".into()));
    let only = std::env::var("OSP_MODULES").ok().map(|s| {
        s.split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
    });
    let kernel = Arc::new(
        build_kernel(&database_url, &defs_dir, only)
            .await
            .unwrap_or_else(|e| fatal(&e)),
    );

    if process_role != "api" {
        spawn_scheduler(
            kernel.clone(),
            std::env::var("OSP_JOBS_INTERVAL_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
        );
        spawn_outbox_worker(
            kernel.clone(),
            std::env::var("OSP_OUTBOX_INTERVAL_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2),
        );
        spawn_communication_worker(
            kernel.clone(),
            std::env::var("OSP_COMM_INTERVAL_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
        );
        spawn_einvoice_worker(
            kernel.clone(),
            std::env::var("OSP_EINVOICE_INTERVAL_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
        );
    }

    if process_role == "worker" {
        tracing::info!("OSP background worker process started");
        shutdown_signal().await;
        #[cfg(feature = "embedded-pg")]
        if let Some(pg) = embedded {
            let _ = pg.stop().await;
        }
        shutdown_tracing(tracer_provider);
        return;
    }

    let port: u16 = std::env::var("OSP_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let cfg = AppConfig {
        demo: flag("OSP_DEMO", !production),
        signup: flag("OSP_SIGNUP", true),
        log: production,
        rate_limit_per_min: std::env::var("OSP_RATE_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(600),
        public_dir: default_public_dir(),
    };
    let state = app_state(kernel.clone(), cfg);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| fatal(&format!("Không mở được cổng {port}: {e}")));
    println!("OSP Suite (Rust + PostgreSQL) chạy tại http://localhost:{port}");
    println!(
        "Đã cài {} module · {} gói ngành",
        kernel.reg.modules.len(),
        kernel.verticals.len()
    );

    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .unwrap_or_else(|e| fatal(&e.to_string()));

    shutdown_tracing(tracer_provider);

    #[cfg(feature = "embedded-pg")]
    if let Some(pg) = embedded {
        let _ = pg.stop().await;
    }
}

fn init_observability(
    production: bool,
    filter: tracing_subscriber::EnvFilter,
) -> Option<SdkTracerProvider> {
    let endpoint_configured = [
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
    ]
    .iter()
    .any(|name| std::env::var(name).is_ok_and(|value| !value.trim().is_empty()));

    let provider = if endpoint_configured {
        match SpanExporter::builder()
            .with_http()
            .with_protocol(Protocol::HttpBinary)
            .build()
        {
            Ok(exporter) => Some(
                SdkTracerProvider::builder()
                    .with_batch_exporter(exporter)
                    .with_resource(Resource::builder().with_service_name("osp-server").build())
                    .build(),
            ),
            Err(error) => {
                eprintln!("Không khởi tạo được OTLP trace exporter: {error}");
                None
            }
        }
    } else {
        None
    };

    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    if production {
        let subscriber = tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json());
        if let Some(provider) = &provider {
            subscriber
                .with(
                    tracing_opentelemetry::layer()
                        .with_tracer(provider.tracer("osp-server"))
                        .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                            metadata.is_span() && metadata.name() == "http"
                        })),
                )
                .init();
        } else {
            subscriber.init();
        }
    } else {
        let subscriber = tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer());
        if let Some(provider) = &provider {
            subscriber
                .with(
                    tracing_opentelemetry::layer()
                        .with_tracer(provider.tracer("osp-server"))
                        .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                            metadata.is_span() && metadata.name() == "http"
                        })),
                )
                .init();
        } else {
            subscriber.init();
        }
    }

    if provider.is_some() {
        tracing::info!("OTLP HTTP/protobuf distributed tracing enabled");
    }
    provider
}

fn shutdown_tracing(provider: Option<SdkTracerProvider>) {
    if let Some(provider) = provider {
        if let Err(error) = provider.shutdown() {
            eprintln!("Không flush được OpenTelemetry trace provider: {error}");
        }
    }
}

fn fatal(msg: &str) -> ! {
    eprintln!("LỖI: {msg}");
    std::process::exit(1);
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
