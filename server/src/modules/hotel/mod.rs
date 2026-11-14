//! Hotel bounded context for folio totals and room state transitions.
mod application;
mod domain;
mod persistence;

pub use application::handle_source_event;
pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
