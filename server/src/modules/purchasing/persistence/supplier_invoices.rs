//! Supplier invoice approval requires a fully received, matching purchase order.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn amount(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
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
        "SELECT supplier, total::text, COALESCE(tax_total,0)::text, status, department FROM purchasing__purchase_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &order_id],
    ).await? else {
        return Ok(vec!["Purchase order was not found for this tenant".into()]);
    };
    let order_supplier: Uuid = order.get(0);
    let total_text: String = order.get(1);
    let tax_text: String = order.get(2);
    let order_status: String = order.get(3);
    let order_department: Option<Uuid> = order.get(4);
    let mut errors = Vec::new();
    if order_status != "received" {
        errors.push(
            "Supplier invoices can only be recorded after the order is fully received".into(),
        );
    }
    if order_supplier != supplier_id {
        errors.push("Supplier on the invoice must match the purchase order".into());
    }
    let invoice_department = id(document, "department");
    if invoice_department != order_department {
        errors.push("Department on the supplier invoice must match the purchase order".into());
    }
    let invoice_id = id(document, "id").unwrap_or(Uuid::nil());
    let invoice_number = document
        .get("invoice_number")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if tx.query_opt(
        "SELECT id FROM purchasing__supplier_invoice WHERE tenant_id=$1 AND supplier=$2 AND upper(trim(invoice_number))=upper($3) AND id<>$4 LIMIT 1 FOR UPDATE",
        &[&tenant.id, &supplier_id, &invoice_number, &invoice_id],
    ).await?.is_some() {
        errors.push("Supplier invoice number already exists for this supplier".into());
    }
    if tx.query_opt(
        "SELECT id FROM purchasing__supplier_invoice WHERE tenant_id=$1 AND purchase_order=$2 AND id<>$3 LIMIT 1 FOR UPDATE",
        &[&tenant.id, &order_id, &invoice_id],
    ).await?.is_some() {
        errors.push("This purchase order already has a supplier invoice record".into());
    }
    if action == "approved" {
        let total = money::decimal_str(&total_text).ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.total",
                vec!["Purchase order total is invalid".into()],
            )
        })?;
        let tax = money::decimal_str(&tax_text).ok_or_else(|| {
            ApiError::validation(
                "purchasing.supplier_invoice.tax_total",
                vec!["Purchase order tax is invalid".into()],
            )
        })?;
        if !amount(document, "total")
            .is_some_and(|value| money::within_tolerance(value, total, Decimal::new(5, 3)))
        {
            errors
                .push("Supplier invoice total must match the fully received purchase order".into());
        }
        if !amount(document, "tax_total")
            .is_some_and(|value| money::within_tolerance(value, tax, Decimal::new(5, 3)))
        {
            errors.push("Supplier invoice tax must match the purchase order tax".into());
        }
        if tx.query_opt(
            "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND status<>'void' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &order_id.to_string()],
        ).await?.is_some() {
            errors.push("This purchase order already has a payable bill".into());
        }
        if tx.query_opt(
            "SELECT id FROM purchasing__supplier_invoice WHERE tenant_id=$1 AND purchase_order=$2 AND status='approved' AND id<>$3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &order_id, &invoice_id],
        ).await?.is_some() {
            errors.push("This purchase order already has an approved supplier invoice".into());
        }
    }
    Ok(errors)
}
