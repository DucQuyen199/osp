//! Purchase receipt progress and receipt-to-order matching.
use super::purchasing_quantity_error;
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

fn receipt_quantities(lines: &[Value]) -> R<HashMap<(Uuid, Decimal, Option<Uuid>), Decimal>> {
    let mut quantities = HashMap::new();
    for line in lines {
        let (Some(product), Some(price), Some(qty)) = (
            line.get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            line.get("price").and_then(money::decimal),
            line.get("qty").and_then(money::decimal),
        ) else {
            continue;
        };
        let unit = line
            .get("uom")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let quantity = quantities
            .entry((product, price, unit))
            .or_insert(Decimal::ZERO);
        *quantity = quantity
            .checked_add(qty)
            .ok_or_else(purchasing_quantity_error)?;
    }
    Ok(quantities)
}
pub(super) async fn validate_receipt_progress(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(order_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Purchase order requires a valid id".into()]);
    };
    let order = tx
        .query_opt(
            "SELECT lines FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?;
    let Some(order) = order else {
        return Ok(vec!["Purchase order was not found for this tenant".into()]);
    };
    let ordered_lines: Value = order.get(0);
    let ordered = receipt_quantities(
        ordered_lines
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default(),
    )?;
    let receipts = tx
        .query(
            "SELECT lines FROM purchasing__purchase_receipt WHERE tenant_id = $1 AND purchase_order = $2 AND status = 'received'",
            &[&tenant.id, &order_id],
        )
        .await?;
    let mut received = HashMap::<(Uuid, Decimal, Option<Uuid>), Decimal>::new();
    for row in receipts {
        let lines: Value = row.get(0);
        for (key, qty) in
            receipt_quantities(lines.as_array().map(Vec::as_slice).unwrap_or_default())?
        {
            let received_qty = received.entry(key).or_insert(Decimal::ZERO);
            *received_qty = received_qty
                .checked_add(qty)
                .ok_or_else(purchasing_quantity_error)?;
        }
    }
    let mut total_ordered = Decimal::ZERO;
    let mut total_received = Decimal::ZERO;
    let mut over_received = false;
    let mut complete = !ordered.is_empty();
    let tolerance = Decimal::new(1, 6);
    for (key, quantity) in &ordered {
        total_ordered = total_ordered
            .checked_add(*quantity)
            .ok_or_else(purchasing_quantity_error)?;
        let received_qty = received.get(key).copied().unwrap_or(Decimal::ZERO);
        total_received = total_received
            .checked_add(received_qty)
            .ok_or_else(purchasing_quantity_error)?;
        if quantity
            .checked_add(tolerance)
            .is_none_or(|maximum| received_qty > maximum)
        {
            over_received = true;
        }
        if !received_qty
            .checked_add(tolerance)
            .is_some_and(|amount| amount >= *quantity)
        {
            complete = false;
        }
    }
    let mut errors = Vec::new();
    if over_received
        || total_ordered
            .checked_add(tolerance)
            .is_none_or(|maximum| total_received > maximum)
    {
        errors.push("Received quantities exceed the approved purchase order".into());
    }
    if action == "partially_received" && (total_received <= tolerance || complete) {
        errors.push(
            "A purchase order is partially received only while some approved quantity remains"
                .into(),
        );
    }
    if action == "received" && (!complete || total_received <= tolerance) {
        errors.push(
            "A purchase order can be received only after every line quantity has arrived".into(),
        );
    }
    Ok(errors)
}
pub(super) async fn validate_receipt_received(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(order_id) = document
        .get("purchase_order")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec![
            "Purchase receipt requires a valid purchase order".into(),
        ]);
    };
    let order = tx
        .query_opt(
            "SELECT status, warehouse, lines FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?;
    let Some(order) = order else {
        return Ok(vec!["Purchase order was not found for this tenant".into()]);
    };
    let order_status: String = order.get(0);
    let order_warehouse: Option<Uuid> = order.get(1);
    let order_lines: Value = order.get(2);
    let receipt_warehouse = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(receipt_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Purchase receipt requires a valid id".into()]);
    };
    let mut errors = Vec::new();
    if !matches!(order_status.as_str(), "approved" | "partially_received") {
        errors.push(
            "Only an approved purchase order with remaining quantity can receive goods".into(),
        );
    }
    if receipt_warehouse != order_warehouse {
        errors.push("Receipt warehouse must match the purchase order warehouse".into());
    }
    let ordered = receipt_quantities(
        order_lines
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default(),
    )?;
    let prior_receipts = tx
        .query(
            "SELECT lines FROM purchasing__purchase_receipt WHERE tenant_id = $1 AND purchase_order = $2 AND id <> $3 AND status = 'received'",
            &[&tenant.id, &order_id, &receipt_id],
        )
        .await?;
    let mut received = HashMap::<(Uuid, Decimal, Option<Uuid>), Decimal>::new();
    for row in prior_receipts {
        let lines: Value = row.get(0);
        for (key, qty) in
            receipt_quantities(lines.as_array().map(Vec::as_slice).unwrap_or_default())?
        {
            let received_qty = received.entry(key).or_insert(Decimal::ZERO);
            *received_qty = received_qty
                .checked_add(qty)
                .ok_or_else(purchasing_quantity_error)?;
        }
    }
    let receipt_lines = document
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested = receipt_quantities(&receipt_lines)?;
    let tolerance = Decimal::new(1, 6);
    for (index, line) in receipt_lines.iter().enumerate() {
        let product = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let price = line.get("price").and_then(money::decimal);
        let qty = line.get("qty").and_then(money::decimal);
        let (Some(product), Some(price), Some(qty)) = (product, price, qty) else {
            continue;
        };
        let unit = line
            .get("uom")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let key = (product, price, unit);
        let purchased_qty = ordered.get(&key).copied().unwrap_or(Decimal::ZERO);
        if purchased_qty <= Decimal::ZERO {
            errors.push(format!(
                "Receipt line {} does not match a purchase order product, unit, and price",
                index + 1
            ));
            continue;
        }
        let prior_qty = received.get(&key).copied().unwrap_or(Decimal::ZERO);
        let this_receipt_qty = requested.get(&key).copied().unwrap_or(Decimal::ZERO);
        if prior_qty
            .checked_add(this_receipt_qty)
            .zip(purchased_qty.checked_add(tolerance))
            .is_none_or(|(received, maximum)| received > maximum)
        {
            let remaining = purchased_qty
                .checked_sub(prior_qty)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            errors.push(format!(
                "Receipt quantity on line {} exceeds the remaining ordered quantity ({remaining})",
                index + 1
            ));
        }
        if qty <= Decimal::ZERO {
            errors.push(format!(
                "Receipt line {} quantity must be positive",
                index + 1
            ));
        }
    }
    Ok(errors)
}
