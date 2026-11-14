//! Employee expense bounded context.
mod application;
mod domain;
mod persistence;
pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
