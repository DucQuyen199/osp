//! Tenant-scoped locking and deduplication for e-invoice requests.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "einvoice" {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    if matches!(
        action,
        "created"
            | "issued"
            | "retry"
            | "retry_due"
            | "retry_cancellation"
            | "retry_cancellation_due"
    ) {
        let invoice_id = document
            .get("invoice")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let invoice_is_posted = if let Some(invoice_id) = invoice_id {
            tx.query_opt(
                "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND id = $2 AND status IN ('posted', 'partially_paid', 'partially_settled', 'paid', 'settled') FOR SHARE",
                &[&tenant.id, &invoice_id],
            )
            .await?
            .is_some()
        } else {
            false
        };
        if !invoice_is_posted {
            errors.push("The source accounting invoice must still be posted".into());
        }
        if action == "created" {
            if document.get("request_payload").is_none_or(Value::is_null) {
                errors.push("An immutable invoice request snapshot is required".into());
            }
            if let Some(invoice_id) = invoice_id {
                let lock_key = format!("einvoice:{}:{invoice_id}", tenant.id);
                tx.query_one_row(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                if tx
                    .query_opt(
                        "SELECT id FROM einvoice__einvoice WHERE tenant_id = $1 AND invoice = $2 LIMIT 1 FOR UPDATE",
                        &[&tenant.id, &invoice_id],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("An e-invoice request already exists for this accounting invoice".into());
                }
            }
        }
    }
    if action == "issued" {
        if let (Some(provider), Some(number)) = (
            document.get("provider").and_then(Value::as_str),
            document.get("number").and_then(Value::as_str),
        ) {
            let provider = provider.trim();
            let number = number.trim();
            let serial = document
                .get("serial")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let lock_key = format!(
                "einvoice.number:{}:{}:{}:{}",
                tenant.id,
                provider.to_ascii_lowercase(),
                serial.to_ascii_lowercase(),
                number.to_ascii_lowercase()
            );
            tx.query_one_row(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let current_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if tx
                .query_opt(
                    "SELECT id FROM einvoice__einvoice WHERE tenant_id = $1 AND lower(btrim(provider)) = lower(btrim($2)) AND lower(btrim(COALESCE(serial, ''))) = lower(btrim($3)) AND lower(btrim(number)) = lower(btrim($4)) AND status IN ('issued', 'cancelled') AND ($5::uuid IS NULL OR id <> $5) LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &provider, &serial, &number, &current_id],
                )
                .await?
                .is_some()
            {
                errors.push("This provider, series, and invoice number are already registered".into());
            }
        }
    }
    Ok(errors)
}

/// Lock the source invoice and return whether an issuance request already exists.
pub async fn lock_posted_invoice(tx: &Tx<'_>, tenant: &Tenant, invoice: Uuid) -> R<Option<bool>> {
    let lock_key = format!("einvoice:{}:{invoice}", tenant.id);
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;

    let Some(row) = tx
        .query_opt(
            "SELECT status FROM accounting__invoice WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &invoice],
        )
        .await?
    else {
        return Ok(None);
    };
    let status: String = row.get(0);
    if status != "posted" {
        return Ok(None);
    }

    let existing = tx
        .query_opt(
            "SELECT id FROM einvoice__einvoice WHERE tenant_id = $1 AND invoice = $2 FOR UPDATE",
            &[&tenant.id, &invoice],
        )
        .await?
        .is_some();
    Ok(Some(existing))
}
