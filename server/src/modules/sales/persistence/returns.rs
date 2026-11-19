//! Source-order, delivered-quantity, and approval checks for sales returns.
use super::decimal_column;
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

type ReturnLineKey = (
    String,
    Decimal,
    Option<String>,
    Decimal,
    Option<String>,
    Decimal,
);

fn discount_pct(line: &Value) -> Decimal {
    line.get("effective_discount_pct")
        .or_else(|| line.get("discount_pct"))
        .and_then(money::decimal)
        .unwrap_or_default()
}

fn tax_id(line: &Value) -> Option<String> {
    line.get("tax").and_then(Value::as_str).map(str::to_owned)
}

fn tax_rate(line: &Value) -> Decimal {
    line.get("tax_rate")
        .and_then(money::decimal)
        .unwrap_or_default()
}

fn line_quantities(lines: &Value, source: &str) -> R<HashMap<ReturnLineKey, Decimal>> {
    let Some(lines) = lines.as_array() else {
        return Err(crate::error::ApiError::validation(
            "sales.return",
            vec![format!(
                "{source} lines are missing or invalid; return quantities cannot be verified"
            )],
        ));
    };
    if lines.is_empty() {
        return Err(crate::error::ApiError::validation(
            "sales.return",
            vec![format!(
                "{source} has no item lines; return quantities cannot be verified"
            )],
        ));
    }
    let mut quantities = HashMap::new();
    for (index, line) in lines.iter().enumerate() {
        let (Some(product), Some(price), Some(qty)) = (
            line.get("product").and_then(Value::as_str),
            line.get("price").and_then(money::decimal),
            line.get("qty").and_then(money::decimal),
        ) else {
            return Err(crate::error::ApiError::validation(
                "sales.return",
                vec![format!(
                    "{source} line {} is incomplete; return quantities cannot be verified",
                    index + 1
                )],
            ));
        };
        if product.trim().is_empty() || price < Decimal::ZERO || qty <= Decimal::ZERO {
            return Err(crate::error::ApiError::validation(
                "sales.return",
                vec![format!(
                    "{source} line {} has an invalid product, price, or quantity",
                    index + 1
                )],
            ));
        }
        let key = (
            product.to_owned(),
            price.round_dp(2),
            line.get("uom").and_then(Value::as_str).map(str::to_owned),
            discount_pct(line),
            tax_id(line),
            tax_rate(line),
        );
        let total = quantities.entry(key).or_insert(Decimal::ZERO);
        *total = total.checked_add(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                "sales.return",
                vec![format!(
                    "{source} line quantity exceeds the supported decimal range"
                )],
            )
        })?;
    }
    Ok(quantities)
}

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
    let assigning_invoice = action == "invoice_assigned";
    if !assigning_invoice && !matches!(action, "submitted" | "approved" | "received") {
        return Ok(Vec::new());
    }
    let current_status = document
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let transition_is_applicable = match action {
        "submitted" => matches!(current_status, "draft" | "rejected"),
        "approved" => current_status == "submitted",
        "received" => current_status == "approved",
        "invoice_assigned" => {
            matches!(
                current_status,
                "draft" | "rejected" | "submitted" | "approved"
            )
        }
        _ => false,
    };
    if !transition_is_applicable {
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
    let mut resolved_invoice = selected_invoice;
    let mut invoice_lines = None;
    let mut invoice_total = None;
    if let Some(invoice_id) = selected_invoice {
        if let Some(invoice) = tx
            .query_opt(
                "SELECT id, lines, total::text FROM accounting__invoice WHERE tenant_id = $1 AND id = $2 AND source = 'sales_order' AND source_id = $3 AND status IN ('posted', 'partially_paid', 'partially_settled', 'paid', 'settled') FOR SHARE",
                &[&tenant.id, &invoice_id, &order_id.to_string()],
            )
            .await?
        {
            invoice_lines = invoice.get::<_, Option<Value>>(1);
            invoice_total = Some(decimal_column(&invoice, 2, "source invoice total")?);
        } else {
            errors.push("Hóa đơn gốc phải đã ghi sổ và thuộc đúng đơn bán nguồn".into());
            resolved_invoice = None;
        }
    } else {
        let source_invoices = tx
            .query(
                "SELECT id, lines, total::text FROM accounting__invoice WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND status IN ('posted', 'partially_paid', 'partially_settled', 'paid', 'settled') ORDER BY created_at, id LIMIT 2 FOR SHARE",
                &[&tenant.id, &order_id.to_string()],
            )
            .await?;
        match source_invoices.len() {
            0 => errors.push(
                "Cần có hóa đơn kế toán đã ghi sổ cho đơn bán trước khi gửi duyệt phiếu trả".into(),
            ),
            1 => {
                resolved_invoice = Some(source_invoices[0].get(0));
                invoice_lines = source_invoices[0].get(1);
                invoice_total = Some(decimal_column(
                    &source_invoices[0],
                    2,
                    "source invoice total",
                )?);
            }
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
    let mut requested_lots = HashMap::<(String, String), Decimal>::new();
    for (line_index, line) in return_lines.iter().enumerate() {
        let Some(product) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let lot_tracked = tx
            .query_opt(
                "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product],
            )
            .await?
            .is_some_and(|row| row.get::<_, bool>(0));
        if !lot_tracked {
            if line.get("lot_allocations").is_some() {
                errors.push(format!(
                    "Return line {} cannot assign lots to a product that is not lot-tracked",
                    line_index + 1
                ));
            }
            continue;
        }
        let base_qty = line.get("base_qty").and_then(money::decimal);
        let allocations = line.get("lot_allocations").and_then(Value::as_array);
        let (Some(base_qty), Some(allocations)) = (base_qty, allocations) else {
            errors.push(format!(
                "Return line {} for a lot-tracked product requires original lot allocations",
                line_index + 1
            ));
            continue;
        };
        let mut allocated_qty = Decimal::ZERO;
        for allocation in allocations {
            let lot = allocation
                .get("lot")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let qty = allocation
                .get("qty")
                .and_then(money::decimal)
                .filter(|qty| *qty > Decimal::ZERO);
            let (Some(lot), Some(qty)) = (lot, qty) else {
                errors.push(format!(
                    "Return line {} has an invalid lot allocation",
                    line_index + 1
                ));
                continue;
            };
            let key = (product.to_string(), lot.to_string());
            let total = requested_lots.entry(key).or_insert(Decimal::ZERO);
            *total = total.checked_add(qty).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "sales.return",
                    vec!["Return lot quantity exceeds the supported decimal range".into()],
                )
            })?;
            allocated_qty = allocated_qty.checked_add(qty).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "sales.return",
                    vec!["Return lot quantity exceeds the supported decimal range".into()],
                )
            })?;
        }
        if (allocated_qty - base_qty).abs() > Decimal::new(1, 6) {
            errors.push(format!(
                "Return line {} lot allocation total must equal its base quantity",
                line_index + 1
            ));
        }
    }
    let mut requested: HashMap<ReturnLineKey, Decimal> = HashMap::new();
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
            .entry((
                product.to_string(),
                price_key,
                unit,
                discount_pct(line),
                tax_id(line),
                tax_rate(line),
            ))
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
    for ((product, lot), return_qty) in requested_lots {
        let sold_row = tx
            .query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND product = $3 AND lot = $4 AND direction = 'out'",
                &[&tenant.id, &order_id.to_string(), &product, &lot],
            )
            .await?;
        let sold_qty = sold_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "original lot shipment quantity"))
            .transpose()?
            .unwrap_or_default();
        let received_row = tx
            .query_opt(
                "SELECT COALESCE(SUM(move.qty::numeric), 0)::text FROM inventory__stock_move move JOIN sales__sales_return ret ON ret.tenant_id = move.tenant_id AND ret.id::text = move.source_id WHERE move.tenant_id = $1 AND ret.sales_order = $2 AND ret.id <> $3 AND ret.status = 'received' AND move.source = 'sales_return' AND move.product = $4 AND move.lot = $5 AND move.direction = 'in'",
                &[&tenant.id, &order_id, &return_id, &product, &lot],
            )
            .await?;
        let received_qty = received_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "received return lot quantity"))
            .transpose()?
            .unwrap_or_default();
        let reserved_row = tx
            .query_opt(
                "SELECT COALESCE(SUM((allocation->>'qty')::numeric), 0)::text FROM sales__sales_return ret CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ret.lines, '[]'::jsonb)) line CROSS JOIN LATERAL jsonb_array_elements(COALESCE(line->'lot_allocations', '[]'::jsonb)) allocation WHERE ret.tenant_id = $1 AND ret.sales_order = $2 AND ret.id <> $3 AND ret.status IN ('submitted', 'approved') AND line->>'product' = $4 AND allocation->>'lot' = $5",
                &[&tenant.id, &order_id, &return_id, &product, &lot],
            )
            .await?;
        let reserved_qty = reserved_row
            .as_ref()
            .map(|row| decimal_column(row, 0, "reserved return lot quantity"))
            .transpose()?
            .unwrap_or_default();
        let total_returned = received_qty
            .checked_add(reserved_qty)
            .and_then(|qty| qty.checked_add(return_qty));
        if sold_qty <= Decimal::ZERO
            || total_returned.is_none_or(|qty| qty > sold_qty + Decimal::new(1, 6))
        {
            errors.push(format!(
                "Return allocation for product {product} and lot {lot} exceeds its original sold quantity"
            ));
        }
    }
    if let Some(invoice_id) = resolved_invoice {
        let return_total = document
            .get("total")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let posted_credit = tx
            .query_opt(
                "SELECT COALESCE(SUM(total), 0)::text FROM accounting__credit_note WHERE tenant_id = $1 AND invoice = $2 AND status = 'posted'",
                &[&tenant.id, &invoice_id],
            )
            .await?
            .map(|row| decimal_column(&row, 0, "posted credit note total"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let reserved_credit = tx
            .query_opt(
                "SELECT COALESCE(SUM(return_record.total), 0)::text FROM sales__sales_return return_record WHERE return_record.tenant_id = $1 AND return_record.invoice = $2 AND return_record.id <> $3 AND return_record.status IN ('submitted', 'approved', 'received') AND NOT EXISTS (SELECT 1 FROM accounting__credit_note note WHERE note.tenant_id = return_record.tenant_id AND note.source = 'sales_return' AND note.source_id = return_record.id::text AND note.status = 'posted')",
                &[&tenant.id, &invoice_id, &return_id],
            )
            .await?
            .map(|row| decimal_column(&row, 0, "reserved return total"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let projected_credit = posted_credit
            .checked_add(reserved_credit)
            .and_then(|total| total.checked_add(return_total))
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "sales.return",
                    vec!["Projected credit note total exceeds the supported decimal range".into()],
                )
            })?;
        let maximum_credit = invoice_total
            .unwrap_or(Decimal::ZERO)
            .checked_add(Decimal::new(5, 3))
            .unwrap_or(Decimal::MAX);
        if projected_credit > maximum_credit {
            errors.push(
                "Tổng credit note và các phiếu trả đang xử lý vượt giá trị hóa đơn gốc".into(),
            );
        }
        let invoiced = match invoice_lines.as_ref() {
            Some(lines) if lines.as_array().is_some_and(|rows| !rows.is_empty()) => {
                line_quantities(lines, "Source invoice")?
            }
            _ => {
                errors
                    .push("Hóa đơn gốc chưa có chi tiết mặt hàng để đối chiếu số lượng trả".into());
                HashMap::new()
            }
        };
        let prior_credit_rows = tx
            .query(
                "SELECT lines FROM accounting__credit_note WHERE tenant_id = $1 AND invoice = $2 AND status = 'posted'",
                &[&tenant.id, &invoice_id],
            )
            .await?;
        let mut already_credited = HashMap::<ReturnLineKey, Decimal>::new();
        for row in prior_credit_rows {
            let lines: Option<Value> = row.get(0);
            if let Some(lines) = lines {
                for (key, qty) in line_quantities(&lines, "Posted credit note")? {
                    let total = already_credited.entry(key).or_insert(Decimal::ZERO);
                    *total = total.checked_add(qty).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "sales.return",
                            vec![
                                "Posted credit note quantities exceed the supported decimal range"
                                    .into(),
                            ],
                        )
                    })?;
                }
            }
        }
        for (key, return_qty) in &requested {
            let remaining = invoiced
                .get(key)
                .copied()
                .unwrap_or_default()
                .checked_sub(already_credited.get(key).copied().unwrap_or_default())
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            if remaining
                .checked_add(Decimal::new(1, 6))
                .is_none_or(|allowed| *return_qty > allowed)
            {
                errors.push(format!(
                    "Số lượng trả cho {} vượt số lượng còn lại trên hóa đơn gốc ({remaining})",
                    key.0
                ));
            }
        }
    }
    for ((product, price, unit, discount, tax, rate), return_qty) in requested {
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
                && discount_pct(sold) == discount
                && tax_id(sold) == tax
                && tax_rate(sold) == rate
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
        let discount_text = discount.normalize().to_string();
        let tax_rate_text = rate.normalize().to_string();
        let prior_row = tx
            .query_opt(
                "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM sales__sales_return sr CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sr.lines, '[]'::jsonb)) AS item(line) WHERE sr.tenant_id = $1 AND sr.sales_order = $2 AND sr.id <> $3 AND sr.status IN ('submitted', 'approved', 'received') AND item.line->>'product' = $4 AND abs((item.line->>'price')::numeric - $5::text::numeric) <= 0.005 AND item.line->>'uom' IS NOT DISTINCT FROM $6 AND COALESCE(NULLIF(item.line->>'effective_discount_pct', '')::numeric, NULLIF(item.line->>'discount_pct', '')::numeric, 0) = $7::text::numeric AND item.line->>'tax' IS NOT DISTINCT FROM $8 AND COALESCE(NULLIF(item.line->>'tax_rate', '')::numeric, 0) = $9::text::numeric",
                &[&tenant.id, &order_id, &return_id, &product, &price_text, &unit, &discount_text, &tax, &tax_rate_text],
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
                    "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text FROM logistics__shipment shipment CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.delivered_lines, shipment.lines, '[]'::jsonb)) AS item(line) WHERE shipment.tenant_id = $1 AND shipment.source = 'sales_order' AND shipment.source_id = $2 AND shipment.status = 'delivered' AND item.line->>'product' = $3 AND abs((item.line->>'price')::numeric - $4::text::numeric) <= 0.005 AND item.line->>'uom' IS NOT DISTINCT FROM $5 AND COALESCE(NULLIF(item.line->>'effective_discount_pct', '')::numeric, NULLIF(item.line->>'discount_pct', '')::numeric, 0) = $6::text::numeric AND item.line->>'tax' IS NOT DISTINCT FROM $7 AND COALESCE(NULLIF(item.line->>'tax_rate', '')::numeric, 0) = $8::text::numeric",
                    &[&tenant.id, &order_id.to_string(), &product, &price_text, &unit, &discount_text, &tax, &tax_rate_text],
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
