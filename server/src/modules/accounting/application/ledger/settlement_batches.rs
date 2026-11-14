use super::*;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};

pub(super) async fn handle_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    batch: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    let batch_id = batch.get("id").and_then(Value::as_str).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.settlement_batch",
            vec!["Approved settlement batch has no id".into()],
        )
    })?;
    let receipt = batch.get("direction").and_then(Value::as_str) == Some("receipt");
    let source_field = if receipt { "invoice" } else { "bill" };
    let allocations = batch
        .get("allocations")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.settlement_batch",
                vec!["Approved settlement batch has no allocations".into()],
            )
        })?;
    let payment_entity = kernel.ent(tenant, "accounting.payment")?;
    let mut payment_ids = Vec::new();
    let mut cash_base_total = Decimal::ZERO;
    let mut applied_base_total = Decimal::ZERO;

    for allocation in allocations {
        let linked_id = allocation
            .get(source_field)
            .and_then(Value::as_str)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec![format!("Each allocation must identify a {source_field}")],
                )
            })?;
        let amount = allocation
            .get("amount")
            .and_then(crate::money::decimal)
            .unwrap_or(Decimal::ZERO);
        if amount <= Decimal::ZERO {
            return Err(crate::error::ApiError::validation(
                "accounting.settlement_batch",
                vec!["Allocation amounts must be positive".into()],
            ));
        }
        let mut payment = Map::new();
        payment.insert(
            "party".into(),
            batch.get("party").cloned().unwrap_or(Value::Null),
        );
        payment.insert(
            "amount".into(),
            crate::money::json_number(amount).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec!["Allocation amount exceeds supported range".into()],
                )
            })?,
        );
        payment.insert(
            "method".into(),
            batch.get("method").cloned().unwrap_or(Value::Null),
        );
        payment.insert(
            "payment_date".into(),
            batch.get("payment_date").cloned().unwrap_or(Value::Null),
        );
        payment.insert(source_field.into(), json!(linked_id));
        payment.insert("source".into(), json!("settlement_batch"));
        payment.insert("source_id".into(), json!(batch_id));
        payment.insert("settlement_batch".into(), json!(batch_id));
        let created = kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &payment_entity,
                payment,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        let id = created.get("id").and_then(Value::as_str).ok_or_else(|| {
            crate::error::ApiError::internal("Created settlement payment has no id")
        })?;
        cash_base_total = cash_base_total
            .checked_add(
                created
                    .get("base_amount")
                    .and_then(crate::money::decimal)
                    .unwrap_or(amount),
            )
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec!["Settlement base amount exceeds supported range".into()],
                )
            })?;
        applied_base_total = applied_base_total
            .checked_add(
                created
                    .get("applied_base_amount")
                    .and_then(crate::money::decimal)
                    .unwrap_or_else(|| {
                        created
                            .get("base_amount")
                            .and_then(crate::money::decimal)
                            .unwrap_or(amount)
                    }),
            )
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.settlement_batch",
                    vec!["Applied base amount exceeds supported range".into()],
                )
            })?;
        payment_ids.push(id.to_owned());
    }

    if payment_ids.is_empty()
        || cash_base_total <= Decimal::ZERO
        || applied_base_total <= Decimal::ZERO
    {
        return Err(crate::error::ApiError::validation(
            "accounting.settlement_batch",
            vec!["Settlement must create positive cash and applied balances".into()],
        ));
    }
    let method = batch
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let cash_code = if method == "cash" { "111" } else { "112" };
    let cash = account_id(tx, tenant, cash_code).await?;
    let control = account_id(tx, tenant, if receipt { "131" } else { "331" }).await?;
    let mut lines = if receipt {
        vec![
            journal_line_decimal(cash, cash_base_total, Decimal::ZERO)?,
            journal_line_decimal(control, Decimal::ZERO, applied_base_total)?,
        ]
    } else {
        vec![
            journal_line_decimal(control, applied_base_total, Decimal::ZERO)?,
            journal_line_decimal(cash, Decimal::ZERO, cash_base_total)?,
        ]
    };
    let difference = if receipt {
        cash_base_total.checked_sub(applied_base_total)
    } else {
        applied_base_total.checked_sub(cash_base_total)
    }
    .ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.settlement_batch",
            vec!["Settlement exchange difference exceeds supported range".into()],
        )
    })?;
    if difference > amount_tolerance() {
        let gain = ensure_account(
            kernel,
            tx,
            tenant,
            "515",
            "Foreign exchange gain",
            "revenue",
        )
        .await?;
        lines.push(journal_line_decimal(gain, Decimal::ZERO, difference)?);
    } else if difference < -amount_tolerance() {
        let loss_amount = Decimal::ZERO.checked_sub(difference).ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.settlement_batch",
                vec!["Settlement exchange loss exceeds supported range".into()],
            )
        })?;
        let loss = ensure_account(
            kernel,
            tx,
            tenant,
            "635",
            "Foreign exchange loss",
            "expense",
        )
        .await?;
        lines.push(journal_line_decimal(loss, loss_amount, Decimal::ZERO)?);
    }
    let amount = if receipt {
        cash_base_total
    } else {
        applied_base_total
    };
    create_posted_journal_decimal_at(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        if receipt {
            "Thu công nợ phân bổ nhiều hóa đơn"
        } else {
            "Chi công nợ phân bổ nhiều hóa đơn"
        },
        amount,
        "settlement_batch",
        batch_id,
        lines,
        batch.get("payment_date").and_then(Value::as_str),
    )
    .await?;
    Ok(Some(true))
}
