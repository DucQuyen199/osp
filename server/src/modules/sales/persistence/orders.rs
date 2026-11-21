//! Order uniqueness, credit, stock commitments, and delivery-state checks.
use super::super::application::{all_order_quantities_delivered, has_delivered_order_quantities};
use super::decimal_column;
use crate::modules::sales::has_shippable_lines;
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "sales_order" && matches!(action, "created" | "updated" | "confirmed") {
        let source = document
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !source.is_empty() && !source_id.is_empty() {
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!(
                    "sales.source-order:{}:{}:{}",
                    tenant.id, source, source_id
                )],
            )
            .await?;
            let current_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if tx
                .query_opt(
                    "SELECT id FROM sales__sales_order WHERE tenant_id = $1 AND source = $2 AND source_id = $3 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &source, &source_id, &current_id],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Chứng từ nguồn đã được chuyển thành một đơn bán khác".into()]);
            }
        }
    }
    if entity == "sales_order"
        && action == "cancelled"
        && document.get("status").and_then(Value::as_str) == Some("confirmed")
    {
        let Some(order_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "A confirmed sales order requires a valid id to cancel".into(),
            ]);
        };
        if tx
            .query_opt(
                "SELECT id FROM logistics__shipment WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &order_id.to_string()],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "A sales order cannot be cancelled after a shipment has been created; use the return workflow after delivery".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND status NOT IN ('draft', 'void') LIMIT 1 FOR UPDATE",
                &[&tenant.id, &order_id.to_string()],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "A sales order with an issued invoice cannot be cancelled; use the return and credit-note workflow".into(),
            ]);
        }
    }
    if entity == "sales_order" && action == "confirmed" {
        let Some(party_id) = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Đơn bán cần khách hàng hợp lệ để kiểm tra hạn mức tín dụng".into(),
            ]);
        };
        let party = tx
            .query_opt(
                "SELECT credit_limit::text, is_customer FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &party_id],
            )
            .await?;
        let Some(party) = party else {
            return Ok(vec!["Không tìm thấy khách hàng trong doanh nghiệp".into()]);
        };
        let is_customer: Option<bool> = party.get(1);
        if is_customer == Some(false) {
            return Ok(vec!["Đối tác chưa được đánh dấu là khách hàng".into()]);
        }
        let credit_limit = party
            .get::<_, Option<String>>(0)
            .as_deref()
            .and_then(money::decimal_str);
        if party.get::<_, Option<String>>(0).is_some() && credit_limit.is_none() {
            return Err(crate::error::ApiError::validation(
                "sales.credit_limit",
                vec!["Customer credit limit is not a valid decimal amount".into()],
            ));
        }
        if let Some(credit_limit) = credit_limit {
            let outstanding_row = tx
                .query_opt(
                    "SELECT COALESCE(SUM(GREATEST(COALESCE(i.base_total, i.total) - COALESCE((SELECT SUM(COALESCE(p.applied_base_amount, p.amount)) FROM accounting__payment p WHERE p.tenant_id = i.tenant_id AND p.invoice = i.id), 0) - COALESCE((SELECT SUM(COALESCE(c.base_total, c.total)) FROM accounting__credit_note c WHERE c.tenant_id = i.tenant_id AND c.invoice = i.id AND c.status = 'posted'), 0), 0)), 0)::text FROM accounting__invoice i WHERE i.tenant_id = $1 AND i.party = $2 AND i.status NOT IN ('draft', 'void')",
                    &[&tenant.id, &party_id],
                )
                .await?;
            let outstanding = outstanding_row
                .as_ref()
                .map(|row| decimal_column(row, 0, "outstanding credit"))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let order_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or_default();
            let unbilled_orders_row = tx
                .query_opt(
                    "SELECT COALESCE(SUM(GREATEST(COALESCE(s.total, 0) - COALESCE((SELECT SUM(COALESCE(i.base_total, i.total)) FROM accounting__invoice i WHERE i.tenant_id = s.tenant_id AND i.source = 'sales_order' AND i.source_id = s.id::text AND i.status NOT IN ('draft', 'void')), 0), 0)), 0)::text FROM sales__sales_order s WHERE s.tenant_id = $1 AND s.party = $2 AND s.id <> $3 AND s.status IN ('confirmed', 'partially_delivered', 'delivered')",
                    &[&tenant.id, &party_id, &order_id],
                )
                .await?;
            let unbilled_orders = unbilled_orders_row
                .as_ref()
                .map(|row| decimal_column(row, 0, "unbilled sales order exposure"))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let exposure_before_order =
                outstanding.checked_add(unbilled_orders).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "sales.credit_limit",
                        vec!["Customer credit exposure exceeds the supported decimal range".into()],
                    )
                })?;
            let order_total = document
                .get("total")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            if exposure_before_order
                .checked_add(order_total)
                .zip(credit_limit.checked_add(Decimal::new(5, 3)))
                .is_none_or(|(exposure, maximum)| exposure > maximum)
            {
                return Ok(vec![format!(
                    "Sales order exceeds the customer credit limit: current exposure {exposure_before_order}, new order {order_total}, limit {credit_limit}"
                )]);
            }
        }
        let Some(warehouse) = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Đơn bán cần kho xuất hợp lệ".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Kho xuất đơn bán không tồn tại trong doanh nghiệp".into(),
            ]);
        }
        // Orders fulfilled through Logistics promise stock on confirmation and
        // issue it only after delivery. Serialize by SKU and warehouse so two
        // concurrent confirmations cannot promise the same units.
        if tenant.has_module("logistics")
            && document
                .get("shipping_address")
                .and_then(Value::as_str)
                .is_some_and(|address| !address.trim().is_empty())
            && !tenant.setting_bool("allowNegativeStock")
        {
            let mut requested = std::collections::BTreeMap::<Uuid, Decimal>::new();
            let mut stock_errors = Vec::new();
            for line in document
                .get("lines")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if line.get("tracked") != Some(&Value::Bool(true)) {
                    continue;
                }
                let Some(product) = line
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    continue;
                };
                let Some(qty) = line
                    .get("base_qty")
                    .or_else(|| line.get("qty"))
                    .and_then(money::decimal)
                else {
                    stock_errors.push(format!("Tracked product {product} has an invalid quantity"));
                    continue;
                };
                let requested_qty = requested.entry(product).or_insert(Decimal::ZERO);
                let Some(total) = requested_qty.checked_add(qty) else {
                    return Err(crate::error::ApiError::validation(
                        "sales.stock",
                        vec!["Requested stock quantity exceeds the supported decimal range".into()],
                    ));
                };
                *requested_qty = total;
            }
            let order_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or_default();
            for (product, qty) in requested {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let stock_row = tx
                    .query_opt(
                        "SELECT COALESCE(qty, 0)::text, COALESCE(held_qty, 0)::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
                        &[&tenant.id, &product, &warehouse],
                    )
                    .await?;
                let (on_hand, held) = if let Some(row) = stock_row.as_ref() {
                    (
                        decimal_column(row, 0, "on-hand quantity")?,
                        decimal_column(row, 1, "held quantity")?,
                    )
                } else {
                    (Decimal::ZERO, Decimal::ZERO)
                };
                let committed_row = tx
                    .query_opt(
                        "SELECT COALESCE(SUM(GREATEST(ordered.qty - COALESCE(delivered.qty, 0), 0)), 0)::text FROM (SELECT s.id, SUM(COALESCE((item.line->>'base_qty')::numeric, (item.line->>'qty')::numeric)) AS qty FROM sales__sales_order s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.lines, '[]'::jsonb)) AS item(line) WHERE s.tenant_id = $1 AND s.id <> $2 AND s.warehouse = $3 AND s.status IN ('confirmed', 'partially_delivered') AND NULLIF(BTRIM(s.shipping_address), '') IS NOT NULL AND item.line->>'tracked' = 'true' AND item.line->>'product' = $4 GROUP BY s.id) ordered LEFT JOIN LATERAL (SELECT SUM(COALESCE((shipped.line->>'base_qty')::numeric, (shipped.line->>'qty')::numeric)) AS qty FROM logistics__shipment shipment CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.delivered_lines, shipment.lines, '[]'::jsonb)) AS shipped(line) WHERE shipment.tenant_id = $1 AND shipment.source = 'sales_order' AND shipment.source_id = ordered.id::text AND shipment.status = 'delivered' AND shipped.line->>'tracked' = 'true' AND shipped.line->>'product' = $4) delivered ON true",
                        &[&tenant.id, &order_id, &warehouse, &product.to_string()],
                    )
                    .await?;
                let committed = committed_row
                    .as_ref()
                    .map(|row| decimal_column(row, 0, "committed quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                let available = on_hand
                    .checked_sub(held)
                    .and_then(|quantity| quantity.checked_sub(committed))
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "sales.stock",
                            vec!["Available stock exceeds the supported decimal range".into()],
                        )
                    })?
                    .max(Decimal::ZERO);
                let available_with_tolerance =
                    available.checked_add(Decimal::new(1, 6)).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "sales.stock",
                            vec!["Available stock exceeds the supported decimal range".into()],
                        )
                    })?;
                if qty > available_with_tolerance {
                    stock_errors.push(format!(
                        "Insufficient available stock for product {product}: requested {qty}, available {available} after confirmed shipments"
                    ));
                }
            }
            if !stock_errors.is_empty() {
                return Ok(stock_errors);
            }
        }
    }
    if entity == "sales_order" && action == "partially_delivered" {
        let Some(order_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Không xác định được đơn bán giao một phần".into()]);
        };
        let requires_logistics = tenant.has_module("logistics")
            && document
                .get("shipping_address")
                .and_then(Value::as_str)
                .is_some_and(|address| !address.trim().is_empty());
        if !requires_logistics
            || !has_delivered_order_quantities(tx, tenant, order_id).await?
            || all_order_quantities_delivered(
                tx,
                tenant,
                order_id,
                document.get("lines").unwrap_or(&Value::Null),
            )
            .await?
        {
            return Ok(vec![
                "Chỉ ghi nhận trạng thái giao một phần khi có vận đơn giao một phần thực tế".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "sales_order" && action == "delivered" {
        let Some(order_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Không xác định được đơn bán cần hoàn tất".into()]);
        };
        let shipments = tx.query(
            "SELECT status FROM logistics__shipment WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2",
            &[&tenant.id, &order_id.to_string()],
        ).await?;
        let requires_shipment = tenant.has_module("logistics")
            && has_shippable_lines(document.get("lines").unwrap_or(&Value::Null))
            && document
                .get("shipping_address")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
        let mut errors = Vec::new();
        if requires_shipment && shipments.is_empty() {
            errors.push("Đơn có địa chỉ giao phải có vận đơn trước khi hoàn tất".into());
        }
        if shipments
            .iter()
            .any(|row| row.get::<_, String>(0) != "delivered")
        {
            errors.push("Chỉ hoàn tất đơn bán sau khi mọi vận đơn đã giao thành công".into());
        }
        if requires_shipment
            && !all_order_quantities_delivered(
                tx,
                tenant,
                order_id,
                document.get("lines").unwrap_or(&Value::Null),
            )
            .await?
        {
            errors.push("Chỉ hoàn tất đơn bán sau khi mọi số lượng trên đơn đã được giao".into());
        }
        return Ok(errors);
    }
    Ok(Vec::new())
}
