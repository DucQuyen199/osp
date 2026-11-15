//! hrm bounded context.
mod application;
mod domain;
mod persistence;
pub(super) const MAX_ROTATION_DAYS: i64 = 3_653;
pub(super) const MAX_GENERATED_SCHEDULE_ROWS: i64 = 40_000;
pub use application::prepare_document;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
