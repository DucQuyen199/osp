//! Purchasing bounded context: supplier sourcing, requisitions, orders and returns.
mod application;
mod domain;
mod persistence;

pub use application::{
    create_order_from_requisition, create_order_from_rfq, handle_source_event, prepare_document,
    preview_document,
};
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::validate_persistence;
