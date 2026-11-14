//! Purchasing use-case facade; workflow implementations live in focused submodules.
mod documents;
mod sourcing;

pub use documents::{prepare_document, preview_document};
pub use sourcing::{create_order_from_requisition, create_order_from_rfq, handle_source_event};
