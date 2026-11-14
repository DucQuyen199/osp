//! Learning Management System bounded context: courses, lessons, and learner progress.
mod application;
mod domain;
mod persistence;

pub use application::{handle_source_event, prepare_document};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
