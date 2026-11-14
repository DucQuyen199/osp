//! Tenant-scoped donor and program references for donation receipt.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate_donation_receipt(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let donor = document
        .get("donor")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    match donor {
        Some(donor)
            if tx
                .query_opt(
                    "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &donor],
                )
                .await?
                .is_some() => {}
        _ => errors.push("Người quyên góp không tồn tại trong doanh nghiệp".into()),
    }
    if let Some(program) = document
        .get("program")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        && tx
            .query_opt(
                "SELECT id FROM charity__program WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &program],
            )
            .await?
            .is_none()
    {
        errors.push("Chương trình quyên góp không tồn tại trong doanh nghiệp".into());
    }
    Ok(errors)
}
