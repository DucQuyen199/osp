//! Subscription bounded context with domain, application, and persistence layers.
mod application;
mod domain;
mod persistence;

pub use application::{handle_source_event, prepare_document};
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "billing-due",
        "Create an invoice when a billing cycle is due",
        "billing_cycle",
        "pending",
        "due_date",
        "lte",
        "due",
    )]
}
