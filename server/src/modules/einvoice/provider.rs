//! Provider contract for real e-invoice integrations.
//!
//! Provider implementations must report success only after the remote service
//! accepts the request. The core workflow does not fabricate provider numbers
//! or turn a queued request into an issued document.
use crate::error::R;
use futures::future::BoxFuture;
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};

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

/// Explicit registry of available adapters. Provider credentials stay inside
/// provider instances or external secret managers; a tenant stores only the
/// adapter code used when an issuance request is queued.
#[derive(Clone, Default)]
pub struct EInvoiceProviderRegistry {
    providers: BTreeMap<String, Arc<dyn EInvoiceProvider>>,
    default_code: Option<String>,
}

impl EInvoiceProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, provider: Arc<dyn EInvoiceProvider>) -> R<()> {
        let code = provider.code().trim().to_ascii_lowercase();
        if code.is_empty()
            || code.len() > 64
            || !code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(crate::error::ApiError::new(
                500,
                "EINVOICE_CONFIG",
                "E-invoice adapter codes must use lowercase letters, digits, or hyphens",
            ));
        }
        if self.providers.contains_key(&code) {
            return Err(crate::error::ApiError::new(
                500,
                "EINVOICE_CONFIG",
                format!("E-invoice adapter '{code}' is registered more than once"),
            ));
        }
        self.providers.insert(code, provider);
        Ok(())
    }

    pub fn set_default(&mut self, code: &str) -> R<()> {
        let code = code.trim().to_ascii_lowercase();
        if !self.providers.contains_key(&code) {
            return Err(crate::error::ApiError::new(
                500,
                "EINVOICE_CONFIG",
                format!("Default e-invoice adapter '{code}' is not registered"),
            ));
        }
        self.default_code = Some(code);
        Ok(())
    }

    pub fn default_code(&self) -> Option<&str> {
        self.default_code.as_deref()
    }

    pub fn get(&self, code: &str) -> Option<&dyn EInvoiceProvider> {
        self.providers
            .get(&code.trim().to_ascii_lowercase())
            .map(Arc::as_ref)
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}
