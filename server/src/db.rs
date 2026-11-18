//! Kết nối PostgreSQL: pool, giao dịch theo tenant (RLS + khóa tư vấn), savepoint.
use crate::error::{ApiError, R};
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use tokio_postgres::config::SslMode;
use tokio_postgres::types::ToSql;
use tokio_postgres::{IsolationLevel, NoTls, Row};

pub type Params<'a> = &'a [&'a (dyn ToSql + Sync)];

pub fn make_pool(url: &str, max: usize) -> Result<Pool, String> {
    let mut cfg = Config::new();
    cfg.url = Some(url.to_string());
    // Domain date guards use UTC. PostgreSQL must use the same calendar even
    // when the database host runs in another timezone. Preserve other options.
    let connection = url
        .parse::<tokio_postgres::Config>()
        .map_err(|error| error.to_string())?;
    cfg.options = Some(format!(
        "{} -c timezone=UTC",
        connection.get_options().unwrap_or_default()
    ));
    cfg.manager = Some(ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    });
    cfg.pool = Some(deadpool_postgres::PoolConfig::new(max));
    if connection.get_ssl_mode() == SslMode::Disable {
        cfg.create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|e| e.to_string())
    } else {
        cfg.create_pool(Some(Runtime::Tokio1), database_tls()?)
            .map_err(|e| e.to_string())
    }
}

fn database_tls() -> Result<tokio_postgres_rustls::MakeRustlsConnect, String> {
    let native = rustls_native_certs::load_native_certs();
    let mut roots = rustls::RootCertStore::empty();
    let mut loaded = 0usize;
    for certificate in native.certs {
        roots
            .add(certificate)
            .map_err(|error| format!("Không nạp được chứng chỉ CA hệ thống: {error}"))?;
        loaded += 1;
    }
    if loaded == 0 {
        let details = native
            .errors
            .into_iter()
            .map(|error| error.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(if details.is_empty() {
            "Không tìm thấy CA hệ thống cho kết nối PostgreSQL TLS".into()
        } else {
            format!("Không nạp được CA hệ thống cho PostgreSQL TLS: {details}")
        });
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let client = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| format!("Không khởi tạo được phiên bản TLS an toàn: {error}"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(tokio_postgres_rustls::MakeRustlsConnect::new(client))
}

/// Giao dịch gắn với một tenant: đặt app.tenant_id (RLS) và (khi ghi) khóa tư vấn theo tenant.
pub struct Tx<'a> {
    inner: deadpool_postgres::Transaction<'a>,
    sp: AtomicU32,
}

impl<'a> Tx<'a> {
    pub async fn begin(
        conn: &'a mut deadpool_postgres::Object,
        tenant: &str,
        write: bool,
    ) -> R<Tx<'a>> {
        let inner = conn.transaction().await?;
        inner
            .execute("SELECT set_config('app.tenant_id', $1, true)", &[&tenant])
            .await?;
        if write {
            // Tuần tự hóa các thao tác ghi CỦA CÙNG TENANT (khác tenant chạy song song; đúng cả khi nhiều tiến trình)
            inner
                .execute(
                    "SELECT pg_advisory_xact_lock(hashtext($1))",
                    &[&format!("osp:{tenant}")],
                )
                .await?;
        } else {
            inner.batch_execute("SET TRANSACTION READ ONLY").await?;
        }
        Ok(Tx {
            inner,
            sp: AtomicU32::new(0),
        })
    }

    /// Begin a read-only transaction with one stable snapshot across all pages.
    pub async fn begin_snapshot(
        conn: &'a mut deadpool_postgres::Object,
        tenant: &str,
    ) -> R<Tx<'a>> {
        let inner = conn
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .await?;
        inner
            .execute("SELECT set_config('app.tenant_id', $1, true)", &[&tenant])
            .await?;
        Ok(Tx {
            inner,
            sp: AtomicU32::new(0),
        })
    }

    pub async fn query(&self, sql: &str, params: Params<'_>) -> R<Vec<Row>> {
        let st = self.inner.prepare_cached(sql).await?;
        Ok(self.inner.query(&st, params).await?)
    }

    pub async fn query_opt(&self, sql: &str, params: Params<'_>) -> R<Option<Row>> {
        let st = self.inner.prepare_cached(sql).await?;
        Ok(self.inner.query_opt(&st, params).await?)
    }

    pub async fn query_one_row(&self, sql: &str, params: Params<'_>) -> R<Row> {
        let st = self.inner.prepare_cached(sql).await?;
        Ok(self.inner.query_one(&st, params).await?)
    }

    pub async fn query_json(&self, sql: &str, params: Params<'_>) -> R<Vec<Value>> {
        Ok(self
            .query(sql, params)
            .await?
            .into_iter()
            .map(|r| r.get::<_, Value>(0))
            .collect())
    }

    pub async fn execute(&self, sql: &str, params: Params<'_>) -> R<u64> {
        let st = self.inner.prepare_cached(sql).await?;
        Ok(self.inner.execute(&st, params).await?)
    }

    pub async fn batch(&self, sql: &str) -> R<()> {
        Ok(self.inner.batch_execute(sql).await?)
    }

    /// Savepoint: lỗi bên trong chỉ hoàn tác phần đó.
    pub async fn savepoint(&self) -> R<String> {
        let name = format!("sp{}", self.sp.fetch_add(1, Ordering::Relaxed));
        self.batch(&format!("SAVEPOINT {name}")).await?;
        Ok(name)
    }
    pub async fn release(&self, name: &str) -> R<()> {
        self.batch(&format!("RELEASE SAVEPOINT {name}")).await
    }
    pub async fn rollback_to(&self, name: &str) -> R<()> {
        self.batch(&format!(
            "ROLLBACK TO SAVEPOINT {name}; RELEASE SAVEPOINT {name}"
        ))
        .await
    }

    pub async fn commit(self) -> R<()> {
        Ok(self.inner.commit().await?)
    }
}

pub fn pool_err(e: deadpool_postgres::PoolError) -> ApiError {
    ApiError::internal(e)
}

#[cfg(test)]
mod tests {
    use super::{database_tls, make_pool};

    #[test]
    fn tls_connector_builds_from_system_trust_roots() {
        assert!(database_tls().is_ok());
    }

    #[test]
    fn explicit_disable_keeps_plain_local_pool_available() {
        assert!(
            make_pool(
                "postgresql://osp:secret@127.0.0.1:5432/osp?sslmode=disable",
                1
            )
            .is_ok()
        );
    }
}
