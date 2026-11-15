use super::*;

pub(super) async fn handle_void(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    let (source_kind, document_label) = match event_type {
        "accounting.invoice.void" => ("invoice", "Hóa đơn bán"),
        "accounting.bill.void" => ("bill", "Hóa đơn mua"),
        _ => return Ok(None),
    };
    let document_id = event
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec![format!("{document_label} bị hủy cần mã hợp lệ")],
            )
        })?;
    let journals = tx
        .query(
            "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND source = $2 AND source_id = $3 AND status = 'posted' ORDER BY created_at, id FOR UPDATE",
            &[&tenant.id, &source_kind, &document_id.to_string()],
        )
        .await?;
    let entity = kernel.ent(tenant, "accounting.journal_entry")?;
    for journal in journals {
        let journal_id: Uuid = journal.get(0);
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &journal_id.to_string(),
                "reversed",
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
    let revenue_amount = amount
        .checked_sub(tax)
        .ok_or_else(|| overflow_error(event_type))?;
    if tax < Decimal::ZERO || revenue_amount < -amount_tolerance() {
        return Err(crate::error::ApiError::validation(
            "accounting.invoice",
            vec!["Invoice tax total must be between zero and the invoice total".into()],
        ));
    }
    let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
    let receivable = account_id(tx, tenant, "131").await?;
    let revenue = account_id(tx, tenant, "511").await?;
    let mut lines = vec![journal_line_decimal(receivable, amount, Decimal::ZERO)?];
    if revenue_amount > amount_tolerance() {
        lines.push(journal_line_decimal(
            revenue,
            Decimal::ZERO,
            revenue_amount,
        )?);
    }
    if tax > amount_tolerance() {
        let tax_account = tax_payable_account_id(kernel, tx, tenant).await?;
        lines.push(journal_line_decimal(tax_account, Decimal::ZERO, tax)?);
    }
    create_posted_journal_decimal_at(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        "Ghi nhận doanh thu hóa đơn",
        amount,
        "invoice",
        id,
        lines,
        event.get("issue_date").and_then(Value::as_str),
    )
    .await?;
    Ok(Some(true))
}
