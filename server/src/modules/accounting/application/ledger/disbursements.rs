//! Focused accounting settlement source-event handler.
use super::*;

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
        "pos.cash_movement.posted" => {
            let id = event
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Phiếu thu chi cần mã chứng từ hợp lệ".into()],
                    )
                })?;
            let amount = decimal_field(event, "amount").unwrap_or(Decimal::ZERO);
            let offset = event
                .get("offset_account")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Phiếu thu chi cần tài khoản đối ứng hợp lệ".into()],
                    )
                })?;
            let direction = event
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let reason = event
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Điều chỉnh quỹ POS");
            let cash = ensure_account(kernel, tx, tenant, "111", "Tiền mặt", "asset").await?;
            let lines = match direction {
                "cash_in" => vec![
                    journal_line_decimal(cash, amount, Decimal::ZERO)?,
                    journal_line_decimal(offset, Decimal::ZERO, amount)?,
                ],
                "cash_out" => vec![
                    journal_line_decimal(offset, amount, Decimal::ZERO)?,
                    journal_line_decimal(cash, Decimal::ZERO, amount)?,
                ],
                _ => {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Loại giao dịch quỹ không hợp lệ".into()],
                    ));
                }
            };
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                reason,
                amount,
                "pos_cash_movement",
                &id.to_string(),
                lines,
            )
            .await?;
            Ok(Some(true))
        }
        "accounting.invoice.paid" => {
            let source = event
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (target, table) = match source {
                "school_fee" => ("school.fee", "school__fee"),
                "subscription" => ("subscription.billing_cycle", "subscription__billing_cycle"),
                "utility_bill" => ("utilities.utility_bill", "utilities__utility_bill"),
                _ => return Ok(Some(false)),
            };
            let source_id = event
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Paid invoice requires a valid source record id".into()],
                    )
                })?;
            let sql = format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE");
            if tx
                .query_opt(&sql, &[&tenant.id, &source_id])
                .await?
                .is_none()
            {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Paid invoice source record was not found for this tenant".into()],
                ));
            }
            let entity = kernel.ent(tenant, target)?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &source_id.to_string(),
                    "paid",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
            Ok(Some(true))
        }
        "lending.loan.disbursed" => {
            let amount = decimal_field(event, "principal").unwrap_or(Decimal::ZERO);
            let method = event
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let cash_code = match method {
                "cash" => "111",
                "bank" => "112",
                _ => {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Loan disbursement requires cash or bank method".into()],
                    ));
                }
            };
            let source_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let receivable =
                ensure_account(kernel, tx, tenant, "138", "Phải thu cho vay", "asset").await?;
            let cash = account_id(tx, tenant, cash_code).await?;
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Giải ngân khoản vay",
                amount,
                "loan",
                source_id,
                vec![
                    journal_line_decimal(receivable, amount, Decimal::ZERO)?,
                    journal_line_decimal(cash, Decimal::ZERO, amount)?,
                ],
            )
            .await?;
            Ok(Some(true))
        }
        "insurance.claim.paid" => {
            let amount = decimal_field(event, "approved_amount")
                .or_else(|| decimal_field(event, "amount"))
                .unwrap_or(Decimal::ZERO);
            let source_id = event.get("id").and_then(Value::as_str).ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Insurance claim event requires an id".into()],
                )
            })?;
            let expense = event
                .get("expense_account")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Claim expense account is required".into()],
                    )
                })?;
            let cash_code = match event.get("method").and_then(Value::as_str) {
                Some("cash") => "111",
                Some("bank") => "112",
                _ => {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Claim payout requires cash or bank method".into()],
                    ));
                }
            };
            let cash = account_id(tx, tenant, cash_code).await?;
            create_posted_journal_decimal(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                "Chi trả bồi thường bảo hiểm",
                amount,
                "claim",
                source_id,
                vec![
                    journal_line_decimal(expense, amount, Decimal::ZERO)?,
                    journal_line_decimal(cash, Decimal::ZERO, amount)?,
                ],
            )
            .await?;
            Ok(Some(true))
        }
        _ => Ok(None),
    }
}
