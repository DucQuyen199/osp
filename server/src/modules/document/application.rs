//! Normalize document metadata and establish its initial version.
mod attachments;

pub use attachments::{
    AttachmentDownload, AttachmentMetadata, download_attachment, list_attachments,
    upload_attachment,
};

use serde_json::{Map, Value};

pub async fn prepare_signature_request(
    tx: &crate::db::Tx<'_>,
    tenant: &crate::kernel::Tenant,
    document: &mut Map<String, Value>,
) -> crate::error::R<Vec<String>> {
    let Some(document_id) = document
        .get("document")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Signature request requires a valid document".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT file_url, COALESCE(version, 1)::text FROM document__document WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &document_id],
        )
        .await?
    else {
        return Ok(vec!["Signature document does not exist in this tenant".into()]);
    };
    let file_url: Option<String> = row.get(0);
    if file_url.as_deref().is_none_or(str::is_empty) {
        return Ok(vec![
            "A document must have a file URL before requesting a signature".into(),
        ]);
    }
    let version = row
        .get::<_, String>(1)
        .parse::<i64>()
        .ok()
        .filter(|version| *version > 0)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "document.document.version",
                vec!["Document version is invalid".into()],
            )
        })?;
    document.insert("document_version".into(), Value::from(version));
    Ok(Vec::new())
}

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let fields: &[&str] = match entity {
        "folder" => &["name", "parent"],
        "document" => &["title", "file_url", "owner"],
        "signature_request" => &["signer_email", "signer_name"],
        _ => &[],
    };
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() && matches!(*field, "name" | "title" | "signer_email") {
                errors.push(format!("{field} cannot be empty"));
            }
        }
    }
    if entity == "document" && !document.contains_key("version") {
        document.insert("version".into(), Value::from(1));
    }
    errors
}
