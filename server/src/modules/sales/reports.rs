//! Read models for sales return workflows.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::HashMap;
use uuid::Uuid;

impl Kernel {
    /// Return the source lots available for receipt against a sales order.
    /// Quantities are in the product's base unit, matching inventory movements.
    pub async fn sales_return_lots_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        order_id: &str,
    ) -> R<Value> {
        if !tenant.has_module("sales") || !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Sales and inventory modules must both be enabled for this report",
            ));
        }
        self.authorize(tenant, actor, "sales.sales_return.create")?;
        let order_id = Uuid::parse_str(order_id)
            .map_err(|_| ApiError::new(422, "INVALID_ORDER", "order must be a valid UUID"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        if tx
            .query_opt(
                "SELECT id FROM sales__sales_order WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &order_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Sales order not found for this tenant"));
        }
        let sold = tx
            .query(
                "SELECT lot.id, lot.code, lot.expiry::text, move.product, SUM(move.qty::numeric)::text \
                 FROM inventory__stock_move move \
                 JOIN inventory__lot lot ON lot.tenant_id = move.tenant_id AND lot.id::text = move.lot AND lot.product = move.product \
                 WHERE move.tenant_id = $1 AND move.source = 'sales_order' AND move.source_id = $2 AND move.direction = 'out' \
                 GROUP BY lot.id, lot.code, lot.expiry, move.product ORDER BY move.product, lot.expiry NULLS LAST, lot.code, lot.id",
                &[&tenant.id, &order_id.to_string()],
            )
            .await?;
        let received = tx
            .query(
                "SELECT move.lot, SUM(move.qty::numeric)::text FROM inventory__stock_move move \
                 JOIN sales__sales_return ret ON ret.tenant_id = move.tenant_id AND ret.id::text = move.source_id \
                 WHERE move.tenant_id = $1 AND ret.sales_order = $2 AND ret.status = 'received' AND move.source = 'sales_return' AND move.direction = 'in' \
                 GROUP BY move.lot",
                &[&tenant.id, &order_id],
            )
            .await?;
        let pending = tx
            .query(
                "SELECT line->>'product', allocation->>'lot', SUM((allocation->>'qty')::numeric)::text \
                 FROM sales__sales_return ret \
                 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ret.lines, '[]'::jsonb)) line \
                 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(line->'lot_allocations', '[]'::jsonb)) allocation \
                 WHERE ret.tenant_id = $1 AND ret.sales_order = $2 AND ret.status IN ('submitted', 'approved') \
                 GROUP BY line->>'product', allocation->>'lot'",
                &[&tenant.id, &order_id],
            )
            .await?;

        let mut already_received = HashMap::<Option<String>, Decimal>::new();
        for row in received {
            already_received.insert(
                row.get(0),
                row.get::<_, String>(1).parse().unwrap_or_default(),
            );
        }
        let mut reserved = HashMap::<(String, String), Decimal>::new();
        for row in pending {
            let product: Option<String> = row.get(0);
            let lot: Option<String> = row.get(1);
            if let (Some(product), Some(lot)) = (product, lot) {
                reserved.insert(
                    (product, lot),
                    row.get::<_, String>(2).parse().unwrap_or_default(),
                );
            }
        }
        let mut lots = Vec::new();
        let mut unassigned_received = already_received.remove(&None).unwrap_or_default();
        for row in sold {
            let lot: Uuid = row.get(0);
            let code: String = row.get(1);
            let expiry: Option<String> = row.get(2);
            let product: String = row.get(3);
            let sold_qty = row
                .get::<_, String>(4)
                .parse::<Decimal>()
                .unwrap_or_default();
            let received_qty = already_received
                .remove(&Some(lot.to_string()))
                .unwrap_or_default();
            let pending_qty = reserved
                .remove(&(product.clone(), lot.to_string()))
                .unwrap_or_default();
            let available = sold_qty
                .checked_sub(received_qty)
                .and_then(|qty| qty.checked_sub(pending_qty))
                .ok_or_else(|| {
                    ApiError::validation(
                        "sales.return",
                        vec!["Return lot quantity exceeds the original lot shipment".into()],
                    )
                })?;
            if available < Decimal::ZERO {
                return Err(ApiError::validation(
                    "sales.return",
                    vec!["Return lot quantity exceeds the original lot shipment".into()],
                ));
            }
            let assigned = available.min(unassigned_received);
            unassigned_received = unassigned_received
                .checked_sub(assigned)
                .unwrap_or_default();
            let available = available.checked_sub(assigned).unwrap_or_default();
            if available > Decimal::ZERO {
                lots.push(json!({
                    "product": product,
                    "lot": lot,
                    "code": code,
                    "expiry": expiry,
                    "availableQty": money::json_number(available),
                }));
            }
        }
        tx.commit().await?;
        Ok(json!({ "items": lots }))
    }
}
