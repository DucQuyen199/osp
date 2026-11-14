use super::*;

pub(super) async fn handle(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    let amount = event
        .get("base_total")
        .filter(|value| !value.is_null())
        .or_else(|| event.get("total"))
        .and_then(crate::money::decimal)
        .unwrap_or(Decimal::ZERO);
    let tax = event
        .get("base_tax_total")
        .filter(|value| !value.is_null())
        .or_else(|| event.get("tax_total"))
        .and_then(crate::money::decimal)
        .unwrap_or(Decimal::ZERO);
    let net = amount
        .checked_sub(tax)
        .ok_or_else(|| overflow_error(event_type))?;
    if tax < Decimal::ZERO || net < -amount_tolerance() {
        return Err(crate::error::ApiError::validation(
            "accounting.bill",
            vec!["Bill tax total must be between zero and the bill total".into()],
        ));
    }
    let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
    let department = event
        .get("department")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let is_purchase_order_bill =
        event.get("source").and_then(Value::as_str) == Some("purchase_order");
    let mut lines = Vec::new();
    if is_purchase_order_bill {
        let grni = ensure_account(
            kernel,
            tx,
            tenant,
            "GRNI",
            "Hàng đã nhận chưa có hóa đơn",
            "liability",
        )
        .await?;
        let purchase_order_id = event
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.bill",
                    vec!["Purchase order bill requires a valid source order id".into()],
                )
            })?;
        let accrued = tx
                    .query_one_row(
                        r#"SELECT (
                            COALESCE((
                                SELECT SUM((posting.line->>'credit')::numeric - (posting.line->>'debit')::numeric)
                                FROM purchasing__purchase_receipt pr
                                JOIN inventory__stock_move sm ON sm.tenant_id=pr.tenant_id AND sm.source='purchase_receipt' AND sm.source_id=pr.id::text AND sm.direction='in'
                                JOIN accounting__journal_entry j ON j.tenant_id=sm.tenant_id AND j.source='stock_move' AND j.source_id=sm.id::text AND j.status='posted'
                                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.lines,'[]'::jsonb)) AS posting(line)
                                JOIN accounting__account a ON a.tenant_id=j.tenant_id AND a.id::text=posting.line->>'account' AND a.code='GRNI'
                                WHERE pr.tenant_id=$1 AND pr.purchase_order=$2 AND pr.status='received'
                            ),0)
                            - COALESCE((
                                SELECT SUM((posting.line->>'debit')::numeric - (posting.line->>'credit')::numeric)
                                FROM inventory__stock_move sm
                                JOIN accounting__journal_entry j ON j.tenant_id=sm.tenant_id AND j.source='stock_move' AND j.source_id=sm.id::text AND j.status='posted'
                                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.lines,'[]'::jsonb)) AS posting(line)
                                JOIN accounting__account a ON a.tenant_id=j.tenant_id AND a.id::text=posting.line->>'account' AND a.code='GRNI'
                                JOIN purchasing__purchase_return pr ON pr.tenant_id=sm.tenant_id AND ((sm.source='purchase_return' AND pr.id::text=sm.source_id) OR (sm.source='quality_return' AND pr.inspection::text=sm.source_id))
                                WHERE pr.tenant_id=$1 AND pr.purchase_order=$2 AND pr.status='dispatched' AND sm.direction='out' AND sm.source IN ('purchase_return','quality_return')
                            ),0)
                            - COALESCE((
                                SELECT SUM((posting.line->>'debit')::numeric - (posting.line->>'credit')::numeric)
                                FROM accounting__bill b
                                JOIN accounting__journal_entry j ON j.tenant_id=b.tenant_id AND j.source='bill' AND j.source_id=b.id::text AND j.status='posted'
                                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.lines,'[]'::jsonb)) AS posting(line)
                                JOIN accounting__account a ON a.tenant_id=j.tenant_id AND a.id::text=posting.line->>'account' AND a.code='GRNI'
                                WHERE b.tenant_id=$1 AND b.source='purchase_order' AND b.source_id=$2::text AND b.status<>'void'
                            ),0)
                        )::text"#,
                        &[&tenant.id, &purchase_order_id],
                    )
                    .await?;
        let accrued = decimal_column(&accrued, 0)?;
        if accrued < -amount_tolerance() {
            return Err(crate::error::ApiError::validation(
                "accounting.bill",
                vec!["Purchase receipt clearing balance is invalid".into()],
            ));
        }
        let supplier_invoice_id = event
            .get("supplier_invoice_id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let clear_amount = if supplier_invoice_id.is_some() {
            let matched = event
                .get("grni_match_amount")
                .and_then(crate::money::decimal)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "accounting.bill",
                        vec!["Supplier-invoice bill requires its matched receipt value".into()],
                    )
                })?;
            let max_match = accrued
                .checked_add(amount_tolerance())
                .ok_or_else(|| overflow_error(event_type))?;
            if matched < Decimal::ZERO || matched > max_match {
                return Err(crate::error::ApiError::validation(
                    "accounting.bill",
                    vec!["Matched receipt value exceeds the remaining GRNI balance".into()],
                ));
            }
            matched.min(accrued.max(Decimal::ZERO))
        } else {
            net.min(accrued.max(Decimal::ZERO))
        };
        if clear_amount > amount_tolerance() {
            lines.push(journal_line_decimal_with_department(
                grni,
                clear_amount,
                Decimal::ZERO,
                department,
            )?);
        }
        if supplier_invoice_id.is_some() {
            let mut adjustment_net = Decimal::ZERO;
            if let Some(adjustments) = event.get("purchase_adjustments").and_then(Value::as_array) {
                for adjustment in adjustments {
                    let kind = adjustment
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let amount = adjustment
                        .get("base_amount")
                        .filter(|value| !value.is_null())
                        .or_else(|| adjustment.get("amount"))
                        .and_then(crate::money::decimal)
                        .ok_or_else(|| {
                            crate::error::ApiError::validation(
                                "accounting.bill",
                                vec!["Supplier invoice adjustment amount is invalid".into()],
                            )
                        })?;
                    let code = adjustment
                        .get("account_code")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if amount <= Decimal::ZERO || !matches!(kind, "charge" | "discount") {
                        return Err(crate::error::ApiError::validation(
                            "accounting.bill",
                            vec!["Supplier invoice adjustment is invalid".into()],
                        ));
                    }
                    let sign = if kind == "discount" {
                        Decimal::NEGATIVE_ONE
                    } else {
                        Decimal::ONE
                    };
                    let signed_amount = amount
                        .checked_mul(sign)
                        .ok_or_else(|| overflow_error(event_type))?;
                    adjustment_net = adjustment_net
                        .checked_add(signed_amount)
                        .ok_or_else(|| overflow_error(event_type))?;
                    if code != "632" {
                        return Err(crate::error::ApiError::validation(
                            "accounting.bill",
                            vec!["Supplier invoice adjustment account is invalid".into()],
                        ));
                    }
                    let account =
                        ensure_account(kernel, tx, tenant, "632", "Chênh lệch giá mua", "expense")
                            .await?;
                    if signed_amount > Decimal::ZERO {
                        lines.push(journal_line_decimal_with_department(
                            account,
                            signed_amount,
                            Decimal::ZERO,
                            department,
                        )?);
                    } else {
                        lines.push(journal_line_decimal_with_department(
                            account,
                            Decimal::ZERO,
                            signed_amount.abs(),
                            department,
                        )?);
                    }
                }
            }
            let variance = net
                .checked_sub(clear_amount)
                .and_then(|value| value.checked_sub(adjustment_net))
                .ok_or_else(|| overflow_error(event_type))?;
            if variance.abs() > amount_tolerance() {
                let price_variance =
                    ensure_account(kernel, tx, tenant, "632", "Chênh lệch giá mua", "expense")
                        .await?;
                if variance > Decimal::ZERO {
                    lines.push(journal_line_decimal_with_department(
                        price_variance,
                        variance,
                        Decimal::ZERO,
                        department,
                    )?);
                } else {
                    lines.push(journal_line_decimal_with_department(
                        price_variance,
                        Decimal::ZERO,
                        variance.abs(),
                        department,
                    )?);
                }
            }
        } else {
            let unaccrued_amount = net
                .checked_sub(clear_amount)
                .ok_or_else(|| overflow_error(event_type))?
                .max(Decimal::ZERO);
            if unaccrued_amount > amount_tolerance() {
                let inventory = account_id(tx, tenant, "156").await?;
                lines.push(journal_line_decimal_with_department(
                    inventory,
                    unaccrued_amount,
                    Decimal::ZERO,
                    department,
                )?);
            }
        }
    } else if net > amount_tolerance() {
        let inventory = account_id(tx, tenant, "156").await?;
        lines.push(journal_line_decimal_with_department(
            inventory,
            net,
            Decimal::ZERO,
            department,
        )?);
    }
    let payable = account_id(tx, tenant, "331").await?;
    if tax > amount_tolerance() {
        let input_tax = ensure_account(
            kernel,
            tx,
            tenant,
            "1331",
            "Thuế giá trị gia tăng được khấu trừ",
            "asset",
        )
        .await?;
        lines.push(journal_line_decimal_with_department(
            input_tax,
            tax,
            Decimal::ZERO,
            department,
        )?);
    }
    lines.push(journal_line_decimal(payable, Decimal::ZERO, amount)?);
    create_posted_journal_decimal_at(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Ghi nhận công nợ mua hàng",
        amount,
        "bill",
        id,
        lines,
        event.get("issue_date").and_then(Value::as_str),
    )
    .await?;
    Ok(Some(true))
}
