//! Real-estate bounded context facade.
mod application;
mod domain;
mod persistence;

pub use application::handle_source_event;
pub use domain::{validate, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![
        crate::modules::scheduled_job(
            "lease-rent-due",
            "Generate rent invoices for active leases",
            "lease",
            "active",
            "next_rent_date",
            "lt",
            "rent_due",
        ),
        crate::modules::scheduled_job(
            "lease-expire",
            "Terminate active leases after all in-term rent dates are billed",
            "lease",
            "active",
            "end_date",
            "lt",
            "terminated",
        ),
        crate::modules::scheduled_job(
            "reservation-expire",
            "Release held properties after reservation expiry",
            "reservation",
            "reserved",
            "expires_on",
            "lte",
            "expired",
        ),
    ]
}
