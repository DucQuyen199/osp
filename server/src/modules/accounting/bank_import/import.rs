use super::{camt053, csv, persistence};
use crate::{
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

pub async fn import_statement_csv(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    csv_text: &str,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let lines = csv::parse_csv(csv_text)?;
    persistence::import_lines(kernel, actor, tenant, statement_id, lines, "CSV", "CSV row").await
}

pub async fn import_statement_camt053(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    xml_text: &str,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let lines = camt053::parse(xml_text)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        lines,
        "CAMT053",
        "CAMT.053 entry",
    )
    .await
}

pub async fn import_statement_casso(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    payload: &Value,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let lines = super::casso::parse(payload)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        lines,
        "CASSO",
        "Casso transaction",
    )
    .await
}

fn authorize_import(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
) -> R<Uuid> {
    let statement_id = Uuid::parse_str(statement_id)
        .map_err(|_| ApiError::new(422, "INVALID_STATEMENT", "Invalid bank statement id"))?;
    kernel.ent(tenant, "accounting.bank_statement_line")?;
    kernel.authorize(tenant, actor, "accounting.bank_statement_line.create")?;
    Ok(statement_id)
}
