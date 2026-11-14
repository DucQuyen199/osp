//! Payment validation facade; each source and invariant has a focused module.
mod defaults;
mod invoices;
mod refunds;
mod shared;
mod sources;

use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_payment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = invoices::validate(tx, tenant, document).await?;
    errors.extend(refunds::validate(tx, tenant, document).await?);
    errors.extend(defaults::validate(tx, tenant, document).await?);
    errors.extend(sources::validate(tx, tenant, document).await?);
    Ok(errors)
}
