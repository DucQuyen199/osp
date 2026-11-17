//! Pure validation helpers for company-group membership commands.

use crate::error::{ApiError, R};
use uuid::Uuid;

pub(super) fn parse_id(value: &str, resource: &'static str) -> R<Uuid> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(resource))
}
