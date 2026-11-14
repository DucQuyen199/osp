//! Stable application facade for sales business workflows.
mod documents;
mod fulfillment;
mod pricing;

pub use documents::{prepare_document, preview_document};
pub use fulfillment::handle_source_event;
pub(super) use fulfillment::{all_order_quantities_delivered, has_delivered_order_quantities};
pub use pricing::recalculate_lines;
