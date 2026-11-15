//! Marketing bounded context: campaigns, audience segments, and reusable content.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::validate_persistence;
