//! Helpdesk bounded context: ticket lifecycle and SLA policy invariants.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::{handle_source_event, prepare_document};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
