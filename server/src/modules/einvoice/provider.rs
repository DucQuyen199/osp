//! Provider contract for real e-invoice integrations.
//!
//! Provider implementations must report success only after the remote service
//! accepts the request. The core workflow does not fabricate provider numbers
//! or turn a queued request into an issued document.
use crate::error::R;
use futures::future::BoxFuture;
use serde_json::Value;

mod http;
pub use http::{HttpEInvoiceProvider, HttpEInvoiceProviderConfig};

#[derive(Debug, Clone)]
pub struct IssueResult {
    pub provider_reference: Option<String>,
    pub serial: Option<String>,
    pub number: String,
    pub lookup_code: Option<String>,
    pub response: Value,
}

#[derive(Debug, Clone)]
pub struct CancellationResult {
    pub provider_reference: Option<String>,
    pub response: Value,
}

/// Adapter boundary for vendors such as VNPT, Viettel, or MISA.
/// Adapters should use `EINVOICE_PROVIDER_UNAVAILABLE` or
/// `EINVOICE_PROVIDER_TEMPORARY` for transport, rate-limit, and server errors
/// so the worker can retry them safely with the request idempotency key.
pub trait EInvoiceProvider: Send + Sync {
    fn code(&self) -> &str;

    fn issue<'a>(&'a self, tenant_id: &'a str, request: &'a Value)
    -> BoxFuture<'a, R<IssueResult>>;

    fn cancel<'a>(
        &'a self,
        tenant_id: &'a str,
        provider_reference: &'a str,
        reason: &'a str,
    ) -> BoxFuture<'a, R<CancellationResult>>;
}
