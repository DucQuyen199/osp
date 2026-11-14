//! maintenance bounded context.
mod application;
mod domain;
mod persistence;
pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "maintenance-plan-due",
        "Create a maintenance request when an active plan is due",
        "maintenance_plan",
        "active",
        "next_due",
        "lte",
        "due",
    )]
}
