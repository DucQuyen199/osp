//! Events bounded context: capacity-controlled ticket sales and check-in.
mod application;
mod domain;
mod persistence;

pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "ticket-reservation-expire",
        "Release reserved event tickets after the configured hold period",
        "ticket",
        "reserved",
        "reservation_expires_at",
        "lte",
        "cancelled",
    )]
}
