use super::*;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use uuid::Uuid;

fn db_decimal(row: &tokio_postgres::Row, column: usize) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["Stored adjustment balance exceeds the supported decimal range".into()],
        )
    })
}

/// Pay an approved customer credit or receive a supplier reimbursement against a posted note.
/// The note, source document, balance checks, payment and journal event all share one transaction.
pub async fn create_adjustment_refund(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    kind: &str,
    adjustment_id: &str,
    amount: Decimal,
    method: &str,
    payment_date: &str,
    request_id: &str,
) -> R<Value> {
    let (note_entity, note_table, source_field, source_table, source_party, payment_link, source) =
        match kind {
            "credit_note" => (
                "credit_note",
                "accounting__credit_note",
                "invoice",
                "accounting__invoice",
                "party",
                "refund_credit_note",
                "credit_note_refund",
            ),
            "debit_note" => (
                "debit_note",
                "accounting__debit_note",
                "bill",
                "accounting__bill",
                "supplier",
                "refund_debit_note",
                "debit_note_refund",
            ),
            _ => {
                return Err(crate::error::ApiError::validation(
                    "accounting.adjustment_refund",
                    vec!["Refund kind must be credit_note or debit_note".into()],
                ));
            }
        };
    kernel.authorize(tenant, actor, "accounting.payment.create")?;
    kernel.authorize(tenant, actor, &format!("accounting.{note_entity}.read"))?;
    if amount <= Decimal::ZERO
        || !matches!(method, "cash" | "card" | "transfer" | "ewallet" | "bank")
    {
        return Err(crate::error::ApiError::validation("accounting.adjustment_refund", vec!["Refund amount must be positive and method must be cash, card, transfer, ewallet, or bank".into()]));
    }
    let request_id = Uuid::parse_str(request_id).map_err(|_| {
        crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["A valid request id is required for safe retries".into()],
        )
    })?;
    let adjustment_id = Uuid::parse_str(adjustment_id).map_err(|_| {
        crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["Adjustment note id is invalid".into()],
        )
    })?;
    let payment_date = NaiveDate::parse_from_str(payment_date, "%Y-%m-%d").map_err(|_| {
        crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["Payment date must use YYYY-MM-DD".into()],
        )
    })?;

    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!(
            "accounting.adjustment_refund:{}:{}",
            tenant.id, request_id
        )],
    )
    .await?;
    if let Some(existing) = tx.query_opt("SELECT id FROM accounting__payment WHERE tenant_id = $1 AND source = $2 AND source_id = $3", &[&tenant.id, &source, &request_id.to_string()]).await? {
        let id: Uuid = existing.get(0);
        tx.commit().await?;
        return Ok(json!({"existing": true, "paymentId": id}));
    }

    let note_sql = format!(
        "SELECT note.total::text, note.status, note.{source_field}, document.{source_party} FROM {note_table} note JOIN {source_table} document ON document.tenant_id = note.tenant_id AND document.id = note.{source_field} WHERE note.tenant_id = $1 AND note.id = $2 FOR UPDATE OF note, document"
    );
    let note = tx
        .query_opt(&note_sql, &[&tenant.id, &adjustment_id])
        .await?
        .ok_or_else(|| crate::error::ApiError::not_found("Adjustment note not found"))?;
    let note_total = db_decimal(&note, 0)?;
    let status: String = note.get(1);
    let source_document: Uuid = note.get(2);
    let party: Uuid = note.get(3);
    if status != "posted" {
        return Err(crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["Only a posted adjustment note can be refunded".into()],
        ));
    }
    let doc_sql = format!(
        "SELECT total::text, status FROM {source_table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"
    );
    let document = tx
        .query_opt(&doc_sql, &[&tenant.id, &source_document])
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Source invoice or bill was not found".into()],
            )
        })?;
    let document_total = db_decimal(&document, 0)?;
    let document_status: String = document.get(1);
    if matches!(document_status.as_str(), "draft" | "void") {
        return Err(crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec!["The source invoice or bill must remain posted".into()],
        ));
    }

    let refund_sum_sql = format!(
        "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {payment_link} = $2"
    );
    let refund_sum = tx
        .query_one_row(&refund_sum_sql, &[&tenant.id, &adjustment_id])
        .await?;
    let already_refunded = Decimal::ZERO
        .checked_sub(db_decimal(&refund_sum, 0)?)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Refund total exceeds the supported range".into()],
            )
        })?;
    let note_remaining = note_total
        .checked_sub(already_refunded)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Refund balance exceeds the supported range".into()],
            )
        })?
        .max(Decimal::ZERO);

    let (payment_fk, note_table, note_fk) = if kind == "credit_note" {
        ("invoice", "accounting__credit_note", "invoice")
    } else {
        ("bill", "accounting__debit_note", "bill")
    };
    let payments = tx.query_one_row(&format!("SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {payment_fk} = $2"), &[&tenant.id, &source_document]).await?;
    let paid = db_decimal(&payments, 0)?;
    let adjustments = tx.query_one_row(&format!("SELECT COALESCE(SUM(total), 0)::text FROM {note_table} WHERE tenant_id = $1 AND {note_fk} = $2 AND status = 'posted'"), &[&tenant.id, &source_document]).await?;
    let adjusted = db_decimal(&adjustments, 0)?;
    let credit = paid
        .checked_add(adjusted)
        .and_then(|value| value.checked_sub(document_total))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Source document balance exceeds the supported range".into()],
            )
        })?
        .max(Decimal::ZERO);
    let refundable = note_remaining.min(credit);
    if amount > refundable {
        return Err(crate::error::ApiError::validation(
            "accounting.adjustment_refund",
            vec![format!(
                "Refund exceeds the available credit balance ({refundable:.2})"
            )],
        ));
    }

    let ent = kernel.ent(tenant, "accounting.payment")?;
    let mut payment = serde_json::Map::new();
    payment.insert("party".into(), json!(party));
    payment.insert(
        "amount".into(),
        crate::money::json_number(Decimal::ZERO.checked_sub(amount).ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Refund amount exceeds the supported range".into()],
            )
        })?)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.adjustment_refund",
                vec!["Refund amount exceeds the supported range".into()],
            )
        })?,
    );
    payment.insert("method".into(), json!(method));
    payment.insert("payment_date".into(), json!(payment_date.to_string()));
    payment.insert(source_field.into(), json!(source_document));
    payment.insert("source".into(), json!(source));
    payment.insert("source_id".into(), json!(request_id.to_string()));
    payment.insert(payment_link.into(), json!(adjustment_id));
    let created = kernel
        .create_in(&tx, &Actor::System, tenant, &ent, payment, &Opts::top())
        .await?;
    tx.commit().await?;
    Ok(created)
}
