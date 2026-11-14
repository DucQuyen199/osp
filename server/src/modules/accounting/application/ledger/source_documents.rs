use super::*;
use rust_decimal::Decimal;

#[path = "source_documents/adjustment_notes.rs"]
mod adjustment_notes;
#[path = "source_documents/bill.rs"]
mod bill;
#[path = "source_documents/invoice.rs"]
mod invoice;
#[path = "source_documents/journal_reversals.rs"]
mod journal_reversals;
#[path = "source_documents/return_documents.rs"]
mod return_documents;

fn decimal_column(row: &tokio_postgres::Row, column: usize) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.posting",
            vec!["Stored source-document amount exceeds the supported decimal range".into()],
        )
    })
}

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

fn overflow_error(event_type: &str) -> crate::error::ApiError {
    crate::error::ApiError::validation(
        event_type,
        vec!["Source-document posting exceeds the supported decimal range".into()],
    )
}

pub(super) async fn handle_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    match event_type {
        "accounting.journal_entry.reversed" => {
            journal_reversals::handle(kernel, tx, tenant, event_type, event, event_id, depth).await
        }
        "purchasing.purchase_return.dispatched" => {
            return_documents::handle_purchase_return(kernel, tx, tenant, event, event_id, depth)
                .await
        }
        "sales.sales_return.received" => {
            return_documents::handle_sales_return(kernel, tx, tenant, event, event_id, depth).await
        }
        "accounting.invoice.posted" => {
            invoice::handle(kernel, tx, tenant, event_type, event, event_id, depth).await
        }
        "accounting.bill.posted" => {
            bill::handle(kernel, tx, tenant, event_type, event, event_id, depth).await
        }
        "accounting.credit_note.posted" | "accounting.debit_note.posted" => {
            adjustment_notes::handle(kernel, tx, tenant, event_type, event, event_id, depth).await
        }
        _ => Ok(None),
    }
}
