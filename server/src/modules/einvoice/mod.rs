//! E-invoice issuance tracking and source-event handling.
mod application;
mod domain;
mod persistence;
mod provider;
mod worker;
pub use application::handle_source_event;
pub use domain::{prepare_action, validate_action, validate_remove, validate_update};
pub use persistence::validate_persistence;
pub use provider::{
    CancellationResult, EInvoiceProvider, HttpEInvoiceProvider, HttpEInvoiceProviderConfig,
    IssueResult,
};
pub use worker::{run_once, run_once_with_provider};

pub(crate) fn scheduled_jobs() -> Vec<crate::defs::JobSpec> {
    vec![
        crate::modules::scheduled_job_with_filter(
            "retry-transient-invoice-issue",
            "Thử lại phát hành hóa đơn điện tử có thể phục hồi",
            "einvoice",
            serde_json::json!({ "status": "failed", "operation": "issue" }),
            "retry_at",
            "lte",
            "retry_due",
        ),
        crate::modules::scheduled_job_with_filter(
            "retry-transient-invoice-cancellation",
            "Thử lại yêu cầu hủy hóa đơn điện tử có thể phục hồi",
            "einvoice",
            serde_json::json!({ "status": "failed", "operation": "cancel" }),
            "retry_at",
            "lte",
            "retry_cancellation_due",
        ),
    ]
}
