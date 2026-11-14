//! Tenant-scoped uniqueness checks for master data codes and names.
use super::parse_id;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_unique(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    field: &str,
    value: &str,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some((table, column, label)) = unique_column(entity, field) else {
        return Ok(());
    };
    let lock_key = format!(
        "{}:{entity}:{field}:{}",
        tenant.id,
        value.trim().to_ascii_lowercase()
    );
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let current_id = parse_id(document, "id");
    let sql = format!(
        "SELECT id FROM {table} WHERE tenant_id = $1 AND lower(btrim({column})) = lower(btrim($2)) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE"
    );
    if tx
        .query_opt(&sql, &[&tenant.id, &value.trim(), &current_id])
        .await?
        .is_some()
    {
        errors.push(format!("{label} must be unique within the company"));
    }
    Ok(())
}

fn unique_column(entity: &str, field: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match (entity, field) {
        ("party", "tax_code") => Some(("master_data__party", "tax_code", "Tax code")),
        ("product", "sku") => Some(("master_data__product", "sku", "SKU")),
        ("branch", "code") => Some(("master_data__branch", "code", "Branch code")),
        ("currency", "code") => Some(("master_data__currency", "code", "Currency code")),
        ("uom", "name") => Some(("master_data__uom", "name", "Unit name")),
        ("product_category", "name") => Some((
            "master_data__product_category",
            "name",
            "Product category name",
        )),
        ("tax", "name") => Some(("master_data__tax", "name", "Tax name")),
        _ => None,
    }
}
