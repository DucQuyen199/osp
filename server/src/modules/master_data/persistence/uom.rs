//! Base-unit compatibility checks for product and alternate units.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_unit_base(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(base_id) = document
        .get("base_uom")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(());
    };
    if document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        == Some(base_id)
    {
        errors.push("A unit cannot be its own base unit".into());
        return Ok(());
    }
    let is_base = tx
        .query_opt(
            "SELECT base_uom IS NULL FROM master_data__uom WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &base_id],
        )
        .await?
        .map(|row| row.get::<_, bool>(0));
    match is_base {
        Some(true) => {}
        Some(false) => errors.push("An alternate unit must convert directly to a base unit".into()),
        None => errors.push("Base unit must belong to this tenant".into()),
    }
    Ok(())
}

pub async fn validate_product_unit(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(unit_id) = document
        .get("uom")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(());
    };
    let is_base = tx
        .query_opt(
            "SELECT base_uom IS NULL FROM master_data__uom WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &unit_id],
        )
        .await?
        .map(|row| row.get::<_, bool>(0));
    match is_base {
        Some(true) => {}
        Some(false) => errors.push("Product inventory unit must be a base unit".into()),
        None => errors.push("Product inventory unit must belong to this tenant".into()),
    }
    Ok(())
}
