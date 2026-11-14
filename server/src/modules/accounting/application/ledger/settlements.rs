use super::*;
use rust_decimal::Decimal;

fn decimal_field(event: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(event.get(field)?)
}

fn decimal_column(row: &tokio_postgres::Row, column: usize) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.posting",
            vec!["Stored settlement amount exceeds the supported decimal range".into()],
        )
    })
}

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

mod disbursements;
mod payroll_expense;
mod provider_payments;
mod settlement_batches;

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
        "pos.cash_movement.posted"
        | "accounting.invoice.paid"
        | "lending.loan.disbursed"
        | "insurance.claim.paid" => {
            disbursements::handle_event(kernel, tx, tenant, event_type, event, event_id, depth)
                .await
        }
        "payroll.payroll_run.approved" | "expense.expense_claim.approved" => {
            payroll_expense::handle_event(kernel, tx, tenant, event_type, event, event_id, depth)
                .await
        }
        "accounting.payment.created" => {
            provider_payments::handle_event(kernel, tx, tenant, event_type, event, event_id, depth)
                .await
        }
        "accounting.settlement_batch.approved" => {
            settlement_batches::handle_event(kernel, tx, tenant, event, event_id, depth).await
        }
        _ => Ok(None),
    }
}
