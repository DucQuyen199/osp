//! Tenant-scoped product category reference and cycle validation.
use super::parse_id;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_category_parent(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(parent) = parse_id(document, "parent") else {
        if document.get("parent").is_some_and(|value| !value.is_null()) {
            errors.push("Product category parent must be a valid category".into());
        }
        return Ok(());
    };
    let Some(id) = parse_id(document, "id") else {
        // Serialize child creation against reparenting of any category in this
        // tenant. A concurrent child insert must not create a cycle invisible
        // to the reparenting transaction's ancestor query.
        tx.query_one_row(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("{}:master-data:product-category-tree", tenant.id)],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM master_data__product_category WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &parent],
            )
            .await?
            .is_none()
        {
            errors.push("Product category parent does not exist in this company".into());
        }
        return Ok(());
    };
    if id == parent {
        errors.push("A product category cannot be its own parent".into());
        return Ok(());
    }
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("{}:master-data:product-category-tree", tenant.id)],
    )
    .await?;
    let parent_exists = tx
        .query_opt(
            "SELECT id FROM master_data__product_category WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &parent],
        )
        .await?
        .is_some();
    if !parent_exists {
        errors.push("Product category parent does not exist in this company".into());
        return Ok(());
    }
    let creates_cycle: bool = tx
        .query_one_row(
            "WITH RECURSIVE ancestors(id, parent) AS (SELECT id, parent FROM master_data__product_category WHERE tenant_id = $1 AND id = $2 UNION ALL SELECT category.id, category.parent FROM master_data__product_category category JOIN ancestors ON category.id = ancestors.parent WHERE category.tenant_id = $1) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $3)",
            &[
                &tenant.id as &(dyn tokio_postgres::types::ToSql + Sync),
                &parent,
                &id,
            ],
        )
        .await?
        .get(0);
    if creates_cycle {
        errors.push("Product category hierarchy cannot contain a cycle".into());
    }
    Ok(())
}
