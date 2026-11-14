//! Retail pharmacy prescription verification and dispensing rules.
mod domain;
mod persistence;

pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
