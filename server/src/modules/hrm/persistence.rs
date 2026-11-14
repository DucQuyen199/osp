//! Stable HRM persistence facade for tenant-scoped workflow checks.
mod attendance;
mod employees;
mod leave;
mod organization;
mod schedule;

use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "attendance" => attendance::validate(tx, tenant, entity, action, document).await,
        "employee" | "salary_revision" => {
            employees::validate(tx, tenant, entity, action, document).await
        }
        "leave_allocation" | "leave_request" => {
            leave::validate(tx, tenant, entity, action, document).await
        }
        "department" | "holiday" => {
            organization::validate(tx, tenant, entity, action, document).await
        }
        "work_schedule_entry" | "work_schedule_pattern" => {
            schedule::validate(tx, tenant, entity, action, document).await
        }
        _ => Ok(Vec::new()),
    }
}
