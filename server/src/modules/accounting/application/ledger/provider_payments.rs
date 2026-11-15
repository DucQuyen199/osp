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
        "accounting.payment.created" => {
            if event.get("source").and_then(Value::as_str) == Some("settlement_batch") {
                // The approved batch posts one consolidated journal after all of its
                // allocation payments have updated their individual balances.
                return Ok(Some(true));
            }
            if event.get("source").and_then(Value::as_str)
                == Some("payroll_contribution_remittance")
            {
                let remittance_id = event
                    .get("source_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Contribution payment requires a valid remittance id".into()],
                        )
                    })?;
                let remittance = tx
                    .query_opt(
                        "SELECT remittance.amount::text, remittance.payment_date, remittance.payment_method, policy.liability_account FROM payroll__contribution_remittance remittance JOIN payroll__contribution_policy policy ON policy.tenant_id = remittance.tenant_id AND policy.id = remittance.policy WHERE remittance.tenant_id = $1 AND remittance.id = $2 AND remittance.status = 'paid' FOR SHARE OF remittance, policy",
                        &[&tenant.id, &remittance_id],
                    )
                    .await?
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Paid contribution remittance was not found for this tenant".into()],
                        )
                    })?;
                let amount = decimal_column(&remittance, 0)?;
                let payment_date: Option<chrono::NaiveDate> = remittance.get(1);
                let method: Option<String> = remittance.get(2);
                let liability: Uuid = remittance.get(3);
                let payment_amount = event
                    .get("base_amount")
                    .filter(|value| !value.is_null())
                    .or_else(|| event.get("amount"))
                    .and_then(crate::money::decimal)
                    .unwrap_or(Decimal::ZERO);
                if payment_amount <= Decimal::ZERO
                    || !crate::money::within_tolerance(payment_amount, amount, amount_tolerance())
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Contribution payment amount must match the remittance amount".into()],
                    ));
                }
                let method = method.unwrap_or_default();
                let cash_code = match method.as_str() {
                    "cash" => "111",
                    "bank" => "112",
                    _ => {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec!["Contribution remittance requires cash or bank payment".into()],
                        ));
                    }
                };
                let liability_kind = tx
                    .query_opt(
                        "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &liability],
                    )
                    .await?
                    .map(|row| row.get::<_, String>(0));
                if liability_kind.as_deref() != Some("liability") {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Contribution remittance account must remain a liability account"
                                .into(),
                        ],
                    ));
                }
                let cash = account_id(tx, tenant, cash_code).await?;
                let cash_kind = tx
                    .query_opt(
                        "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &cash],
                    )
                    .await?
                    .map(|row| row.get::<_, String>(0));
                if cash_kind.as_deref() != Some("asset") {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec![
                            "Contribution payment cash or bank account must be an asset account"
                                .into(),
                        ],
                    ));
                }
                let payment_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
                create_posted_journal_decimal_at(
                    kernel,
                    tx,
                    tenant,
                    event_id,
                    depth,
                    "Thanh toán khoản đóng payroll",
                    payment_amount,
                    "payment",
                    payment_id,
                    vec![
                        journal_line_decimal(liability, payment_amount, Decimal::ZERO)?,
                        journal_line_decimal(cash, Decimal::ZERO, payment_amount)?,
                    ],
                    payment_date.as_ref().map(ToString::to_string).as_deref(),
                )
                .await?;
                return Ok(Some(true));
            }
            if event.get("source").and_then(Value::as_str) == Some("charity_disbursement") {
                let method = event
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let cash_code = match method {
                    "cash" => "111",
                    "card" | "transfer" | "ewallet" | "bank" => "112",
                    _ => {
                        return Err(crate::error::ApiError::validation(
                            "accounting.payment",
                            vec![
                                "Charity disbursement requires a valid cash or bank method".into(),
                            ],
                        ));
                    }
                };
                let expense_account_id = event
                    .get("expense_account")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "accounting.payment",
                            vec!["Charity disbursement requires an expense account".into()],
                        )
                    })?;
                let expense = tx
                    .query_opt(
                        "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
                        &[&tenant.id, &expense_account_id],
                    )
                    .await?
                    .map(|row| row.get::<_, Uuid>(0))
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "accounting.payment",
                            vec!["Disbursement account must be an expense account in this tenant".into()],
                        )
                    })?;
                let amount = event
                    .get("base_amount")
                    .filter(|value| !value.is_null())
                    .or_else(|| event.get("amount"))
                    .and_then(crate::money::decimal)
                    .unwrap_or(Decimal::ZERO);
                if amount <= Decimal::ZERO {
                    return Err(crate::error::ApiError::validation(
                        "accounting.payment",
                        vec!["Disbursement payment amount must be greater than zero".into()],
                    ));
                }
                let cash = account_id(tx, tenant, cash_code).await?;
                let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
                let lines = vec![
                    journal_line_decimal(expense, amount, Decimal::ZERO)?,
                    journal_line_decimal(cash, Decimal::ZERO, amount)?,
                ];
                create_posted_journal_decimal_at(
                    kernel,
                    tx,
                    tenant,
                    event_id,
                    depth,
                    "Charity beneficiary disbursement",
                    amount,
                    "payment",
                    id,
                    lines,
                    event.get("payment_date").and_then(Value::as_str),
                )
                .await?;
                return Ok(Some(true));
            }
            if matches!(
                event.get("source").and_then(Value::as_str),
                Some("payment_refund" | "event_ticket_refund")
            ) {
                // Refund handlers already post the exact reversal of the
                // original journal. Negative payment rows preserve refund
                // history and reconciliation without posting a second journal.
                return Ok(Some(true));
            }
            if matches!(
                event.get("source").and_then(Value::as_str),
                Some("credit_note_refund" | "debit_note_refund")
            ) {
                let credit_refund =
                    event.get("source").and_then(Value::as_str) == Some("credit_note_refund");
                let method = event
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let cash_code = match method {
                    "cash" => "111",
                    "card" | "transfer" | "ewallet" | "bank" => "112",
                    _ => {
                        return Err(crate::error::ApiError::validation(
                            event_type,
                            vec![
                                "Adjustment refund requires a valid cash or bank settlement method"
                                    .into(),
                            ],
                        ));
                    }
                };
                let cash = account_id(tx, tenant, cash_code).await?;
                let control =
                    account_id(tx, tenant, if credit_refund { "131" } else { "331" }).await?;
                let cash_amount = decimal_field(event, "base_amount")
                    .unwrap_or(Decimal::ZERO)
                    .abs();
                let applied_amount = decimal_field(event, "applied_base_amount")
                    .unwrap_or(cash_amount)
                    .abs();
                if cash_amount <= Decimal::ZERO || applied_amount <= Decimal::ZERO {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Refund base-currency amounts must be positive".into()],
                    ));
                }
                let difference = cash_amount.checked_sub(applied_amount).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Refund exchange difference exceeds the supported range".into()],
                    )
                })?;
                let mut lines = if credit_refund {
                    vec![
                        journal_line_decimal(control, applied_amount, Decimal::ZERO)?,
                        journal_line_decimal(cash, Decimal::ZERO, cash_amount)?,
                    ]
                } else {
                    vec![
                        journal_line_decimal(cash, cash_amount, Decimal::ZERO)?,
                        journal_line_decimal(control, Decimal::ZERO, applied_amount)?,
                    ]
                };
                if difference > amount_tolerance() {
                    let fx = ensure_account(
                        kernel,
                        tx,
                        tenant,
                        if credit_refund { "635" } else { "515" },
                        if credit_refund {
                            "Foreign exchange loss"
                        } else {
                            "Foreign exchange gain"
                        },
                        if credit_refund { "expense" } else { "revenue" },
                    )
                    .await?;
                    lines.push(if credit_refund {
                        journal_line_decimal(fx, difference, Decimal::ZERO)?
                    } else {
                        journal_line_decimal(fx, Decimal::ZERO, difference)?
                    });
                } else if difference < -amount_tolerance() {
                    let gain_or_loss = Decimal::ZERO.checked_sub(difference).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Refund exchange difference exceeds the supported range".into()],
                        )
                    })?;
                    let fx = ensure_account(
                        kernel,
                        tx,
                        tenant,
                        if credit_refund { "515" } else { "635" },
                        if credit_refund {
                            "Foreign exchange gain"
                        } else {
                            "Foreign exchange loss"
                        },
                        if credit_refund { "revenue" } else { "expense" },
                    )
                    .await?;
                    lines.push(if credit_refund {
                        journal_line_decimal(fx, Decimal::ZERO, gain_or_loss)?
                    } else {
                        journal_line_decimal(fx, gain_or_loss, Decimal::ZERO)?
                    });
                }
                let payment_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
                create_posted_journal_decimal_at(
                    kernel,
                    tx,
                    tenant,
                    event_id,
                    depth,
                    if credit_refund {
                        "Customer credit note cash refund"
                    } else {
                        "Supplier debit note reimbursement"
                    },
                    cash_amount,
                    "payment",
                    payment_id,
                    lines,
                    event.get("payment_date").and_then(Value::as_str),
                )
                .await?;
                return Ok(Some(true));
            }
            if event.get("source").and_then(Value::as_str) == Some("repayment") {
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
                            vec!["Loan repayment requires cash or bank method".into()],
                        ));
                    }
                };
                let amount = decimal_field(event, "amount").unwrap_or(Decimal::ZERO);
                let principal =
                    decimal_field(event, "principal_component").unwrap_or(Decimal::ZERO);
                let interest = decimal_field(event, "interest_component").unwrap_or(Decimal::ZERO);
                let components = principal.checked_add(interest);
                if amount <= Decimal::ZERO
                    || principal <= Decimal::ZERO
                    || interest < Decimal::ZERO
                    || !components.is_some_and(|components| {
                        crate::money::within_tolerance(amount, components, amount_tolerance())
                    })
                {
                    return Err(crate::error::ApiError::validation(
                        event_type,
                        vec!["Loan repayment amount must equal its principal and interest components".into()],
                    ));
                }
                let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
                let cash = account_id(tx, tenant, cash_code).await?;
                let receivable =
                    ensure_account(kernel, tx, tenant, "138", "Phải thu cho vay", "asset").await?;
                let interest_income = ensure_account(
                    kernel,
                    tx,
                    tenant,
                    "515",
                    "Doanh thu hoạt động tài chính - lãi cho vay",
                    "revenue",
                )
                .await?;
                let mut lines = vec![
                    journal_line_decimal(cash, amount, Decimal::ZERO)?,
                    journal_line_decimal(receivable, Decimal::ZERO, principal)?,
                ];
                if interest > Decimal::ZERO {
                    lines.push(journal_line_decimal(
                        interest_income,
                        Decimal::ZERO,
                        interest,
                    )?);
                }
                create_posted_journal_decimal(
                    kernel,
                    tx,
                    tenant,
                    event_id,
                    depth,
                    "Thu nợ gốc và lãi vay",
                    amount,
                    "repayment",
                    id,
                    lines,
                )
                .await?;
                return Ok(Some(true));
            }
            let Some((memo, debit_code, credit_code)) = payment_posting(event) else {
                return Ok(Some(false));
            };
            let amount = decimal_field(event, "amount").unwrap_or(Decimal::ZERO);
            let base_amount = event
                .get("base_amount")
                .and_then(crate::money::decimal)
                .unwrap_or(amount);
            let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let debit = account_id(tx, tenant, debit_code).await?;
            let credit = account_id(tx, tenant, credit_code).await?;
            if base_amount <= Decimal::ZERO {
                return Err(crate::error::ApiError::validation(
                    "accounting.payment",
                    vec![
                        "Payment base-currency amount must be finite and greater than zero".into(),
                    ],
                ));
            }
            let has_invoice = event.get("invoice").is_some_and(|value| !value.is_null());
            let has_bill = event.get("bill").is_some_and(|value| !value.is_null());
            let applied_base_amount = event
                .get("applied_base_amount")
                .and_then(crate::money::decimal)
                .unwrap_or(base_amount);
            let mut lines = if has_invoice {
                vec![
                    journal_line_decimal(debit, base_amount, Decimal::ZERO)?,
                    journal_line_decimal(credit, Decimal::ZERO, applied_base_amount)?,
                ]
            } else if has_bill {
                vec![
                    journal_line_decimal(debit, applied_base_amount, Decimal::ZERO)?,
                    journal_line_decimal(credit, Decimal::ZERO, base_amount)?,
                ]
            } else {
                vec![
                    journal_line_decimal(debit, base_amount, Decimal::ZERO)?,
                    journal_line_decimal(credit, Decimal::ZERO, base_amount)?,
                ]
            };
            if applied_base_amount <= Decimal::ZERO {
                return Err(crate::error::ApiError::validation(
                    "accounting.payment",
                    vec![
                        "Applied base-currency amount must be finite and greater than zero".into(),
                    ],
                ));
            }
            if has_invoice || has_bill {
                let difference = if has_invoice {
                    base_amount.checked_sub(applied_base_amount)
                } else {
                    applied_base_amount.checked_sub(base_amount)
                }
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "accounting.payment",
                        vec![
                            "Foreign exchange difference exceeds the supported decimal range"
                                .into(),
                        ],
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
                    let loss = ensure_account(
                        kernel,
                        tx,
                        tenant,
                        "635",
                        "Foreign exchange loss",
                        "expense",
                    )
                    .await?;
                    let loss_amount = Decimal::ZERO.checked_sub(difference).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "accounting.payment",
                            vec![
                                "Foreign exchange loss exceeds the supported decimal range".into(),
                            ],
                        )
                    })?;
                    lines.push(journal_line_decimal(loss, loss_amount, Decimal::ZERO)?);
                }
            }
            if matches!(
                event.get("source").and_then(Value::as_str),
                Some("ticket" | "pos_order" | "table_order")
            ) {
                let tax = event
                    .get("base_tax_amount")
                    .filter(|value| !value.is_null())
                    .or_else(|| event.get("tax_amount"))
                    .and_then(crate::money::decimal)
                    .unwrap_or(Decimal::ZERO);
                if tax < Decimal::ZERO
                    || base_amount
                        .checked_add(amount_tolerance())
                        .is_none_or(|limit| tax > limit)
                {
                    return Err(crate::error::ApiError::validation(
                        "accounting.payment",
                        vec!["Sale tax must be between zero and the payment amount".into()],
                    ));
                }
                if tax > amount_tolerance() {
                    let tax_account = tax_payable_account_id(kernel, tx, tenant).await?;
                    let taxable_base = base_amount.checked_sub(tax).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "accounting.payment",
                            vec!["Sale net amount exceeds the supported decimal range".into()],
                        )
                    })?;
                    lines[1] = journal_line_decimal(credit, Decimal::ZERO, taxable_base)?;
                    lines.push(journal_line_decimal(tax_account, Decimal::ZERO, tax)?);
                }
            }
            create_posted_journal_decimal_at(
                kernel,
                tx,
                tenant,
                event_id,
                depth,
                memo,
                base_amount,
                "payment",
                id,
                lines,
                event.get("payment_date").and_then(Value::as_str),
            )
            .await?;
            Ok(Some(true))
        }
        _ => Ok(None),
    }
}
