//! Fixed-asset bounded context split into domain, application, and persistence layers.
mod application;
mod domain;
mod persistence;
mod reports;
pub use application::{handle_source_event, prepare_asset_document, prepare_depreciation};
pub use domain::{
    initial_accumulated_depreciation, validate, validate_action, validate_remove, validate_update,
};
pub use persistence::validate_persistence;
