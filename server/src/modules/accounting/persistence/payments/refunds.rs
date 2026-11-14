use super::super::database_amount;
use super::shared::{amount, amount_tolerance, refund_matches};
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let refund = document.get("source").and_then(Value::as_str) == Some("payment_refund");
    if refund {
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let transaction = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT amount::text, party, invoice, bill FROM payments__payment_txn WHERE tenant_id = $1 AND id = $2 AND status = 'refunded' FOR UPDATE",
                        &[&tenant.id, &source_id],
                    ).await?
        } else {
            None
        };
        let matches_source = if let Some(row) = transaction {
            let original_amount = database_amount(&row, 0)?;
            let party: Uuid = row.get(1);
            let invoice: Option<Uuid> = row.get(2);
            let bill: Option<Uuid> = row.get(3);
            amount(document, "amount")
                .is_some_and(|refund_amount| refund_matches(original_amount, refund_amount))
                && document
                    .get("party")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == Some(party)
                && document
                    .get("invoice")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == invoice
                && document
                    .get("bill")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == bill
        } else {
            false
        };
        if !matches_source {
            errors.push(
                "Khoản hoàn tiền phải khớp giao dịch provider đã hoàn và đúng hóa đơn/đối tác"
                    .into(),
            );
        }
        if let Some(source_id) = source_id {
            let original = tx
                        .query_opt(
                            "SELECT amount::text FROM accounting__payment WHERE tenant_id = $1 AND source = 'payments' AND source_id = $2 FOR UPDATE",
                            &[&tenant.id, &source_id.to_string()],
                        )
                        .await?;
            let matches_original = if let Some(row) = original {
                let original_amount = database_amount(&row, 0)?;
                amount(document, "amount")
                    .is_some_and(|refund_amount| refund_matches(original_amount, refund_amount))
            } else {
                false
            };
            if !matches_original {
                errors.push("Không tìm thấy payment kế toán gốc có cùng số tiền để hoàn".into());
            }
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx
                        .query_opt(
                            "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'payment_refund' AND source_id = $2 AND id <> $3 LIMIT 1",
                            &[&tenant.id, &source_id.to_string(), &payment_id],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Giao dịch provider này đã có khoản hoàn kế toán".into());
                    }
        }
    }
    if document.get("source").and_then(Value::as_str) == Some("event_ticket_refund") {
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let ticket = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT party, method FROM events__ticket WHERE tenant_id = $1 AND id = $2 AND status = 'refunded' FOR UPDATE",
                        &[&tenant.id, &source_id],
                    )
                    .await?
        } else {
            None
        };
        let original = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT amount::text, party, method FROM accounting__payment WHERE tenant_id = $1 AND source = 'ticket' AND source_id = $2 FOR UPDATE",
                        &[&tenant.id, &source_id.to_string()],
                    )
                    .await?
        } else {
            None
        };
        let reversal = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'ticket_refund' AND source_id = $2 AND status = 'posted' FOR SHARE",
                        &[&tenant.id, &source_id.to_string()],
                    )
                    .await?
        } else {
            None
        };
        let matches_original = match (ticket, original) {
            (Some(ticket), Some(original)) => {
                let ticket_party: Option<Uuid> = ticket.get(0);
                let ticket_method: Option<String> = ticket.get(1);
                let original_amount = database_amount(&original, 0)?;
                let original_party: Option<Uuid> = original.get(1);
                let original_method: Option<String> = original.get(2);
                amount(document, "amount")
                    .is_some_and(|value| refund_matches(original_amount, value))
                    && ticket_party == original_party
                    && ticket_method == original_method
                    && document
                        .get("party")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok())
                        == original_party
                    && document.get("method").and_then(Value::as_str) == original_method.as_deref()
            }
            _ => false,
        };
        if !matches_original || reversal.is_none() {
            errors.push("Hoàn tiền vé phải khớp payment gốc và bút toán đảo đã ghi sổ".into());
        }
        if let Some(source_id) = source_id {
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx
                        .query_opt(
                            "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'event_ticket_refund' AND source_id = $2 AND id <> $3 LIMIT 1",
                            &[&tenant.id, &source_id.to_string(), &payment_id],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Vé này đã có payment hoàn tiền kế toán".into());
                    }
        }
    }
    let source = document
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if matches!(source, "credit_note_refund" | "debit_note_refund") {
        let (note_field, note_table, doc_field, doc_table, party_field, refund_field) =
            if source == "credit_note_refund" {
                (
                    "refund_credit_note",
                    "accounting__credit_note",
                    "invoice",
                    "accounting__invoice",
                    "party",
                    "invoice",
                )
            } else {
                (
                    "refund_debit_note",
                    "accounting__debit_note",
                    "bill",
                    "accounting__bill",
                    "supplier",
                    "bill",
                )
            };
        let note_id = document
            .get(note_field)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let note_sql = format!(
            "SELECT note.total::text, note.status, note.{refund_field}, document.{party_field} FROM {note_table} note JOIN {doc_table} document ON document.tenant_id = note.tenant_id AND document.id = note.{refund_field} WHERE note.tenant_id = $1 AND note.id = $2 FOR UPDATE OF note, document"
        );
        let note = if let Some(id) = note_id {
            tx.query_opt(&note_sql, &[&tenant.id, &id]).await?
        } else {
            None
        };
        let valid_note = if let Some(note) = note {
            let note_total = database_amount(&note, 0)?;
            let status: String = note.get(1);
            let document_id: Uuid = note.get(2);
            let party: Uuid = note.get(3);
            let linked_document = document
                .get(doc_field)
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let supplied_party = document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            let duplicate = tx.query_opt("SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = $2 AND source_id = $3 AND id <> $4 LIMIT 1", &[&tenant.id, &source, &document.get("source_id").and_then(Value::as_str).unwrap_or_default(), &payment_id]).await?.is_some();
            let prior_sql = format!(
                "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {note_field} = $2 AND id <> $3"
            );
            let prior = tx
                .query_one_row(
                    &prior_sql,
                    &[&tenant.id, &note_id.unwrap_or(Uuid::nil()), &payment_id],
                )
                .await?;
            let refunded = database_amount(&prior, 0)?.abs();
            let remaining = note_total
                .checked_sub(refunded)
                .unwrap_or_default()
                .max(Decimal::ZERO);
            let valid = status == "posted"
                && linked_document == Some(document_id)
                && supplied_party == Some(party)
                && amount(document, "amount").is_some_and(|value| {
                    value < Decimal::ZERO && value.abs() <= remaining + amount_tolerance()
                })
                && !duplicate;
            valid
        } else {
            false
        };
        if !valid_note {
            errors.push("Adjustment refund must match a posted note and its source document, stay within the note balance, and use a unique request id".into());
        }
    }
    Ok(errors)
}
