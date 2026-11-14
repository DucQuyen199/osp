//! Booking bounded context: scheduling, service defaults, and resource safety.
mod application;
mod domain;
mod persistence;

pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "booking-no-show",
        "Mark confirmed appointments as no-show after their end time",
        "booking",
        "confirmed",
        "ends_at",
        "lte",
        "no_show",
    )]
}
