//! Tenant-scoped checks and concurrency control for dated currency quotes.
use super::parse_id;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let Some(from_currency) = parse_id(document, "from_currency") else {
        if document
            .get("from_currency")
            .is_some_and(|value| !value.is_null())
        {
            errors.push("Source currency must be a valid currency in this company".into());
        }
        return Ok(errors);
    };
    let Some(to_currency) = parse_id(document, "to_currency") else {
        if document
            .get("to_currency")
            .is_some_and(|value| !value.is_null())
        {
            errors.push("Target currency must be a valid currency in this company".into());
        }
        return Ok(errors);
    };
    if from_currency == to_currency {
        errors.push("Source and target currencies must be different".into());
        return Ok(errors);
    }
    for (label, currency_id) in [("Source", from_currency), ("Target", to_currency)] {
        if tx
            .query_opt(
                "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &currency_id],
            )
            .await?
            .is_none()
        {
            errors.push(format!("{label} currency does not belong to this company"));
        }
    }
    let Some(effective_date) = document
        .get("effective_date")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Ok(errors);
    };
    let lock_key = format!(
        "{}:currency-rate:{from_currency}:{to_currency}:{effective_date}",
        tenant.id
    );
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let current_id = parse_id(document, "id");
    if tx
        .query_opt(
            "SELECT id FROM master_data__currency_rate WHERE tenant_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date = $4::date AND ($5::uuid IS NULL OR id <> $5) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &from_currency, &to_currency, &effective_date, &current_id],
        )
        .await?
        .is_some()
    {
        errors.push("A rate for this currency pair and effective date already exists".into());
    }
    Ok(errors)
}
