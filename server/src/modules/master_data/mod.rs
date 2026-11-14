//! Master-data bounded context shared by business modules.
mod application;
mod domain;
mod persistence;
pub mod unit_conversion;
pub use application::prepare_document;
pub use domain::validate;
pub use persistence::validate_persistence;
