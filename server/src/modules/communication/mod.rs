//! Communication bounded context for transactional notification queue entries.
mod application;
mod domain;
mod persistence;
mod worker;

pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
pub use worker::run_once;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "reminder-send",
        "Queue a reminder when its scheduled time arrives",
        "reminder",
        "pending",
        "send_at",
        "lte",
        "queued",
    )]
}
