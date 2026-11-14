//! PostgreSQL adapter for versioned document attachment metadata and bytes.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMetadata {
    pub id: Uuid,
    pub document_version: i32,
    pub file_name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: String,
}

pub struct AttachmentDownload {
    pub file_name: String,
    pub content_type: String,
    pub sha256: String,
    pub content: Vec<u8>,
}

pub async fn create_attachment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    id: Uuid,
    document_id: Uuid,
    document_version: i32,
    file_name: &str,
    content_type: &str,
    sha256: &str,
    uploaded_by: &str,
    content: &[u8],
) -> R<()> {
    tx.execute(
        "INSERT INTO document__attachment_blob (tenant_id, id, document_id, document_version, file_name, content_type, size_bytes, sha256, uploaded_by, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        &[
            &tenant.id,
            &id,
            &document_id,
            &document_version,
            &file_name,
            &content_type,
            &(content.len() as i64),
            &sha256,
            &uploaded_by,
            &content,
        ],
    )
    .await?;
    Ok(())
}

pub async fn list_attachments(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document_id: &str,
) -> R<Vec<AttachmentMetadata>> {
    let document_id = Uuid::parse_str(document_id)
        .map_err(|_| crate::error::ApiError::not_found("document.document"))?;
    tx.query(
        "SELECT id, document_version, file_name, content_type, size_bytes, sha256, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM document__attachment_blob WHERE tenant_id = $1 AND document_id = $2 ORDER BY document_version DESC, created_at DESC",
        &[&tenant.id, &document_id],
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| AttachmentMetadata {
                id: row.get(0),
                document_version: row.get(1),
                file_name: row.get(2),
                content_type: row.get(3),
                size_bytes: row.get(4),
                sha256: row.get(5),
                created_at: row.get(6),
            })
            .collect()
    })
}

pub async fn load_attachment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document_id: Uuid,
    attachment_id: Uuid,
) -> R<Option<AttachmentDownload>> {
    tx.query_opt(
        "SELECT file_name, content_type, sha256, content FROM document__attachment_blob WHERE tenant_id = $1 AND document_id = $2 AND id = $3",
        &[&tenant.id, &document_id, &attachment_id],
    )
    .await
    .map(|row| {
        row.map(|row| AttachmentDownload {
            file_name: row.get(0),
            content_type: row.get(1),
            sha256: row.get(2),
            content: row.get(3),
        })
    })
}
