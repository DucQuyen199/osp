//! Loyalty bounded context for point accrual and reversal.
mod application;
mod domain;
mod persistence;
mod voucher;

pub use application::handle_source_event;
pub use domain::{validate, validate_at, validate_remove, validate_update};
pub use persistence::validate_persistence;
pub use voucher::{apply_to_order as apply_voucher_to_order, prepare_document, redeem_for_order};
