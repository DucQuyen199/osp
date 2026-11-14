//! Inventory replenishment read models and draft procurement handoff.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

async fn replenishment_rows(
    tx: &Tx<'_>,
    tenant: &Tenant,
    warehouse: Option<Uuid>,
) -> R<Vec<Value>> {
    tx.query_json(
        "WITH ordered_lines AS ( \
           SELECT po.id AS order_id, po.tenant_id, po.warehouse, \
             (line->>'product')::uuid AS product, (line->>'price')::numeric AS price, \
             sum((line->>'qty')::numeric) AS ordered_qty \
           FROM purchasing__purchase_order po \
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.lines, '[]'::jsonb)) line \
           WHERE po.tenant_id = $1 AND po.status IN ('draft', 'submitted', 'approved', 'partially_received') \
           GROUP BY po.id, po.tenant_id, po.warehouse, (line->>'product')::uuid, (line->>'price')::numeric \
         ), incoming AS ( \
           SELECT ol.warehouse, ol.product, \
             sum(GREATEST(ol.ordered_qty - COALESCE(receipts.received_qty, 0), 0)) AS qty \
           FROM ordered_lines ol \
           LEFT JOIN LATERAL ( \
             SELECT sum((received_line->>'qty')::numeric) AS received_qty \
             FROM purchasing__purchase_receipt receipt \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(receipt.lines, '[]'::jsonb)) received_line \
             WHERE receipt.tenant_id = ol.tenant_id AND receipt.purchase_order = ol.order_id \
               AND receipt.status = 'received' \
               AND received_line->>'product' = ol.product::text \
               AND (received_line->>'price')::numeric = ol.price \
           ) receipts ON true \
           GROUP BY ol.warehouse, ol.product \
         ), open_requisitions AS ( \
           SELECT requested.warehouse, requested.product, \
             sum(GREATEST(requested.requested_qty - COALESCE(ordered.qty, 0), 0)) AS qty \
           FROM ( \
             SELECT pr.id, pr.tenant_id, pr.warehouse, (line->>'product')::uuid AS product, \
               sum((line->>'qty')::numeric) AS requested_qty \
             FROM purchasing__purchase_requisition pr \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.lines, '[]'::jsonb)) line \
             WHERE pr.tenant_id = $1 AND pr.status IN ('draft', 'submitted', 'approved') \
             GROUP BY pr.id, pr.tenant_id, pr.warehouse, (line->>'product')::uuid \
           ) requested \
           LEFT JOIN LATERAL ( \
             SELECT sum((ordered_line->>'qty')::numeric) AS qty \
             FROM purchasing__purchase_order linked \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(linked.lines, '[]'::jsonb)) ordered_line \
             WHERE linked.tenant_id = requested.tenant_id AND linked.source = 'purchase_requisition' \
               AND linked.source_id = requested.id::text \
               AND linked.warehouse = requested.warehouse \
               AND linked.status NOT IN ('cancelled', 'rejected') \
               AND (ordered_line->>'product')::uuid = requested.product \
           ) ordered ON true \
           GROUP BY requested.warehouse, requested.product \
         ), balances AS ( \
           SELECT product, warehouse, COALESCE(qty, 0) - COALESCE(held_qty, 0) AS available_qty \
           FROM inventory__stock_level WHERE tenant_id = $1 \
         ) SELECT jsonb_build_object( \
           'id', rule.id, 'productId', product.id, 'sku', product.sku, 'product', product.name, \
           'unit', product.uom, 'warehouseId', warehouse.id, 'warehouse', warehouse.name, \
           'minimumQty', rule.minimum_qty, 'targetQty', rule.target_qty, \
           'availableQty', COALESCE(balance.available_qty, 0), \
           'incomingQty', COALESCE(incoming.qty, 0), \
           'requisitionQty', COALESCE(open_requisitions.qty, 0), \
           'suggestedQty', GREATEST(rule.target_qty - COALESCE(balance.available_qty, 0) \
             - COALESCE(incoming.qty, 0) - COALESCE(open_requisitions.qty, 0), 0) \
         ) FROM inventory__reorder_rule rule \
         JOIN master_data__product product ON product.tenant_id = rule.tenant_id AND product.id = rule.product \
         JOIN inventory__warehouse warehouse ON warehouse.tenant_id = rule.tenant_id AND warehouse.id = rule.warehouse \
         LEFT JOIN balances balance ON balance.product = rule.product AND balance.warehouse = rule.warehouse \
         LEFT JOIN incoming ON incoming.product = rule.product AND incoming.warehouse = rule.warehouse \
         LEFT JOIN open_requisitions ON open_requisitions.product = rule.product AND open_requisitions.warehouse = rule.warehouse \
         WHERE rule.tenant_id = $1 AND ($2::uuid IS NULL OR rule.warehouse = $2) \
           AND COALESCE(balance.available_qty, 0) < rule.minimum_qty \
         ORDER BY product.name, warehouse.name, rule.id",
        &[&tenant.id, &warehouse],
    )
    .await
}

impl Kernel {
    /// Returns pending/failed purchase inspections with their remaining held quantity and source stock layer.
    pub async fn inventory_quality_hold_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        warehouse_id: Option<&str>,
        status_filter: Option<&str>,
    ) -> R<Value> {
        if !tenant.has_module("inventory") || !tenant.has_module("quality") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Inventory and quality modules must both be enabled for this report",
            ));
        }
        self.authorize(tenant, actor, "inventory.stock_move.read")?;
        self.authorize(tenant, actor, "quality.inspection.read")?;
        let warehouse = warehouse_id
            .map(|value| {
                Uuid::parse_str(value).map_err(|_| {
                    ApiError::new(422, "INVALID_WAREHOUSE", "warehouse must be a valid UUID")
                })
            })
            .transpose()?;
        let status = status_filter
            .filter(|value| !value.is_empty() && *value != "all")
            .map(|value| match value {
                "pending" | "failed" => Ok(value),
                _ => Err(ApiError::new(
                    422,
                    "INVALID_STATUS",
                    "status must be pending, failed, or all",
                )),
            })
            .transpose()?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let items = tx
            .query_json(
                "WITH returned AS ( \
                   SELECT source_id, product, warehouse, lot, SUM(qty::numeric) AS returned_qty \
                   FROM inventory__stock_move \
                   WHERE tenant_id = $1 AND source = 'quality_return' AND direction = 'out' \
                   GROUP BY source_id, product, warehouse, lot \
                 ), held_inspections AS ( \
                   SELECT qi.*, GREATEST(qi.qty::numeric - COALESCE(disp.released_qty, 0) - COALESCE(ret.returned_qty, 0), 0) AS held_qty, \
                     row_number() OVER (PARTITION BY qi.tenant_id, qi.source, qi.source_id, qi.product, qi.warehouse, qi.lot, \
                       round(COALESCE(qi.unit_cost, 0)::numeric, 4), round(qi.qty::numeric, 6) ORDER BY qi.created_at, qi.id) AS layer_ordinal \
                   FROM quality__inspection qi \
                   LEFT JOIN returned ret ON ret.source_id = qi.id::text AND ret.product = qi.product \
                     AND ret.warehouse = qi.warehouse AND ret.lot IS NOT DISTINCT FROM qi.lot::text \
                   LEFT JOIN LATERAL (SELECT SUM(qd.qty::numeric) AS released_qty FROM quality__inspection_disposition qd WHERE qd.tenant_id = qi.tenant_id AND qd.inspection = qi.id AND qd.status = 'posted') disp ON TRUE \
                   WHERE qi.tenant_id = $1 AND qi.status IN ('pending', 'failed') \
                     AND ($2::uuid IS NULL OR qi.warehouse = $2) AND ($3::text IS NULL OR qi.status = $3) \
                 ), source_layers AS ( \
                   SELECT sm.*, round((COALESCE(sm.total_cost, 0)::numeric / NULLIF(sm.qty::numeric, 0)), 4) AS unit_cost, \
                     row_number() OVER (PARTITION BY sm.tenant_id, sm.source, sm.source_id, sm.product, sm.warehouse, sm.lot, \
                       round((COALESCE(sm.total_cost, 0)::numeric / NULLIF(sm.qty::numeric, 0)), 4), round(sm.qty::numeric, 6) \
                       ORDER BY sm.created_at, sm.id) AS layer_ordinal \
                   FROM inventory__stock_move sm \
                   WHERE sm.tenant_id = $1 AND sm.direction = 'in' AND sm.source IN ('purchase_order', 'purchase_receipt') \
                 ) SELECT jsonb_build_object( \
                   'inspectionId', qi.id, 'inspectionStatus', qi.status, 'source', qi.source, 'sourceId', qi.source_id, \
                   'productId', p.id, 'sku', p.sku, 'product', p.name, 'warehouseId', w.id, 'warehouse', w.name, \
                   'lotId', lot.id, 'lotCode', lot.code, 'layerId', layer.id, 'layerOriginId', layer.fifo_origin_id, \
                   'layerReceivedAt', layer.created_at, 'layerQty', layer.qty, 'heldQty', qi.held_qty, \
                   'unitCost', COALESCE(qi.unit_cost, layer.unit_cost, 0), \
                   'heldValue', qi.held_qty * COALESCE(qi.unit_cost, layer.unit_cost, 0), \
                   'daysHeld', GREATEST(current_date - qi.created_at::date, 0) \
                 ) FROM held_inspections qi \
                 JOIN master_data__product p ON p.tenant_id = qi.tenant_id AND p.id = qi.product \
                 JOIN inventory__warehouse w ON w.tenant_id = qi.tenant_id AND w.id = qi.warehouse \
                 LEFT JOIN inventory__lot lot ON lot.tenant_id = qi.tenant_id AND lot.id = qi.lot \
                 LEFT JOIN source_layers layer ON layer.tenant_id = qi.tenant_id AND layer.source = qi.source \
                   AND layer.source_id = qi.source_id AND layer.product = qi.product AND layer.warehouse = qi.warehouse \
                   AND layer.lot IS NOT DISTINCT FROM qi.lot::text \
                   AND layer.unit_cost IS NOT DISTINCT FROM round(COALESCE(qi.unit_cost, 0)::numeric, 4) \
                   AND round(layer.qty::numeric, 6) = round(qi.qty::numeric, 6) AND layer.layer_ordinal = qi.layer_ordinal \
                 WHERE qi.held_qty > 0.000001 \
                 ORDER BY qi.created_at, qi.id",
                &[&tenant.id, &warehouse, &status],
            )
            .await?;
        let held_qty = items.iter().try_fold(Decimal::ZERO, |total, item| {
            total.checked_add(item.get("heldQty").and_then(money::decimal)?)
        });
        let held_value = items.iter().try_fold(Decimal::ZERO, |total, item| {
            total.checked_add(item.get("heldValue").and_then(money::decimal)?)
        });
        let (Some(held_qty), Some(held_value)) = (held_qty, held_value) else {
            return Err(ApiError::validation(
                "inventory.quality_report",
                vec!["Quality hold report values exceed the supported decimal range".into()],
            ));
        };
        let held_qty = money::json_number(held_qty).ok_or_else(|| {
            ApiError::validation(
                "inventory.quality_report",
                vec!["Quality hold quantity cannot be serialized as a JSON number".into()],
            )
        })?;
        let held_value = money::json_number(held_value).ok_or_else(|| {
            ApiError::validation(
                "inventory.quality_report",
                vec!["Quality hold value cannot be serialized as a JSON number".into()],
            )
        })?;
        Ok(json!({
            "warehouseId": warehouse,
            "status": status.unwrap_or("all"),
            "itemCount": items.len(),
            "heldQty": held_qty,
            "heldValue": held_value,
            "items": items,
        }))
    }

    /// Returns movement-derived on-hand quantity and value grouped by warehouse bin.
    pub async fn inventory_location_stock_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        warehouse_id: Option<&str>,
    ) -> R<Value> {
        if !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "inventory.stock_move.read")?;
        let warehouse = warehouse_id
            .map(|value| {
                Uuid::parse_str(value).map_err(|_| {
                    ApiError::new(422, "INVALID_WAREHOUSE", "warehouse must be a valid UUID")
                })
            })
            .transpose()?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        if let Some(warehouse) = warehouse
            && tx
                .query_opt(
                    "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &warehouse],
                )
                .await?
                .is_none()
        {
            return Err(ApiError::not_found("Warehouse not found for this tenant"));
        }
        let rows = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'warehouseId', w.id, 'warehouse', w.name, 'locationId', l.id, \
                   'locationCode', l.code, 'location', l.name, 'productId', p.id, \
                   'sku', p.sku, 'product', p.name, \
                   'qty', SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END), \
                   'value', SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END) \
                 ) FROM inventory__stock_move sm \
                 JOIN inventory__warehouse w ON w.tenant_id = sm.tenant_id AND w.id = sm.warehouse \
                 LEFT JOIN inventory__warehouse_location l ON l.tenant_id = sm.tenant_id AND l.id = sm.location \
                 JOIN master_data__product p ON p.tenant_id = sm.tenant_id AND p.id = sm.product \
                 WHERE sm.tenant_id = $1 AND ($2::uuid IS NULL OR sm.warehouse = $2) \
                 GROUP BY w.id, w.name, l.id, l.code, l.name, p.id, p.sku, p.name \
                 HAVING abs(SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END)) > 0.000001 \
                    OR abs(SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END)) > 0.005 \
                 ORDER BY w.name, l.code NULLS FIRST, p.name, p.id",
                &[&tenant.id, &warehouse],
            )
            .await?;
        Ok(json!({ "warehouseId": warehouse, "items": rows, "itemCount": rows.len() }))
    }

    /// Suggests replenishment quantities net of outstanding purchase orders and requisitions.
    pub async fn inventory_replenishment_report(&self, actor: &Actor, tenant: &Tenant) -> R<Value> {
        if !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "inventory.reorder_rule.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let rows = replenishment_rows(&tx, tenant, None).await?;
        let purchase_lines = rows
            .iter()
            .filter(|row| {
                row.get("suggestedQty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::new(1, 6))
            })
            .count();
        Ok(json!({ "items": rows, "itemCount": rows.len(), "purchaseLines": purchase_lines }))
    }

    /// Recalculates one warehouse's suggestions and creates its procurement request atomically.
    pub async fn create_replenishment_requisition(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        warehouse_id: &str,
    ) -> R<Value> {
        if !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory is not enabled for this tenant",
            ));
        }
        let warehouse = Uuid::parse_str(warehouse_id).map_err(|_| {
            ApiError::validation("inventory.reorder_rule", vec!["Kho không hợp lệ".into()])
        })?;
        self.authorize(tenant, actor, "inventory.reorder_rule.read")?;
        self.authorize(tenant, actor, "purchasing.purchase_requisition.create")?;
        let entity = self.ent(tenant, "purchasing.purchase_requisition")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!(
                "inventory-replenishment:{}:{warehouse}",
                tenant.id
            )],
        )
        .await?;
        let rows = replenishment_rows(&tx, tenant, Some(warehouse)).await?;
        let lines = rows
            .iter()
            .filter_map(|row| {
                let qty = row.get("suggestedQty").and_then(money::decimal)?;
                let product = row.get("productId")?.as_str()?;
                (qty > Decimal::new(1, 6))
                    .then(|| Some(json!({ "product": product, "qty": money::json_number(qty)? })))?
            })
            .collect::<Vec<_>>();
        if lines.is_empty() {
            return Err(ApiError::validation(
                "inventory.reorder_rule",
                vec!["Kho này không còn mặt hàng cần đề nghị mua; hãy tải lại đề xuất".into()],
            ));
        }
        let mut request = Map::new();
        request.insert("warehouse".into(), json!(warehouse));
        request.insert("lines".into(), json!(lines));
        request.insert(
            "reason".into(),
            json!("Đề nghị mua tự động từ định mức bổ sung tồn kho"),
        );
        let created = self
            .create_in(&tx, actor, tenant, &entity, request, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(created)
    }
}
