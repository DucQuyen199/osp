//! Point-of-sale bounded context.
mod application;
mod domain;
mod persistence;
pub use application::{prepare_action, prepare_document, prepare_return_document};
pub use domain::{
    validate, validate_action, validate_cash_movement_action, validate_cash_movement_remove,
    validate_cash_movement_update, validate_remove, validate_return_remove, validate_return_update,
    validate_session_close, validate_session_update, validate_update,
};
pub use persistence::validate_persistence;
