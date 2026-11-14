//! Inventory bounded context: stock movements, counts and warehouse transfers.
//!
//! Domain policy stays pure; transactional valuation and persistence checks run
//! inside the kernel-owned PostgreSQL transaction.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::{
    apply_landed_costs, apply_stock_move, handle_source_stock_event,
    handle_transfer_or_count_event, prepare_stock_count, prepare_stock_move, prepare_tracked_lines,
    validate_expiry_writeoff_quality_holds,
};
pub use domain::{
    validate, validate_action, validate_remove, validate_source_action, validate_update,
};
pub use persistence::{validate_persistence, validate_source_persistence};
