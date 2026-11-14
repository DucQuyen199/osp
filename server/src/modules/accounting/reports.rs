use crate::{
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};

#[path = "reports/balances.rs"]
mod balances;
#[path = "reports/common.rs"]
mod common;
#[path = "reports/fx_revaluation.rs"]
mod fx_revaluation;
#[path = "reports/operations.rs"]
mod operations;
#[path = "reports/tax.rs"]
mod tax;

impl Kernel {
    pub(super) fn ensure_accounting_read(&self, tenant: &Tenant, actor: &Actor) -> R<()> {
        if !tenant.has_module("accounting") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module kế toán chưa được bật cho doanh nghiệp",
            ));
        }
        self.authorize(tenant, actor, "accounting.journal_entry.read")
    }
}
