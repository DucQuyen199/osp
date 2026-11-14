//! Business Intelligence bounded context: dashboards, safe saved reports, and KPIs.
mod application;
mod domain;
mod persistence;
mod scheduled;

pub use application::{AggregateSpec, aggregate_spec, prepare_document, report_query};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
pub use scheduled::handle_source_event;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "report-snapshot",
        "Save a scheduled report snapshot",
        "report",
        "scheduled",
        "next_run_at",
        "lte",
        "run_due",
    )]
}
