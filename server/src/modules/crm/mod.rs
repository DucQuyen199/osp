//! CRM bounded context for lead qualification and opportunity conversion.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
