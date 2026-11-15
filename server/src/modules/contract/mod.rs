//! Contract lifecycle bounded context.
mod application;
mod domain;
mod persistence;
pub use application::{handle_source_event, prepare_amendment};
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![
        crate::modules::scheduled_job(
            "contract-amendment-apply",
            "Apply approved contract amendments on their effective date",
            "amendment",
            "approved",
            "effective_date",
            "lte",
            "applied",
        ),
        crate::modules::scheduled_job(
            "contract-expire",
            "Expire active contracts after their end date",
            "contract",
            "active",
            "end_date",
            "lt",
            "expired",
        ),
    ]
}
