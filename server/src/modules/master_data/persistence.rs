//! Tenant-scoped master-data uniqueness, references, and credit checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

mod category_tree;
mod credit_limit;
mod currency_rates;
mod product;
mod unique;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match entity {
        "party" => {
            if matches!(action, "created" | "updated") {
                if let Some(tax_code) = non_empty(document, "tax_code") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        "party",
                        "tax_code",
                        tax_code,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
            credit_limit::validate_credit_limit(tx, tenant, action, document, &mut errors).await?;
        }
        "product" => {
            if matches!(action, "created" | "updated") {
                if let Some(sku) = non_empty(document, "sku") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        "product",
                        "sku",
                        sku,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
            if action == "updated" && tenant.has_module("inventory") {
                product::validate_lot_tracking_change(tx, tenant, document, &mut errors).await?;
            }
        }
        "branch" => {
            if matches!(action, "created" | "updated") {
                if let Some(code) = non_empty(document, "code") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        "branch",
                        "code",
                        code,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
        }
        "currency" => {
            if matches!(action, "created" | "updated") {
                if let Some(code) = non_empty(document, "code") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        "currency",
                        "code",
                        code,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
        }
        "currency_rate" if matches!(action, "created" | "updated") => {
            errors.extend(currency_rates::validate(tx, tenant, document).await?);
        }
        "uom" | "tax" => {
            if matches!(action, "created" | "updated") {
                if let Some(name) = non_empty(document, "name") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        entity,
                        "name",
                        name,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
        }
        "product_category" => {
            if matches!(action, "created" | "updated") {
                if let Some(name) = non_empty(document, "name") {
                    unique::validate_unique(
                        tx,
                        tenant,
                        entity,
                        "name",
                        name,
                        document,
                        &mut errors,
                    )
                    .await?;
                }
            }
            if action != "removed" {
                category_tree::validate_category_parent(tx, tenant, document, &mut errors).await?;
            }
        }
        _ => {}
    }
    Ok(errors)
}

fn non_empty<'a>(document: &'a Value, field: &str) -> Option<&'a str> {
    document
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
