//! Normalize document metadata and establish its initial version.
mod attachments;

pub use attachments::{
    AttachmentDownload, AttachmentMetadata, download_attachment, list_attachments,
    upload_attachment,
};

use serde_json::{Map, Value};

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
