//! Retail pharmacy prescription verification and dispensing rules.
mod application;
mod domain;
mod persistence;

pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
