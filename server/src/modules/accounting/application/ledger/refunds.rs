use super::*;
use rust_decimal::{Decimal, RoundingStrategy};

fn decimal_column(row: &tokio_postgres::Row, column: usize, event_type: &str) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Stored refund amount exceeds the supported decimal range".into()],
        )
    })
}

fn decimal_value(value: Decimal, event_type: &str) -> R<Value> {
    crate::money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Refund amount exceeds the supported decimal range".into()],
        )
    })
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
        "payments.payment_refund.succeeded" => {
            let refund_id = event
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Provider refund requires a valid id".into()],
                    )
                })?;
            if tx.query_opt(
                "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'payment_refund' AND source_id = $2 AND status = 'posted' LIMIT 1 FOR UPDATE",
                &[&tenant.id, &refund_id.to_string()],
            ).await?.is_some() {
                return Ok(Some(true));
            }
            let refund = tx.query_opt(
                "SELECT refund.amount::text, payment.id, payment.amount::text, original.id, COALESCE(original.base_amount, original.amount)::text FROM payments__payment_refund refund JOIN payments__payment_txn payment ON payment.tenant_id = refund.tenant_id AND payment.id = refund.payment_txn JOIN accounting__payment original ON original.tenant_id = payment.tenant_id AND original.source = 'payments' AND original.source_id = payment.id::text WHERE refund.tenant_id = $1 AND refund.id = $2 AND refund.status = 'succeeded' FOR UPDATE OF refund, original",
                &[&tenant.id, &refund_id],
            ).await?.ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Refund has no successful provider record and matching accounting payment".into()]))?;
            let refund_amount = decimal_column(&refund, 0, event_type)?;
            let _payment_id: Uuid = refund.get(1);
            let original_amount = decimal_column(&refund, 2, event_type)?;
            let accounting_payment_id: Uuid = refund.get(3);
            let original_base_amount = decimal_column(&refund, 4, event_type)?;
            if original_amount <= Decimal::ZERO || refund_amount <= Decimal::ZERO {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund and original payment amounts must be positive".into()],
                ));
            }
            let ratio = refund_amount.checked_div(original_amount).ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund ratio exceeds the supported range".into()],
                )
            })?;
            let base_refund = original_base_amount
                .checked_mul(ratio)
                .map(|amount| {
                    amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                })
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Refund base amount exceeds the supported range".into()],
                    )
                })?;
            let original = tx.query_opt(
                "SELECT lines FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'payment' AND source_id = $2 AND status = 'posted' FOR SHARE",
                &[&tenant.id, &accounting_payment_id.to_string()],
            ).await?.ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Provider refund requires the original payment journal to be posted".into()]))?;
            let original_lines: Value = original.get(0);
            let mut lines = reversal::lines_to_reverse(&original_lines, event_type)?;
            scale_reversal_lines(&mut lines, ratio, event_type)?;
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Hoàn một phần giao dịch qua cổng thanh toán",
                base_refund,
                "payment_refund",
                &refund_id.to_string(),
                lines,
            )
            .await?;
            Ok(Some(true))
        }
        "payments.payment_txn.refunded" => {
            let transaction_id = event
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Refunded provider transaction requires a valid id".into()],
                    )
                })?;
            if tx.query_opt(
                "SELECT id FROM payments__payment_refund WHERE tenant_id = $1 AND payment_txn = $2 AND status = 'succeeded' LIMIT 1 FOR UPDATE",
                &[&tenant.id, &transaction_id],
            ).await?.is_some() {
                // Each partial refund already posted its proportional reversal.
                return Ok(Some(true));
            }
            let payment = tx
                .query_opt(
                    "SELECT id, amount::text FROM accounting__payment WHERE tenant_id = $1 AND source = 'payments' AND source_id = $2 FOR UPDATE",
                    &[&tenant.id, &transaction_id.to_string()],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Provider refund has no matching accounting payment to reverse".into()],
                    )
                })?;
            let payment_id: Uuid = payment.get(0);
            let amount = decimal_column(&payment, 1, event_type)?;
            let original = tx
                .query_opt(
                    "SELECT lines FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'payment' AND source_id = $2 AND status = 'posted' FOR SHARE",
                    &[&tenant.id, &payment_id.to_string()],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Provider refund requires the original payment journal to be posted".into()],
                    )
                })?;
            let original_lines: Value = original.get(0);
            let reversal_lines = reversal::lines_to_reverse(&original_lines, event_type)?;
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Hoàn tiền giao dịch qua cổng thanh toán",
                amount,
                "payment_refund",
                &transaction_id.to_string(),
                reversal_lines,
            )
            .await?;
            Ok(Some(true))
        }
        "events.ticket.refunded" => {
            let ticket_id = event
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Hoàn vé cần mã vé hợp lệ".into()],
                    )
                })?;
            let ticket = tx
                .query_opt(
                    "SELECT status, refund_reason FROM events__ticket WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &ticket_id],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Không tìm thấy vé trong tenant hiện tại".into()],
                    )
                })?;
            let ticket_status: String = ticket.get(0);
            let refund_reason: Option<String> = ticket.get(1);
            if ticket_status != "refunded"
                || refund_reason
                    .as_deref()
                    .is_none_or(|reason| reason.trim().is_empty())
            {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Vé cần ở trạng thái đã hoàn và có lý do hoàn".into()],
                ));
            }
            let original_payment = tx
                .query_opt(
                    "SELECT id, amount::text FROM accounting__payment WHERE tenant_id = $1 AND source = 'ticket' AND source_id = $2 FOR UPDATE",
                    &[&tenant.id, &ticket_id.to_string()],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Không tìm thấy payment gốc của vé để hoàn".into()],
                    )
                })?;
            let original_payment_id: Uuid = original_payment.get(0);
            let amount = decimal_column(&original_payment, 1, event_type)?;
            let original_journal = tx
                .query_opt(
                    "SELECT lines FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'payment' AND source_id = $2 AND status = 'posted' FOR SHARE",
                    &[&tenant.id, &original_payment_id.to_string()],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Payment gốc của vé chưa có bút toán đã ghi sổ".into()],
                    )
                })?;
            let lines: Value = original_journal.get(0);
            let reversal_lines = reversal::lines_to_reverse(&lines, event_type)?;
            let ticket_key = ticket_id.to_string();
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Hoàn tiền vé sự kiện",
                amount,
                "ticket_refund",
                &ticket_key,
                reversal_lines,
            )
            .await?;
            if tx
                .query_opt(
                    "SELECT id FROM accounting__payment WHERE tenant_id = $1 AND source = 'event_ticket_refund' AND source_id = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &ticket_key],
                )
                .await?
                .is_none()
            {
                let (party, method, tax_rate, tax_name, tax_amount): (
                    Option<Uuid>,
                    Option<String>,
                    Option<String>,
                    Option<String>,
                    Option<String>,
                ) = tx
                    .query_opt(
                        "SELECT party, method, tax_rate::text, tax_name, tax_amount::text FROM accounting__payment WHERE tenant_id = $1 AND id = $2",
                        &[&tenant.id, &original_payment_id],
                    )
                    .await?
                    .map(|row| (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4)))
                    .ok_or_else(|| {
                        crate::error::ApiError::internal("Ticket payment disappeared during refund")
                    })?;
                let mut data = Map::new();
                let refund_amount = Decimal::ZERO.checked_sub(amount).ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Refund amount exceeds the supported decimal range".into()]))?;
                data.insert("amount".into(), decimal_value(refund_amount, event_type)?);
                if let Some(party) = party {
                    data.insert("party".into(), Value::String(party.to_string()));
                }
                if let Some(method) = method {
                    data.insert("method".into(), Value::String(method));
                }
                if let Some(rate) = tax_rate {
                    let rate = crate::money::decimal_str(&rate).ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Original tax rate is invalid".into()]))?;
                    data.insert("tax_rate".into(), decimal_value(rate, event_type)?);
                }
                if let Some(name) = tax_name {
                    data.insert("tax_name".into(), Value::String(name));
                }
                if let Some(tax) = tax_amount {
                    let refund_tax = if tax.starts_with('-') {
                        crate::money::decimal_str(&tax).ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Original tax amount is invalid".into()]))?
                    } else {
                        Decimal::ZERO.checked_sub(crate::money::decimal_str(&tax).ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Original tax amount is invalid".into()]))?).ok_or_else(|| crate::error::ApiError::validation(event_type, vec!["Refund tax amount exceeds the supported decimal range".into()]))?
                    };
                    data.insert("tax_amount".into(), decimal_value(refund_tax, event_type)?);
                }
                data.insert(
                    "source".into(),
                    Value::String("event_ticket_refund".into()),
                );
                data.insert("source_id".into(), Value::String(ticket_key));
                let payment = kernel.ent(tenant, "accounting.payment")?;
                kernel
                    .create_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &payment,
                        data,
                        &Opts {
                            depth: Some(depth + 1),
                            causation: Some(event_id),
                            silent: false,
                        },
                    )
                    .await?;
            }
            Ok(Some(true))
        }
        "pos.pos_order.refunded" => {
            let method = event
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let payment_account = match method {
                "cash" => "111",
                "card" | "transfer" | "ewallet" => "112",
                _ => return Ok(Some(false)),
            };
            let amount = event
                .get("total")
                .and_then(crate::money::decimal)
                .unwrap_or(Decimal::ZERO);
            let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let revenue = account_id(tx, tenant, "511").await?;
            let payment = account_id(tx, tenant, payment_account).await?;
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Hoàn tiền đơn POS",
                amount,
                "pos_refund",
                id,
                vec![
                    journal_line_decimal(revenue, amount, Decimal::ZERO)?,
                    journal_line_decimal(payment, Decimal::ZERO, amount)?,
                ],
            )
            .await?;
            Ok(Some(true))
        }
        _ => Ok(None),
    }
}

fn scale_reversal_lines(lines: &mut [Value], ratio: Decimal, event_type: &str) -> R<()> {
    let mut debit_total = Decimal::ZERO;
    let mut credit_total = Decimal::ZERO;
    let mut last_credit = None;
    for (index, line) in lines.iter_mut().enumerate() {
        let debit = line
            .get("debit")
            .and_then(crate::money::decimal)
            .unwrap_or_default();
        let credit = line
            .get("credit")
            .and_then(crate::money::decimal)
            .unwrap_or_default();
        let debit = debit
            .checked_mul(ratio)
            .map(|amount| amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund journal exceeds the supported range".into()],
                )
            })?;
        let credit = credit
            .checked_mul(ratio)
            .map(|amount| amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund journal exceeds the supported range".into()],
                )
            })?;
        line["debit"] = crate::money::json_number(debit).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal amount exceeds the supported range".into()],
            )
        })?;
        line["credit"] = crate::money::json_number(credit).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal amount exceeds the supported range".into()],
            )
        })?;
        debit_total = debit_total.checked_add(debit).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal total exceeds the supported range".into()],
            )
        })?;
        credit_total = credit_total.checked_add(credit).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal total exceeds the supported range".into()],
            )
        })?;
        if credit > Decimal::ZERO {
            last_credit = Some(index);
        }
    }
    if debit_total != credit_total {
        let Some(index) = last_credit else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal cannot be balanced after currency rounding".into()],
            ));
        };
        let adjustment = debit_total.checked_sub(credit_total).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal balance exceeds the supported range".into()],
            )
        })?;
        let credit = lines[index]
            .get("credit")
            .and_then(crate::money::decimal)
            .unwrap_or_default()
            .checked_add(adjustment)
            .filter(|value| *value >= Decimal::ZERO)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Refund journal rounding cannot be balanced".into()],
                )
            })?;
        lines[index]["credit"] = crate::money::json_number(credit).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Refund journal amount exceeds the supported range".into()],
            )
        })?;
    }
    Ok(())
}
