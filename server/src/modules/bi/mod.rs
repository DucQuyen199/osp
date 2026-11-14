//! Business Intelligence bounded context: dashboards, safe saved reports, and KPIs.
mod application;
mod domain;
mod persistence;

pub use application::{AggregateSpec, aggregate_spec, prepare_document, report_query};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
