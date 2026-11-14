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
    let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
    let tax = if event_type == "accounting.credit_note.posted"
        || event_type == "accounting.debit_note.posted"
    {
        event
            .get("base_tax_total")
            .filter(|value| !value.is_null())
            .or_else(|| event.get("tax_total"))
            .and_then(crate::money::decimal)
            .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    let net_amount = amount
        .checked_sub(tax)
        .ok_or_else(|| overflow_error(event_type))?;
    if tax < Decimal::ZERO || net_amount < -amount_tolerance() {
        return Err(crate::error::ApiError::validation(
            "accounting.credit_note",
            vec!["Credit note tax total must be between zero and the note total".into()],
        ));
    }
    let mut lines = Vec::new();
    let (memo, source) = if event_type == "accounting.credit_note.posted" {
        let debit = account_id(tx, tenant, "511").await?;
        let credit = account_id(tx, tenant, "131").await?;
        if net_amount > amount_tolerance() {
            lines.push(journal_line_decimal(debit, net_amount, Decimal::ZERO)?);
        }
        if tax > amount_tolerance() {
            let tax_account = tax_payable_account_id(kernel, tx, tenant).await?;
            lines.push(journal_line_decimal(tax_account, tax, Decimal::ZERO)?);
        }
        lines.push(journal_line_decimal(credit, Decimal::ZERO, amount)?);
        ("Điều chỉnh giảm doanh thu hàng bán trả lại", "credit_note")
    } else {
        let debit = account_id(tx, tenant, "331").await?;
        let inventory = account_id(tx, tenant, "156").await?;
        let department = event
            .get("department")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let source_id = event
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.debit_note",
                    vec!["Purchase debit note requires its return document id".into()],
                )
            })?;
        let returned_cost = tx
                    .query_opt(
                        "SELECT SUM(sm.total_cost)::text FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND sm.direction = 'out' AND ((sm.source = 'purchase_return' AND sm.source_id = $2) OR (sm.source = 'quality_return' AND sm.source_id = (SELECT pr.inspection::text FROM purchasing__purchase_return pr WHERE pr.tenant_id = $1 AND pr.id::text = $2)))",
                        &[&tenant.id, &source_id.to_string()],
                    )
                    .await?;
        let returned_cost = match returned_cost {
            Some(row) => {
                let value: Option<String> = row.get(0);
                value
                            .map(|value| crate::money::decimal_str(&value).ok_or_else(|| {
                                crate::error::ApiError::validation(
                                    "accounting.debit_note",
                                    vec!["Returned inventory valuation exceeds the supported decimal range".into()],
                                )
                            }))
                            .transpose()?
            }
            None => None,
        };
        let inventory_cost = returned_cost.unwrap_or(net_amount);
        if inventory_cost < Decimal::ZERO {
            return Err(crate::error::ApiError::validation(
                "accounting.debit_note",
                vec!["Returned inventory has an invalid FIFO valuation".into()],
            ));
        }
        if amount > amount_tolerance() {
            lines.push(journal_line_decimal(debit, amount, Decimal::ZERO)?);
        }
        if tax > amount_tolerance() {
            let tax_account = ensure_account(
                kernel,
                tx,
                tenant,
                "1331",
                "Thuế giá trị gia tăng được khấu trừ",
                "asset",
            )
            .await?;
            lines.push(journal_line_decimal(tax_account, Decimal::ZERO, tax)?);
        }
        if inventory_cost > amount_tolerance() {
            lines.push(journal_line_decimal_with_department(
                inventory,
                Decimal::ZERO,
                inventory_cost,
                department,
            )?);
        }
        let valuation_variance = net_amount
            .checked_sub(inventory_cost)
            .ok_or_else(|| overflow_error(event_type))?;
        if valuation_variance > amount_tolerance() {
            let gain = ensure_account(
                kernel,
                tx,
                tenant,
                "711",
                "Thu nhập khác do hoàn trả hàng tồn kho",
                "revenue",
            )
            .await?;
            lines.push(journal_line_decimal_with_department(
                gain,
                Decimal::ZERO,
                valuation_variance,
                department,
            )?);
        } else if valuation_variance < -amount_tolerance() {
            let loss = ensure_account(
                kernel,
                tx,
                tenant,
                "632",
                "Giá vốn hàng bán và chênh lệch hàng trả",
                "expense",
            )
            .await?;
            let loss_amount = Decimal::ZERO
                .checked_sub(valuation_variance)
                .ok_or_else(|| overflow_error(event_type))?;
            lines.push(journal_line_decimal_with_department(
                loss,
                loss_amount,
                Decimal::ZERO,
                department,
            )?);
        }
        ("Điều chỉnh giảm công nợ hàng mua trả lại", "debit_note")
    };
    create_posted_journal_decimal(
        kernel, tx, tenant, event_id, depth, memo, amount, source, id, lines,
    )
    .await?;
    Ok(Some(true))
}
