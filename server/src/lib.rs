pub mod db;
pub mod defs;
pub mod delivery;
pub mod demo;
#[cfg(feature = "embedded-pg")]
pub mod embedded;
pub mod error;
pub mod expr;
pub mod http;
pub mod kernel;
pub mod modules;
pub mod money;
pub mod openapi;
pub mod schema;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Reserve enough worker stack for nested transactional ERP event workflows,
/// including unoptimized Windows builds. Memory is committed on demand by the OS.
pub const WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

/// Nạp định nghĩa, kết nối PostgreSQL, di trú lược đồ và dựng kernel.
pub async fn build_kernel(
    database_url: &str,
    defs_dir: &Path,
    only: Option<Vec<String>>,
) -> Result<kernel::Kernel, String> {
    let mut modules: Vec<defs::ModuleDef> = defs::load_dir(&defs_dir.join("modules"))?;
    if let Some(only) = only {
        let all = defs::Registry::new(modules.clone())?;
        let keep = all.closure(&only)?;
        modules.retain(|m| keep.contains(&m.id));
    }
    let verticals: Vec<defs::Vertical> =
        defs::load_dir(&defs_dir.join("verticals")).unwrap_or_default();
    let reg = defs::Registry::new(modules)?;

    let pool = db::make_pool(database_url, 16)?;
    {
        let mut conn = pool
            .get()
            .await
            .map_err(|e| format!("Không kết nối được PostgreSQL: {e}"))?;
        let row = conn
            .query_one(
                "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        if row.get::<_, bool>(0)
            && std::env::var("OSP_ALLOW_SUPERUSER").ok().as_deref() != Some("1")
        {
            return Err("Vai trò PostgreSQL có SUPERUSER/BYPASSRLS nên Row-Level Security không có tác dụng. Dùng vai trò thường (hoặc đặt OSP_ALLOW_SUPERUSER=1 chỉ để thử).".into());
        }
        schema::migrate(&mut conn, &reg).await?;
    }
    Ok(kernel::Kernel::new(
        reg,
        verticals,
        pool,
        kernel::KernelCfg::default(),
    ))
}

pub fn app_state(k: Arc<kernel::Kernel>, cfg: http::AppConfig) -> Arc<http::AppState> {
    let limit = cfg.rate_limit_per_min;
    let metrics_token = std::env::var("OSP_METRICS_TOKEN")
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty());
    let metrics_token = metrics_token.and_then(|token| {
        if token.len() >= 32 {
            Some(token)
        } else {
            tracing::warn!("OSP_METRICS_TOKEN must contain at least 32 characters; metrics endpoint is disabled");
            None
        }
    });
    Arc::new(http::AppState {
        kernel: k,
        cfg,
        trusted_proxies: http::load_trusted_proxies(),
        api_limiter: http::RateLimiter::new(limit, Duration::from_secs(60)),
        auth_limiter: http::RateLimiter::new(30, Duration::from_secs(60)),
        create_limiter: http::RateLimiter::new(20, Duration::from_secs(60)),
        metrics: http::HttpMetrics::default(),
        metrics_token,
    })
}

pub fn router(state: Arc<http::AppState>) -> axum::Router {
    delivery::router(state)
}

pub fn default_public_dir() -> PathBuf {
    PathBuf::from(std::env::var("OSP_PUBLIC").unwrap_or_else(|_| "client-dist".into()))
}

/// Chạy tác vụ theo lịch định kỳ (mặc định mỗi 60 giây; 0 = tắt).
pub fn spawn_scheduler(k: Arc<kernel::Kernel>, every_secs: u64) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match k.run_jobs_all().await {
                Ok(n) if n > 0 => tracing::info!(processed = n, "tác vụ theo lịch"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "tác vụ theo lịch lỗi"),
            }
        }
    });
}

/// Run the PostgreSQL-backed webhook delivery queue independently of HTTP
/// request lifetimes. A zero interval disables the worker for maintenance.
pub fn spawn_outbox_worker(k: Arc<kernel::Kernel>, every_secs: u64) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match modules::integration_hub::run_once(&k).await {
                Ok(n) if n > 0 => tracing::info!(claimed = n, "webhook outbox batch processed"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "webhook outbox worker failed"),
            }
        }
    });
}

/// Deliver queued tenant notifications through configured HTTP providers.
/// If no provider endpoint is set, the queue is left untouched.
pub fn spawn_communication_worker(k: Arc<kernel::Kernel>, every_secs: u64) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match modules::communication::run_once(&k).await {
                Ok(n) if n > 0 => tracing::info!(processed = n, "notification messages processed"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "notification worker failed"),
            }
        }
    });
}

/// Issue and cancel queued e-invoices through the configured HTTPS provider.
/// A zero interval disables the worker; missing provider configuration leaves
/// queued invoices untouched.
pub fn spawn_einvoice_worker(k: Arc<kernel::Kernel>, every_secs: u64) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match modules::einvoice::run_once(&k).await {
                Ok(n) if n > 0 => tracing::info!(processed = n, "e-invoice jobs processed"),
                Ok(_) => {}
                Err(error) => tracing::warn!(error = %error, "e-invoice worker failed"),
            }
        }
    });
}

/// Run the e-invoice worker with a vendor-specific Rust adapter.
pub fn spawn_einvoice_worker_with_provider(
    k: Arc<kernel::Kernel>,
    provider: Arc<dyn modules::einvoice::EInvoiceProvider>,
    every_secs: u64,
) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match modules::einvoice::run_once_with_provider(&k, provider.as_ref()).await {
                Ok(n) if n > 0 => tracing::info!(
                    processed = n,
                    provider = provider.code(),
                    "e-invoice jobs processed"
                ),
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(error = %error, provider = provider.code(), "e-invoice worker failed")
                }
            }
        }
    });
}

/// Run the e-invoice worker with a registry of compiled vendor adapters.
/// This is the extension point for deployments that need different providers
/// for different tenants; the registry stores no tenant credentials itself.
pub fn spawn_einvoice_worker_with_registry(
    k: Arc<kernel::Kernel>,
    registry: modules::einvoice::EInvoiceProviderRegistry,
    every_secs: u64,
) {
    if every_secs == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(every_secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        loop {
            tick.tick().await;
            match modules::einvoice::run_once_with_registry(&k, &registry).await {
                Ok(n) if n > 0 => {
                    tracing::info!(processed = n, "e-invoice registry jobs processed")
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(error = %error, "e-invoice registry worker failed"),
            }
        }
    });
}
