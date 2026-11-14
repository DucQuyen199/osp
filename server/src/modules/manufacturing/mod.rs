//! Manufacturing bounded context: BOM and production orders.
mod application;
mod domain;
mod persistence;
mod reports;
pub use application::{prepare_bom, prepare_completion};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
