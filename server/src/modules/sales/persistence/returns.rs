//! Source-order, delivered-quantity, and approval checks for sales returns.
use super::decimal_column;
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "sales_return" {
        return Ok(Vec::new());
    }
    let assigning_invoice = action == "updated"
        && document
            .get("invoice")
            .is_some_and(|invoice| !invoice.is_null());
    if action == "updated" && !assigning_invoice {
        return Ok(Vec::new());
    }
    if !assigning_invoice && !matches!(action, "submitted" | "approved" | "received") {
        return Ok(Vec::new());
    }
    let Some(order_id) = document
        .get("sales_order")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Phiếu trả cần tham chiếu đơn bán hợp lệ".into()]);
    };
    let order = tx
        .query_opt(
            "SELECT status, warehouse, lines, shipping_address FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?;
    let Some(order) = order else {
        return Ok(vec![
            "Không tìm thấy đơn bán nguồn trong tenant hiện tại".into(),
        ]);
    };
    let order_status: String = order.get(0);
    let order_warehouse: Option<Uuid> = order.get(1);
    let order_lines: Value = order.get(2);
    let shipping_address: Option<String> = order.get(3);
    let mut errors = Vec::new();
    if !matches!(
        order_status.as_str(),
        "confirmed" | "partially_delivered" | "delivered"
    ) {
        errors.push("Chỉ được trả hàng từ đơn bán đã xác nhận".into());
    }
    let selected_invoice = match document.get("invoice").filter(|invoice| !invoice.is_null()) {
        Some(invoice) => match invoice.as_str().and_then(|id| Uuid::parse_str(id).ok()) {
            Some(invoice_id) => Some(invoice_id),
            None => {
                errors.push("Mã hóa đơn gốc của phiếu trả không hợp lệ".into());
                None
            }
        },
        None => None,
    };
    if let Some(invoice_id) = selected_invoice {
        if tx
            .query_opt(
                "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND id = $2 AND source = 'sales_order' AND source_id = $3 AND status IN ('posted', 'partially_paid', 'partially_settled', 'paid', 'settled') FOR SHARE",
                &[&tenant.id, &invoice_id, &order_id.to_string()],
            )
            .await?
            .is_none()
        {
            errors.push("Hóa đơn gốc phải đã ghi sổ và thuộc đúng đơn bán nguồn".into());
        }
    } else {
        let source_invoices = tx
            .query(
                "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND status IN ('posted', 'partially_paid', 'partially_settled', 'paid', 'settled') ORDER BY created_at, id LIMIT 2 FOR SHARE",
                &[&tenant.id, &order_id.to_string()],
            )
            .await?;
        match source_invoices.len() {
            0 => errors.push(
                "Cần có hóa đơn kế toán đã ghi sổ cho đơn bán trước khi gửi duyệt phiếu trả".into(),
            ),
            1 => {}
            _ => errors.push(
                "Đơn bán có nhiều hóa đơn đã ghi sổ; hãy chọn hóa đơn gốc cho phiếu trả".into(),
            ),
        }
    }
    let requires_logistics_delivery = tenant.has_module("logistics")
        && shipping_address
            .as_deref()
            .is_some_and(|address| !address.trim().is_empty());
    let return_warehouse = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    if return_warehouse != order_warehouse {
        errors.push("Kho nhận hàng trả phải khớp kho đã xuất của đơn bán".into());
    }
    let sold_lines = order_lines.as_array().cloned().unwrap_or_default();
    let return_lines = document
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut requested: HashMap<(String, Decimal, Option<String>), Decimal> = HashMap::new();
    for line in &return_lines {
        let Some(product) = line.get("product").and_then(Value::as_str) else {
            continue;
        };
        let Some(price) = line.get("price").and_then(money::decimal) else {
            continue;
        };
        let Some(qty) = line.get("qty").and_then(money::decimal) else {
            continue;
        };
        let unit = line.get("uom").and_then(Value::as_str).map(str::to_owned);
        let price_key = price.round_dp(2);
        let requested_qty = requested
            .entry((product.to_string(), price_key, unit))
            .or_insert(Decimal::ZERO);
        *requested_qty = requested_qty.checked_add(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "sales.return",
                vec!["Requested return quantity exceeds the supported decimal range".into()],
            )
        })?;
    }
    let Some(return_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Could not identify the sales return record".into()]);
    };
    for ((product, price, unit), return_qty) in requested {
        let mut sold_qty = Decimal::ZERO;
        for sold in &sold_lines {
            if sold.get("product").and_then(Value::as_str) == Some(product.as_str())
                && sold.get("uom").and_then(Value::as_str) == unit.as_deref()
                && sold
                    .get("price")
                    .and_then(money::decimal)
                    .is_some_and(|sold_price| {
                        money::within_tolerance(sold_price, price, Decimal::new(5, 3))
                    })
            {
                sold_qty = sold_qty
                    .checked_add(
                        sold.get("qty")
                            .and_then(money::decimal)
                            .unwrap_or(Decimal::ZERO),
                    )
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "sales.return",
                            vec!["Sold quantity exceeds the supported decimal range".into()],
                        )
                    })?;
            }
        }
        if sold_qty == Decimal::ZERO {
            errors.push(format!(
                "Product {product} at price {price} is not present in the source sales order"
            ));
            continue;
        }
        let price_text = price.normalize().to_string();
        let prior_row = tx
            .query_opt(
                "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM sales__sales_return sr CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sr.lines, '[]'::jsonb)) AS item(line) WHERE sr.tenant_id = $1 AND sr.sales_order = $2 AND sr.id <> $3 AND sr.status IN ('submitted', 'approved', 'received') AND item.line->>'product' = $4 AND abs((item.line->>'price')::numeric - $5::text::numeric) <= 0.005 AND item.line->>'uom' IS NOT DISTINCT FROM $6",
                &[&tenant.id, &order_id, &return_id, &product, &price_text, &unit],
            )
            .await?;
        let prior = prior_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "prior return quantity"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let eligible_qty = if requires_logistics_delivery {
            let eligible_row = tx
                .query_opt(
                    "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM logistics__shipment shipment CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.delivered_lines, shipment.lines, '[]'::jsonb)) AS item(line) WHERE shipment.tenant_id = $1 AND shipment.source = 'sales_order' AND shipment.source_id = $2 AND shipment.status = 'delivered' AND item.line->>'product' = $3 AND abs((item.line->>'price')::numeric - $4::text::numeric) <= 0.005 AND item.line->>'uom' IS NOT DISTINCT FROM $5",
                    &[&tenant.id, &order_id.to_string(), &product, &price_text, &unit],
                )
                .await?;
            eligible_row
                .as_ref()
                .map(|row| decimal_column(row, 0, "eligible delivered quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO)
                .min(sold_qty)
        } else {
            sold_qty
        };
        let quantity_tolerance = Decimal::new(1, 6);
        if return_qty
            > eligible_qty
                .checked_add(quantity_tolerance)
                .unwrap_or(Decimal::MAX)
        {
            errors.push(format!(
                "Return quantity for {product} exceeds eligible delivered quantity ({eligible_qty})"
            ));
        } else if prior
            .checked_add(return_qty)
            .zip(eligible_qty.checked_add(quantity_tolerance))
            .is_none_or(|(returned, eligible)| returned > eligible)
        {
            let remaining = eligible_qty
                .checked_sub(prior)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            errors.push(format!(
                "Return quantity for {product} exceeds the remaining eligible quantity ({remaining})"
            ));
        }
    }
    if action == "approved" && tenant.has_module("workflow-approval") {
        let approved = tx
            .query_opt(
                "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'sales.sales_return' AND record_id = $2 AND status = 'approved' LIMIT 1",
                &[&tenant.id, &return_id.to_string()],
            )
            .await?
            .is_some();
        if !approved {
            errors.push(
                "Phiếu trả chỉ được duyệt sau khi yêu cầu phê duyệt chung được chấp thuận".into(),
            );
        }
    }
    Ok(errors)
}
