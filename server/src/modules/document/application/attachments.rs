//! Application workflows for versioned, tenant-scoped document attachments.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub use super::super::persistence::{AttachmentDownload, AttachmentMetadata};
use super::super::{MAX_ATTACHMENT_BYTES, persistence};

pub async fn list_attachments(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    document_id: &str,
) -> R<Vec<AttachmentMetadata>> {
    kernel.ent(tenant, "document.document")?;
    kernel.authorize(tenant, actor, "document.document.read")?;
    kernel
        .get(actor, tenant, "document.document", document_id)
        .await?;

    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
    let items = persistence::list_attachments(&tx, tenant, document_id).await?;
    tx.commit().await?;
    Ok(items)
}

pub async fn upload_attachment(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    document_id: &str,
    file_name: &str,
    content_type: &str,
    content: &[u8],
) -> R<Value> {
    kernel.ent(tenant, "document.document")?;
    kernel.authorize(tenant, actor, "document.document.read")?;
    kernel.authorize(tenant, actor, "document.document.update")?;

    let file_name = normalized_file_name(file_name)?;
    let content_type = normalized_content_type(content_type)?;
    if content.is_empty() {
        return Err(ApiError::validation(
            "document.attachment",
            vec!["An empty file cannot be attached".into()],
        ));
    }
    if content.len() > MAX_ATTACHMENT_BYTES {
        return Err(ApiError::new(
            413,
            "TOO_LARGE",
            format!(
                "Attachment exceeds {} MiB",
                MAX_ATTACHMENT_BYTES / (1024 * 1024)
            ),
        ));
    }

    let document_uuid = Uuid::parse_str(document_id)
        .map_err(|_| ApiError::not_found(format!("document.document {document_id}")))?;
    let attachment_id = Uuid::new_v4();
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let document = kernel
        .get_row(&tx, tenant, "document.document", document_id)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("document.document {document_id}")))?;
    let current_version = document
        .get("version")
        .and_then(crate::money::decimal)
        .unwrap_or(Decimal::ONE);
    let next_version = current_version
        .checked_add(Decimal::ONE)
        .filter(|version| *version > Decimal::ZERO && version.fract().is_zero())
        .and_then(|version| version.to_i32())
        .ok_or_else(|| {
            ApiError::validation(
                "document.version",
                vec!["Document version exceeds the supported range".into()],
            )
        })?;
    let url = format!(
        "/api/t/{}/documents/{}/attachments/{}",
        tenant.id, document_uuid, attachment_id
    );
    let digest = hex::encode(Sha256::digest(content));

    persistence::create_attachment(
        &tx,
        tenant,
        attachment_id,
        document_uuid,
        next_version,
        &file_name,
        &content_type,
        &digest,
        actor.user_id(),
        content,
    )
    .await?;

    let entity = kernel.ent(tenant, "document.document")?;
    let mut patch = Map::new();
    patch.insert("file_url".into(), Value::String(url.clone()));
    patch.insert("version".into(), json!(next_version));
    kernel
        .update_in(
            &tx,
            actor,
            tenant,
            &entity,
            document_id,
            patch,
            &Opts::top(),
        )
        .await?;
    tx.commit().await?;

    Ok(json!({
        "id": attachment_id,
        "documentId": document_uuid,
        "documentVersion": next_version,
        "fileName": file_name,
        "contentType": content_type,
        "sizeBytes": content.len(),
        "sha256": digest,
        "downloadUrl": url,
    }))
}

pub async fn download_attachment(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    document_id: &str,
    attachment_id: &str,
) -> R<AttachmentDownload> {
    kernel.ent(tenant, "document.document")?;
    kernel.authorize(tenant, actor, "document.document.read")?;
    kernel
        .get(actor, tenant, "document.document", document_id)
        .await?;
    let attachment_uuid = Uuid::parse_str(attachment_id)
        .map_err(|_| ApiError::not_found(format!("document attachment {attachment_id}")))?;
    let document_uuid = Uuid::parse_str(document_id)
        .map_err(|_| ApiError::not_found(format!("document.document {document_id}")))?;

    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
    let attachment = persistence::load_attachment(&tx, tenant, document_uuid, attachment_uuid)
        .await?
        .ok_or_else(|| ApiError::not_found("document attachment"))?;
    tx.commit().await?;
    Ok(attachment)
}

fn normalized_file_name(value: &str) -> R<String> {
    let name = value
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    if name.is_empty() || name.len() > 255 || name.chars().any(char::is_control) {
        return Err(ApiError::validation(
            "document.attachment.fileName",
            vec!["File name must contain 1 to 255 printable characters".into()],
        ));
    }
    Ok(name.to_owned())
}

fn normalized_content_type(value: &str) -> R<String> {
    let media_type = value.split(';').next().unwrap_or_default().trim();
    let Some((major, minor)) = media_type.split_once('/') else {
        return Err(ApiError::validation(
            "document.attachment.contentType",
            vec!["Content-Type must be a valid media type".into()],
        ));
    };
    let valid_token = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                    )
            })
    };
    if !valid_token(major) || !valid_token(minor) || minor.contains('/') {
        return Err(ApiError::validation(
            "document.attachment.contentType",
            vec!["Content-Type must be a valid media type".into()],
        ));
    }
    Ok(format!(
        "{}/{}",
        major.to_ascii_lowercase(),
        minor.to_ascii_lowercase()
    ))
}
