//! Dispatches bank statement persistence checks by business workflow.

mod lines;
mod matching;
mod reconciliation;
mod statements;

use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) fn is_bank_account_code(code: &str) -> bool {
    code.strip_prefix("112")
        .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match (entity, action) {
        ("bank_statement", "created" | "updated" | "removed") => {
            statements::validate(tx, tenant, action, document).await
        }
        ("bank_statement", "reconciled") => {
            reconciliation::validate(tx, tenant, action, document).await
        }
        ("bank_statement_line", "created" | "updated" | "ignored" | "removed") => {
            lines::validate(tx, tenant, action, document).await
        }
        ("bank_statement_line", "matched") => matching::validate(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}
