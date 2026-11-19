//! Logistics bounded context: shipments, fleet, and delivery.
mod application;
mod carrier_webhook;
mod domain;
mod persistence;
mod reports;
pub use application::{handle_source_event, prepare_fleet_record, prepare_shipment};
pub use carrier_webhook::receive_tracking_webhook;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
