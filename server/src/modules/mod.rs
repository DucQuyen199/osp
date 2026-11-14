//! Rust-owned business invariants, grouped by bounded context.
//!
//! Module metadata remains loadable from the registry while business rules that
//! must never be bypassed live here and are enforced inside PostgreSQL writes.

pub mod accounting;
pub mod agriculture;
pub mod asset;
pub mod auto_service;
pub mod bi;
pub mod booking;
pub mod budget;
pub mod case_management;
pub mod charity;
pub mod clinic;
pub mod communication;
pub mod construction;
pub mod contract;
pub mod crm;
pub mod document;
pub mod ecommerce;
pub mod einvoice;
pub mod event_management;
pub mod expense;
pub mod field_service;
pub mod helpdesk;
pub mod hotel;
pub mod hrm;
pub mod insurance;
pub mod integration_hub;
pub mod inventory;
pub mod lending;
pub mod lms;
pub mod logistics;
pub mod loyalty;
pub mod maintenance;
pub mod manufacturing;
pub mod marketing;
pub mod master_data;
pub mod payments;
pub mod payroll;
pub mod performance;
pub mod pharmacy;
pub mod pos;
pub mod project;
pub mod purchasing;
pub mod quality;
pub mod real_estate;
pub mod recruitment;
pub mod restaurant;
pub mod sales;
pub mod school;
pub mod subscription;
pub mod utilities;
pub mod workflow_approval;

mod events;

pub(crate) fn scheduled_job(
    id: &str,
    label: &str,
    entity: &str,
    status: &str,
    due_field: &str,
    due_op: &str,
    action: &str,
) -> crate::defs::JobSpec {
    crate::defs::JobSpec {
        id: id.into(),
        label: label.into(),
        entity: entity.into(),
        where_: Some(serde_json::json!({ "status": status })),
        due: crate::defs::JobDue {
            field: due_field.into(),
            op: due_op.into(),
        },
        action: action.into(),
    }
}

pub(crate) fn scheduled_jobs(module: &str) -> Vec<crate::defs::JobSpec> {
    match module {
        "communication" => communication::scheduled_jobs(),
        "booking" => booking::scheduled_jobs(),
        "contract" => contract::scheduled_jobs(),
        "events" => event_management::scheduled_jobs(),
        "insurance" => insurance::scheduled_jobs(),
        "lending" => lending::scheduled_jobs(),
        "maintenance" => maintenance::scheduled_jobs(),
        "real-estate" => real_estate::scheduled_jobs(),
        "sales" => sales::scheduled_jobs(),
        "subscription" => subscription::scheduled_jobs(),
        _ => Vec::new(),
    }
}

pub(crate) async fn dispatch_source_events(
    kernel: &crate::kernel::Kernel,
    tx: &crate::db::Tx<'_>,
    tenant: &crate::kernel::Tenant,
    event: &crate::kernel::rules::Event,
    handled: &mut Vec<serde_json::Value>,
) -> crate::error::R<()> {
    events::dispatch_source_events(kernel, tx, tenant, event, handled).await
}

mod validation;
pub use validation::{
    validate_action, validate_document, validate_persistence, validate_remove, validate_update,
};
