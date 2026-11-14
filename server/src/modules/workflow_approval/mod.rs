//! Workflow approval bounded context for request creation and decision routing.
mod application;
mod domain;
mod persistence;

pub use application::authorize_decision;
pub use application::handle_source_event;
pub use domain::validate;
pub use persistence::validate_persistence;
