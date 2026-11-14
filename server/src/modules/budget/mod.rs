//! Budget bounded context: planning, approval, and ledger-derived actuals.
mod application;
mod domain;
mod persistence;
mod reports;

pub use application::{handle_source_event, refresh_actuals, validate_journal_posting};
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
