//! Tenant-scoped folder, document, and signature-request relationship checks.
mod attachments;

pub use attachments::{
    AttachmentDownload, AttachmentMetadata, create_attachment, list_attachments, load_attachment,
};

use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "folder" => validate_folder(tx, tenant, action, document).await,
        "document" => validate_document(tx, tenant, action, document).await,
        "signature_request" => validate_signature_request(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_folder(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        &[&tenant.id],
    )
    .await?;
    let parent = document
        .get("parent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(parent) = parent {
        let Some(parent_id) = Uuid::parse_str(parent).ok() else {
            return Ok(vec![
                "Folder parent must reference a folder in this tenant".into(),
            ]);
        };
        let current_id = parse_id(document, "id");
        if current_id == Some(parent_id) {
            return Ok(vec!["A folder cannot be its own parent".into()]);
        }
        if tx
            .query_opt(
                "SELECT id FROM document__folder WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &parent_id],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Parent folder does not exist in this tenant".into()]);
        }
        if let Some(current_id) = current_id {
            if tx.query_opt(
                "WITH RECURSIVE ancestors(id, parent) AS (SELECT id, parent FROM document__folder WHERE tenant_id = $1 AND id = $2 UNION SELECT f.id, f.parent FROM document__folder f JOIN ancestors a ON f.id::text = a.parent WHERE f.tenant_id = $1 AND a.parent IS NOT NULL) SELECT id FROM ancestors WHERE id = $3 LIMIT 1",
                &[&tenant.id, &parent_id, &current_id],
            ).await?.is_some() {
                return Ok(vec!["A folder cannot be moved beneath one of its descendants".into()]);
            }
        }
    }
    if action == "removed" {
        if let Some(id) = parse_id(document, "id") {
            if tx.query_opt(
                "SELECT id FROM document__folder WHERE tenant_id = $1 AND parent = $2 UNION ALL SELECT id FROM document__document WHERE tenant_id = $1 AND folder::text = $2 LIMIT 1",
                &[&tenant.id, &id.to_string()],
            ).await?.is_some() {
                return Ok(vec!["A folder with child folders or documents cannot be deleted".into()]);
            }
        }
    }
    Ok(Vec::new())
}

async fn validate_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if let Some(folder) = parse_id(document, "folder") {
        if tx
            .query_opt(
                "SELECT id FROM document__folder WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &folder],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Document folder does not exist in this tenant".into()]);
        }
    }
    if action == "updated" {
        if let Some(id) = parse_id(document, "id") {
            if tx.query_opt(
                "SELECT id FROM document__signature_request WHERE tenant_id = $1 AND document = $2 AND status IN ('signed', 'declined') LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                return Ok(vec!["Documents with completed signature requests are immutable".into()]);
            }
        }
    }
    if action == "removed" {
        if let Some(id) = parse_id(document, "id") {
            if tx.query_opt(
                "SELECT id FROM document__signature_request WHERE tenant_id = $1 AND document = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                return Ok(vec!["A document with signature history cannot be deleted".into()]);
            }
            if tx.query_opt(
                "SELECT id FROM document__attachment_blob WHERE tenant_id = $1 AND document_id = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                return Ok(vec!["A document with stored attachments cannot be deleted".into()]);
            }
        }
    }
    Ok(Vec::new())
}

async fn validate_signature_request(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(document_id) = parse_id(document, "document") else {
        return Ok(vec!["Signature request requires a valid document".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT file_url FROM document__document WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &document_id],
        )
        .await?
    else {
        return Ok(vec![
            "Signature document does not exist in this tenant".into(),
        ]);
    };
    let file_url: Option<String> = row.get(0);
    if file_url.as_deref().is_none_or(str::is_empty) {
        return Ok(vec![
            "A document must have a file URL before requesting a signature".into(),
        ]);
    }
    if action == "created" {
        let email = document
            .get("signer_email")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if tx.query_opt(
            "SELECT id FROM document__signature_request WHERE tenant_id = $1 AND document = $2 AND lower(btrim(signer_email)) = lower($3) AND status = 'pending' LIMIT 1",
            &[&tenant.id, &document_id, &email],
        ).await?.is_some() {
            return Ok(vec!["This signer already has a pending request for the document".into()]);
        }
    }
    Ok(Vec::new())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
