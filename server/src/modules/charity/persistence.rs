//! Tenant-scoped persistence facade for charity workflows.
mod disbursement;
mod donation;
mod program;

use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) enum PaymentSourceState {
    AlreadyPosted,
    Ready {
        amount: Decimal,
        method: String,
        expense_account: Uuid,
        party: Uuid,
    },
}

pub(super) async fn load_payment_source(
    tx: &Tx<'_>,
    tenant: &Tenant,
    disbursement_id: Uuid,
) -> R<PaymentSourceState> {
    disbursement::load_payment_source(tx, tenant, disbursement_id).await
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "program" && action == "updated" {
        return program::validate_program(tx, tenant, document).await;
    }
    if entity == "disbursement" && matches!(action, "created" | "updated" | "approved" | "paid") {
        return disbursement::validate_disbursement(tx, tenant, action, document).await;
    }
    if entity == "donation" && action == "received" {
        return donation::validate_donation_receipt(tx, tenant, document).await;
    }
    Ok(Vec::new())
}
