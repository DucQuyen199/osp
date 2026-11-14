//! Contract lifecycle bounded context.
mod application;
mod domain;
mod persistence;
pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "contract-expire",
        "Expire active contracts after their end date",
        "contract",
        "active",
        "end_date",
        "lt",
        "expired",
    )]
}
