//! Tenant-scoped persistence policies for construction records.
mod boq;
mod claim;
mod material_request;
mod site;
mod subcontract;

use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "boq" => boq::validate_boq(tx, tenant, action, document).await,
        "site" => site::validate_site(tx, tenant, action, document).await,
        "subcontract" => subcontract::validate_subcontract(tx, tenant, action, document).await,
        "progress_claim" => claim::validate_claim(tx, tenant, action, document).await,
        "site_diary" => site::validate_diary(tx, tenant, action, document).await,
        "material_request" => {
            material_request::validate_material_request(tx, tenant, action, document).await
        }
        _ => Ok(Vec::new()),
    }
}

async fn project_row(
    tx: &Tx<'_>,
    tenant: &Tenant,
    project: Uuid,
) -> R<Option<(String, Option<Decimal>)>> {
    let Some(row) = tx.query_opt(
        "SELECT status, budget::text FROM project__project WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &project],
    ).await? else {
        return Ok(None);
    };
    let status = row.get(0);
    let budget_text: Option<String> = row.get(1);
    let budget = budget_text
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                ApiError::validation(
                    "construction.project.budget",
                    vec!["Project budget is not a valid decimal value".into()],
                )
            })
        })
        .transpose()?;
    Ok(Some((status, budget)))
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
