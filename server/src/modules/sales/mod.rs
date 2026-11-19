//! Sales bounded context. Separate pure commercial policy from preparation and SQL checks.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::{handle_source_event, prepare_document, preview_document, recalculate_lines};
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "quotation-expire",
        "Expire sent sales quotations after their validity date",
        "quotation",
        "sent",
        "valid_until",
        "lt",
        "expired",
    )]
}
