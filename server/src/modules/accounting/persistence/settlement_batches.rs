use super::database_amount;
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

fn decimal(document: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(document.get(field)?)
}

fn tolerance() -> Decimal {
    Decimal::new(5, 3)
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "submitted" | "approved") {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    let direction = document
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let receipt = direction == "receipt";
    let (document_field, other_field, table, party_field, note_table, note_field) = if receipt {
        (
            "invoice",
            "bill",
            "accounting__invoice",
            "party",
            "accounting__credit_note",
            "invoice",
        )
    } else {
        (
            "bill",
            "invoice",
            "accounting__bill",
            "supplier",
            "accounting__debit_note",
            "bill",
        )
    };
    let party = document
        .get("party")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let currency = document
        .get("currency")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let total = decimal(document, "amount").unwrap_or(Decimal::ZERO);
    let allocations = document.get("allocations").and_then(Value::as_array);
    let (Some(party), Some(currency), Some(allocations)) = (party, currency, allocations) else {
        return Ok(vec![
            "Settlement batch requires a valid party, currency, and allocations".into(),
        ]);
    };
    if allocations.is_empty() || total <= Decimal::ZERO {
        errors.push(
            "Settlement batch must allocate a positive total across at least one document".into(),
        );
    }
    let base_code = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let base_currency = tx.query_opt(
        "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
        &[&tenant.id, &base_code],
    ).await?.map(|row| row.get::<_, Uuid>(0));
    let mut seen = HashSet::new();
    let mut allocated_total = Decimal::ZERO;
    for (index, allocation) in allocations.iter().enumerate() {
        let Some(document_id) = allocation
            .get(document_field)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            errors.push(format!(
                "Allocation {} must link to a valid {document_field}",
                index + 1
            ));
            continue;
        };
        if allocation
            .get(other_field)
            .is_some_and(|value| !value.is_null())
        {
            errors.push(format!(
                "Allocation {} cannot mix invoice and bill directions",
                index + 1
            ));
            continue;
        }
        if !seen.insert(document_id) {
            errors.push(format!(
                "{document_field} {document_id} appears more than once in this settlement"
            ));
            continue;
        }
        let allocation_amount = allocation
            .get("amount")
            .and_then(crate::money::decimal)
            .unwrap_or(Decimal::ZERO);
        if allocation_amount <= Decimal::ZERO {
            errors.push(format!(
                "Allocation {} amount must be greater than zero",
                index + 1
            ));
            continue;
        }
        allocated_total = allocated_total
            .checked_add(allocation_amount)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec!["Allocation total exceeds the supported range".into()],
                )
            })?;
        let query = format!(
            "SELECT total::text, status, {party_field}, currency FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"
        );
        let Some(source_document) = tx.query_opt(&query, &[&tenant.id, &document_id]).await? else {
            errors.push(format!(
                "{document_field} {document_id} was not found in this tenant"
            ));
            continue;
        };
        let source_total = database_amount(&source_document, 0)?;
        let status: String = source_document.get(1);
        let source_party: Uuid = source_document.get(2);
        let source_currency: Option<Uuid> = source_document.get(3);
        let source_currency = source_currency.or(base_currency);
        if !matches!(
            status.as_str(),
            "posted" | "partially_paid" | "partially_settled"
        ) {
            errors.push(format!(
                "{document_field} {document_id} is not open for settlement"
            ));
        }
        if source_party != party {
            errors.push(format!(
                "{document_field} {document_id} belongs to a different party"
            ));
        }
        if source_currency != Some(currency) {
            errors.push(format!("{document_field} {document_id} uses a different currency; settle one currency per batch"));
        }
        let paid_sql = format!(
            "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {document_field} = $2"
        );
        let paid = tx
            .query_opt(&paid_sql, &[&tenant.id, &document_id])
            .await?
            .map(|row| database_amount(&row, 0))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let adjusted_sql = format!(
            "SELECT COALESCE(SUM(total), 0)::text FROM {note_table} WHERE tenant_id = $1 AND {note_field} = $2 AND status = 'posted'"
        );
        let adjusted = tx
            .query_opt(&adjusted_sql, &[&tenant.id, &document_id])
            .await?
            .map(|row| database_amount(&row, 0))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let outstanding = source_total
            .checked_sub(paid)
            .and_then(|value| value.checked_sub(adjusted))
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec!["Source document balance exceeds the supported range".into()],
                )
            })?
            .max(Decimal::ZERO);
        if allocation_amount > outstanding + tolerance() {
            errors.push(format!("Allocation for {document_field} {document_id} exceeds its current balance ({outstanding:.2})"));
        }
    }
    if !crate::money::within_tolerance(allocated_total, total, tolerance()) {
        errors.push("Settlement total must equal the sum of its allocations".into());
    }
    Ok(errors)
}
