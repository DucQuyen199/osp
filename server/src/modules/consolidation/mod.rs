//! Consent-based company-group membership across tenant RLS boundaries.
mod application;
mod domain;
mod grants;
mod matching;
mod persistence;
mod reports;
mod snapshots;

pub use domain::{validate, validate_update};
