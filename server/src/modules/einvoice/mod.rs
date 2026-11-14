//! E-invoice issuance tracking and source-event handling.
mod application;
mod domain;
mod persistence;
mod provider;
mod worker;
pub use application::handle_source_event;
pub use domain::{prepare_action, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
pub use provider::{
    CancellationResult, EInvoiceProvider, HttpEInvoiceProvider, HttpEInvoiceProviderConfig,
    IssueResult,
};
pub use worker::{run_once, run_once_with_provider};
