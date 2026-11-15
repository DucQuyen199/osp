//! Lending bounded context: loan lifecycle, amortization, and repayment policy.
mod application;
mod domain;
mod persistence;

pub use application::handle_source_event;
pub use domain::{
    due_dates_from_first, installment_amounts, installment_components, validate, validate_action,
    validate_action_at, validate_remove, validate_update,
};
pub use persistence::validate_persistence;

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![crate::modules::scheduled_job(
        "mark-repayments-overdue",
        "Mark due repayments as overdue after their due date",
        "repayment",
        "due",
        "due_date",
        "lt",
        "overdue",
    )]
}
