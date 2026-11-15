//! Document bounded context: folders, versioned document records, and signature requests.
mod application;
mod domain;
mod persistence;

pub use application::{
    AttachmentDownload, AttachmentMetadata, download_attachment, list_attachments,
    prepare_document, prepare_signature_request, upload_attachment,
};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
