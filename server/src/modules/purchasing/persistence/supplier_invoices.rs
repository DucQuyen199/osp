//! Supplier invoices are matched cumulatively to received quantities and GRNI.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

type LineKey = (Uuid, Decimal, Decimal);

fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn amount(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

fn add_lines(
    totals: &mut BTreeMap<LineKey, Decimal>,
    lines: &Value,
    supplier_invoice: bool,
) -> R<()> {
    let Some(lines) = lines.as_array() else {
        return Err(ApiError::validation(
            "purchasing.supplier_invoice.lines",
            vec!["Invoice and receipt lines must be arrays".into()],
        ));
    };
    for line in lines {
        let product = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let price = line
            .get(if supplier_invoice {
                "po_price"
            } else {
                "price"
            })
            .and_then(money::decimal);
        let invoice_price = line.get("price").and_then(money::decimal);
        let tax_rate = line
            .get("tax_rate")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let qty = line.get("qty").and_then(money::decimal);
        let (Some(product), Some(price), Some(qty)) = (product, price, qty) else {
            return Err(ApiError::validation(
                "purchasing.supplier_invoice.lines",
                vec!["Invoice and receipt line values are invalid".into()],
            ));
        };
        if price < Decimal::ZERO
            || invoice_price.is_none_or(|value| value < Decimal::ZERO)
            || !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&tax_rate)
            || qty <= Decimal::ZERO
        {
            return Err(ApiError::validation(
                "purchasing.supplier_invoice.lines",
                vec![
                    "Invoice and receipt quantities must be positive with nonnegative prices"
                        .into(),
                ],
            ));
        }
        let current = totals
            .entry((product, price, Decimal::ZERO))
            .or_insert(Decimal::ZERO);
        *current = current.checked_add(qty).ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.lines",
                vec!["Cumulative quantity exceeds the supported range".into()],
            )
        })?;
    }
    Ok(())
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(order_id) = id(document, "purchase_order") else {
        return Ok(vec![
            "Supplier invoice requires a valid purchase order".into(),
        ]);
    };
    let Some(supplier_id) = id(document, "supplier") else {
        return Ok(vec!["Supplier invoice requires a valid supplier".into()]);
    };
    let Some(order) = tx.query_opt(
        "SELECT supplier, status, department FROM purchasing__purchase_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &order_id],
    ).await? else {
        return Ok(vec!["Purchase order was not found for this tenant".into()]);
    };
    let order_supplier: Uuid = order.get(0);
    let order_status: String = order.get(1);
    let order_department: Option<Uuid> = order.get(2);
    let mut errors = Vec::new();
    if !matches!(order_status.as_str(), "partially_received" | "received") {
        errors.push(
            "Supplier invoices can only be recorded against an order with received goods".into(),
        );
    }
    if order_supplier != supplier_id {
        errors.push("Supplier on the invoice must match the purchase order".into());
    }
    if id(document, "department") != order_department {
        errors.push("Department on the supplier invoice must match the purchase order".into());
    }

    let invoice_id = id(document, "id").unwrap_or(Uuid::nil());
    let invoice_number = document
        .get("invoice_number")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    // A row lock cannot protect the empty result of a uniqueness query. Serialize
    // checks for the same normalized supplier number so concurrent approvals on
    // different purchase orders cannot both create the same payable invoice.
    let invoice_number_lock = format!(
        "purchasing.supplier_invoice.number:{}:{}:{invoice_number}",
        tenant.id, supplier_id
    );
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended(upper($1), 0))",
        &[&invoice_number_lock],
    )
    .await?;
    if tx.query_opt(
        "SELECT id FROM purchasing__supplier_invoice WHERE tenant_id=$1 AND supplier=$2 AND upper(trim(invoice_number))=upper($3) AND id<>$4 LIMIT 1 FOR UPDATE",
        &[&tenant.id, &supplier_id, &invoice_number, &invoice_id],
    ).await?.is_some() {
        errors.push("Supplier invoice number already exists for this supplier".into());
    }

    if action == "approved" {
        let total = amount(document, "total").ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.total",
                vec!["Prepared supplier invoice total is invalid".into()],
            )
        })?;
        let tax = amount(document, "tax_total").ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.tax_total",
                vec!["Prepared supplier invoice tax is invalid".into()],
            )
        })?;
        let matched_net = amount(document, "matched_net").ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.matched_net",
                vec!["Matched receipt value is missing".into()],
            )
        })?;
        let net = total.checked_sub(tax).ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.total",
                vec!["Supplier invoice net value is outside the supported range".into()],
            )
        })?;
        let expected_variance = net.checked_sub(matched_net).ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.price_variance",
                vec!["Supplier invoice price variance is outside the supported range".into()],
            )
        })?;
        if total <= Decimal::ZERO
            || tax < Decimal::ZERO
            || tax > total
            || matched_net < Decimal::ZERO
        {
            errors.push("Supplier invoice total, tax, or matched receipt value is invalid".into());
        }
        if !amount(document, "price_variance").is_some_and(|variance| variance == expected_variance)
        {
            errors.push(
                "Supplier invoice price variance must equal invoice net less matched receipt value"
                    .into(),
            );
        }
        let receipts = tx.query(
            "SELECT lines FROM purchasing__purchase_receipt WHERE tenant_id=$1 AND purchase_order=$2 AND status='received' FOR UPDATE",
            &[&tenant.id, &order_id],
        ).await?;
        let mut received = BTreeMap::new();
        for receipt in receipts {
            let lines: Value = receipt.get(0);
            add_lines(&mut received, &lines, false)?;
        }

        let returns = tx.query(
            "SELECT lines FROM purchasing__purchase_return WHERE tenant_id=$1 AND purchase_order=$2 AND status='dispatched' FOR UPDATE",
            &[&tenant.id, &order_id],
        ).await?;
        let mut returned = BTreeMap::new();
        for purchase_return in returns {
            let lines: Value = purchase_return.get(0);
            add_lines(&mut returned, &lines, false)?;
        }
        for (key, qty) in returned {
            let available = received.entry(key).or_insert(Decimal::ZERO);
            *available = available
                .checked_sub(qty)
                .ok_or_else(|| {
                    ApiError::validation(
                        "purchasing.supplier_invoice.received",
                        vec!["Returned quantity exceeds the received balance".into()],
                    )
                })?
                .max(Decimal::ZERO);
        }

        let prior = tx.query(
            "SELECT lines FROM purchasing__supplier_invoice WHERE tenant_id=$1 AND purchase_order=$2 AND status='approved' AND id<>$3 FOR UPDATE",
            &[&tenant.id, &order_id, &invoice_id],
        ).await?;
        let mut billed = BTreeMap::new();
        for invoice in prior {
            let lines: Value = invoice.get(0);
            add_lines(&mut billed, &lines, true)?;
        }
        let Some(current_lines) = document.get("lines") else {
            return Ok(vec![
                "Supplier invoice requires at least one matched line".into(),
            ]);
        };
        add_lines(&mut billed, current_lines, true)?;
        if billed.is_empty()
            || billed.iter().any(|(key, qty)| {
                received
                    .get(key)
                    .copied()
                    .unwrap_or_default()
                    .checked_add(Decimal::new(1, 6))
                    .is_none_or(|limit| *qty > limit)
            })
        {
            errors.push("Cumulative supplier invoice quantities cannot exceed quantities received at the same unit prices".into());
        }
        if tx.query_opt(
            "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND supplier_invoice_id IS NULL AND status<>'void' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &order_id.to_string()],
        ).await?.is_some() {
            errors.push("This order already has a legacy payable bill without supplier invoice matching".into());
        }
    }
    Ok(errors)
}
