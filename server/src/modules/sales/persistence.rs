//! Stable persistence facade for sales cross-record and concurrency rules.
mod orders;
mod price_lists;
mod returns;

use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "sales_order" => orders::validate(tx, tenant, entity, action, document).await,
        "price_list" => price_lists::validate(tx, tenant, entity, action, document).await,
        "sales_return" => returns::validate(tx, tenant, entity, action, document).await,
        _ => Ok(Vec::new()),
    }
}

pub(super) fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "sales.persistence",
            vec![format!(
                "Stored sales {field} is not a valid decimal amount"
            )],
        )
    })
}
