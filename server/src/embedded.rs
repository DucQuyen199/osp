//! PostgreSQL nhúng cho dev/demo/test: tải binary chính thức lần đầu, dữ liệu bền vững trong OSP_PG_DIR.
//! Tạo vai trò `osp_app` KHÔNG phải superuser để Row-Level Security có hiệu lực.
use postgresql_embedded::{PostgreSQL, Settings};
use std::path::PathBuf;
use std::time::Duration;

pub async fn start(
    dir: PathBuf,
    port: u16,
) -> Result<(PostgreSQL, String), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&dir)?;
    let dir = std::path::absolute(&dir)?;
    let secret_file = dir.join("superuser.secret");
    let secret = match std::fs::read_to_string(&secret_file) {
        Ok(s) => s.trim().to_string(),
        Err(_) => {
            let s = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            std::fs::write(&secret_file, &s)?;
            s
        }
    };
    let mut settings = Settings::default();
    settings.data_dir = dir.join("data");
    settings.password = secret.clone();
    settings.port = port;
    settings.temporary = false;
    settings.timeout = Some(Duration::from_secs(300));
    let mut pg = PostgreSQL::new(settings);
    pg.setup().await?;
    pg.start().await?;

    let app_pw = format!(
        "{}",
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, secret.as_bytes()).simple()
    );
    let admin_url = pg.settings().url("postgres");
    let (client, conn) = tokio_postgres::connect(&admin_url, tokio_postgres::NoTls).await?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let exists = client
        .query_opt("SELECT 1 FROM pg_roles WHERE rolname = 'osp_app'", &[])
        .await?
        .is_some();
    if !exists {
        client
            .batch_execute(&format!(
                "CREATE ROLE osp_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{app_pw}'"
            ))
            .await?;
    }
    if client
        .query_opt("SELECT 1 FROM pg_database WHERE datname = 'osp'", &[])
        .await?
        .is_none()
    {
        client
            .batch_execute("CREATE DATABASE osp OWNER osp_app")
            .await?;
    }
    let url = format!("postgresql://osp_app:{app_pw}@localhost:{port}/osp");
    Ok((pg, url))
}
