//! Base-unit compatibility checks for product and alternate units.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_unit_base(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let unit_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let base_id = document
        .get("base_uom")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if let Some(base_id) = base_id {
        if unit_id == Some(base_id) {
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
            Some(false) => {
                errors.push("An alternate unit must convert directly to a base unit".into())
            }
            None => errors.push("Base unit must belong to this tenant".into()),
        }
    }
    validate_immutable_conversion(tx, tenant, action, unit_id, base_id, document, errors).await?;
    Ok(())
}

async fn validate_immutable_conversion(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    unit_id: Option<Uuid>,
    new_base: Option<Uuid>,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let Some(unit_id) = unit_id else {
        return Ok(());
    };
    let current = tx
        .query_opt(
            "SELECT base_uom, ratio::text FROM master_data__uom WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &unit_id],
        )
        .await?;
    let Some(current) = current else {
        return Ok(());
    };
    let current_base: Option<Uuid> = current.get(0);
    let current_ratio: Option<String> = current.get(1);
    let next_ratio = document.get("ratio").and_then(money::decimal);
    let current_ratio = current_ratio.as_deref().and_then(money::decimal_str);
    let conversion_changed =
        action == "removed" || current_base != new_base || current_ratio != next_ratio;
    if !conversion_changed {
        return Ok(());
    }
    let used_by_product = tx
        .query_opt(
            "SELECT 1 FROM master_data__product WHERE tenant_id = $1 AND uom = $2 \
             UNION ALL SELECT 1 FROM master_data__uom WHERE tenant_id = $1 AND id <> $2 AND base_uom = $2 LIMIT 1",
            &[&tenant.id, &unit_id],
        )
        .await?
        .is_some();
    let mut used_by_document = false;
    for table in [
        "sales__quotation",
        "sales__sales_order",
        "sales__sales_return",
        "purchasing__rfq",
        "purchasing__purchase_order",
        "purchasing__purchase_receipt",
        "purchasing__purchase_return",
        "purchasing__supplier_invoice",
    ] {
        let query = format!(
            "SELECT 1 FROM {table} document CROSS JOIN LATERAL jsonb_array_elements(COALESCE(document.lines, '[]'::jsonb)) line WHERE document.tenant_id = $1 AND line->>'uom' = $2 LIMIT 1"
        );
        if tx
            .query_opt(&query, &[&tenant.id, &unit_id.to_string()])
            .await?
            .is_some()
        {
            used_by_document = true;
            break;
        }
    }
    if tx
        .query_opt(
            "SELECT 1 FROM restaurant__recipe recipe CROSS JOIN LATERAL jsonb_array_elements(COALESCE(recipe.ingredients, '[]'::jsonb)) ingredient WHERE recipe.tenant_id = $1 AND ingredient->>'uom' = $2 LIMIT 1",
            &[&tenant.id, &unit_id.to_string()],
        )
        .await?
        .is_some()
    {
        used_by_document = true;
    }
    if used_by_product || used_by_document {
        errors.push(
            "A unit conversion cannot be changed or removed while products or documents use it; create a new unit instead".into(),
        );
    }
    Ok(())
}

pub async fn validate_product_unit(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    let unit_id = document
        .get("uom")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if let Some(unit_id) = unit_id {
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
    }
    let Some(product_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(());
    };
    let previous = tx
        .query_opt(
            "SELECT uom FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &product_id],
        )
        .await?
        .and_then(|row| row.get::<_, Option<Uuid>>(0));
    if previous == unit_id {
        return Ok(());
    }
    let has_stock_history = tx
        .query_opt(
            "SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND product = $2 LIMIT 1",
            &[&tenant.id, &product_id],
        )
        .await?
        .is_some();
    let mut used_by_document = false;
    for table in [
        "sales__quotation",
        "sales__sales_order",
        "sales__sales_return",
        "purchasing__rfq",
        "purchasing__purchase_order",
        "purchasing__purchase_receipt",
        "purchasing__purchase_return",
        "purchasing__supplier_invoice",
    ] {
        let query = format!(
            "SELECT 1 FROM {table} document CROSS JOIN LATERAL jsonb_array_elements(COALESCE(document.lines, '[]'::jsonb)) line WHERE document.tenant_id = $1 AND line->>'product' = $2 LIMIT 1"
        );
        if tx
            .query_opt(&query, &[&tenant.id, &product_id.to_string()])
            .await?
            .is_some()
        {
            used_by_document = true;
            break;
        }
    }
    if tx
        .query_opt(
            "SELECT 1 FROM restaurant__recipe recipe WHERE recipe.tenant_id = $1 AND (recipe.product::text = $2 OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(recipe.ingredients, '[]'::jsonb)) ingredient WHERE ingredient->>'product' = $2)) LIMIT 1",
            &[&tenant.id, &product_id.to_string()],
        )
        .await?
        .is_some()
    {
        used_by_document = true;
    }
    if has_stock_history || used_by_document {
        errors.push(
            "Product inventory unit cannot change while stock movements or business documents use the product".into(),
        );
    }
    Ok(())
}
