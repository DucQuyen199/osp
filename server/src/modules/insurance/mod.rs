//! Insurance bounded context: policy coverage and claim settlement controls.
mod application;
mod domain;
mod persistence;

pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "policy-lapse",
        "Lapse active insurance policies after their end date",
        "policy",
        "active",
        "end_date",
        "lt",
        "lapsed",
    )]
}
