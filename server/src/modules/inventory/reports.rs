//! Inventory replenishment read models and draft procurement handoff.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

async fn replenishment_rows(
    tx: &Tx<'_>,
    tenant: &Tenant,
    warehouse: Option<Uuid>,
) -> R<Vec<Value>> {
    let sales_demand = if tenant.has_module("sales") && tenant.has_module("logistics") {
        let shipments = "sales_shipments AS ( \
               SELECT shipment.source_id::uuid AS order_id, (line->>'product')::uuid AS product, \
                 sum(COALESCE((line->>'base_qty')::numeric, (line->>'qty')::numeric)) AS qty \
               FROM logistics__shipment shipment \
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.delivered_lines, shipment.lines, '[]'::jsonb)) line \
               WHERE shipment.tenant_id = $1 AND shipment.source = 'sales_order' \
                 AND shipment.status = 'delivered' AND line->>'tracked' = 'true' \
               GROUP BY shipment.source_id, (line->>'product')::uuid \
             ), ";
        format!(
            "sales_order_lines AS ( \
               SELECT orders.id AS order_id, orders.warehouse, (line->>'product')::uuid AS product, \
                 sum(COALESCE((line->>'base_qty')::numeric, (line->>'qty')::numeric)) AS qty \
               FROM sales__sales_order orders \
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(orders.lines, '[]'::jsonb)) line \
               WHERE orders.tenant_id = $1 AND orders.status IN ('confirmed', 'partially_delivered') \
                 AND NULLIF(BTRIM(orders.shipping_address), '') IS NOT NULL \
                 AND line->>'tracked' = 'true' \
               GROUP BY orders.id, orders.warehouse, (line->>'product')::uuid \
             ), {shipments} \
             sales_demand AS ( \
               SELECT order_lines.warehouse, order_lines.product, \
                 sum(GREATEST(order_lines.qty - COALESCE(shipments.qty, 0), 0)) AS qty \
               FROM sales_order_lines order_lines \
               LEFT JOIN sales_shipments shipments ON shipments.order_id = order_lines.order_id \
                 AND shipments.product = order_lines.product \
               GROUP BY order_lines.warehouse, order_lines.product \
             ),"
        )
    } else {
        "sales_demand AS (SELECT NULL::uuid AS warehouse, NULL::uuid AS product, 0::numeric AS qty WHERE FALSE),".into()
    };
    let quality_holds = if tenant.has_module("quality") {
        "quality_holds AS ( \
           SELECT inspection.tenant_id, inspection.product, inspection.warehouse, inspection.lot, \
             sum(CASE WHEN inspection.status = 'passed' THEN 0::numeric ELSE GREATEST( \
               inspection.qty::numeric - COALESCE(dispositions.qty, 0) - COALESCE(returned.qty, 0), 0::numeric \
             ) END) AS qty \
           FROM quality__inspection inspection \
           LEFT JOIN LATERAL (SELECT SUM(disposition.qty::numeric) AS qty \
             FROM quality__inspection_disposition disposition \
             WHERE disposition.tenant_id = inspection.tenant_id AND disposition.inspection = inspection.id \
               AND disposition.status = 'posted') dispositions ON TRUE \
           LEFT JOIN LATERAL (SELECT SUM(stock_move.qty::numeric) AS qty \
             FROM inventory__stock_move stock_move \
             WHERE stock_move.tenant_id = inspection.tenant_id AND stock_move.source = 'quality_return' \
               AND stock_move.source_id = inspection.id::text AND stock_move.product = inspection.product \
               AND stock_move.warehouse = inspection.warehouse AND stock_move.lot IS NOT DISTINCT FROM inspection.lot::text \
               AND stock_move.direction = 'out') returned ON TRUE \
           WHERE inspection.tenant_id = $1 AND inspection.source IN ('purchase_order', 'purchase_receipt') \
           GROUP BY inspection.tenant_id, inspection.product, inspection.warehouse, inspection.lot \
         ), "
    } else {
        "quality_holds AS (SELECT NULL::uuid AS tenant_id, NULL::uuid AS product, NULL::uuid AS warehouse, NULL::uuid AS lot, 0::numeric AS qty WHERE FALSE), "
    };
    tx.query_json(
        &format!("WITH {sales_demand} ordered_lines AS ( \
           SELECT po.id AS order_id, po.tenant_id, po.warehouse, \
             (line->>'product')::uuid AS product, \
             COALESCE((line->>'base_price')::numeric, (line->>'price')::numeric) AS price, \
             sum(COALESCE((line->>'base_qty')::numeric, (line->>'qty')::numeric)) AS ordered_qty \
           FROM purchasing__purchase_order po \
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.lines, '[]'::jsonb)) line \
           WHERE po.tenant_id = $1 AND po.status IN ('draft', 'submitted', 'approved', 'partially_received') \
           GROUP BY po.id, po.tenant_id, po.warehouse, (line->>'product')::uuid, \
             COALESCE((line->>'base_price')::numeric, (line->>'price')::numeric) \
         ), incoming AS ( \
           SELECT ol.warehouse, ol.product, \
             sum(GREATEST(ol.ordered_qty - COALESCE(receipts.received_qty, 0), 0)) AS qty \
           FROM ordered_lines ol \
           LEFT JOIN LATERAL ( \
             SELECT sum(COALESCE((received_line->>'base_qty')::numeric, (received_line->>'qty')::numeric)) AS received_qty \
             FROM purchasing__purchase_receipt receipt \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(receipt.lines, '[]'::jsonb)) received_line \
             WHERE receipt.tenant_id = ol.tenant_id AND receipt.purchase_order = ol.order_id \
               AND receipt.status = 'received' \
               AND received_line->>'product' = ol.product::text \
               AND COALESCE((received_line->>'base_price')::numeric, (received_line->>'price')::numeric) = ol.price \
           ) receipts ON true \
           GROUP BY ol.warehouse, ol.product \
         ), open_requisitions AS ( \
           SELECT requested.warehouse, requested.product, \
             sum(GREATEST(requested.requested_qty - COALESCE(ordered.qty, 0), 0)) AS qty \
           FROM ( \
             SELECT pr.id, pr.tenant_id, pr.warehouse, (line->>'product')::uuid AS product, \
               sum(COALESCE((line->>'base_qty')::numeric, (line->>'qty')::numeric)) AS requested_qty \
             FROM purchasing__purchase_requisition pr \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.lines, '[]'::jsonb)) line \
             WHERE pr.tenant_id = $1 AND pr.status IN ('draft', 'submitted', 'approved') \
             GROUP BY pr.id, pr.tenant_id, pr.warehouse, (line->>'product')::uuid \
           ) requested \
           LEFT JOIN LATERAL ( \
             SELECT sum(COALESCE((ordered_line->>'base_qty')::numeric, (ordered_line->>'qty')::numeric)) AS qty \
             FROM purchasing__purchase_order linked \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(linked.lines, '[]'::jsonb)) ordered_line \
             WHERE linked.tenant_id = requested.tenant_id AND linked.source = 'purchase_requisition' \
               AND linked.source_id = requested.id::text \
               AND linked.warehouse = requested.warehouse \
               AND linked.status NOT IN ('cancelled', 'rejected') \
               AND (ordered_line->>'product')::uuid = requested.product \
           ) ordered ON true \
           GROUP BY requested.warehouse, requested.product \
         ), {quality_holds} lot_balances AS ( \
           SELECT lot.tenant_id, lot.product, move.warehouse, lot.id AS lot, lot.expiry, \
             sum(CASE WHEN move.direction = 'in' THEN move.qty::numeric ELSE -move.qty::numeric END) AS qty \
           FROM inventory__lot lot \
           JOIN inventory__stock_move move ON move.tenant_id = lot.tenant_id AND move.product = lot.product \
             AND move.lot = lot.id::text AND move.warehouse IS NOT NULL \
           WHERE lot.tenant_id = $1 \
           GROUP BY lot.tenant_id, lot.product, move.warehouse, lot.id, lot.expiry \
         ), lot_positions AS ( \
           SELECT lot_balances.tenant_id, lot_balances.product, lot_balances.warehouse, \
             sum(GREATEST(lot_balances.qty - COALESCE(quality_holds.qty, 0), 0)) \
               FILTER (WHERE lot_balances.expiry IS NULL OR lot_balances.expiry >= $3::date) AS usable_qty, \
             sum(GREATEST(lot_balances.qty, 0)) AS total_qty \
           FROM lot_balances \
           LEFT JOIN quality_holds ON quality_holds.tenant_id = lot_balances.tenant_id \
             AND quality_holds.product = lot_balances.product AND quality_holds.warehouse = lot_balances.warehouse \
             AND quality_holds.lot IS NOT DISTINCT FROM lot_balances.lot \
           GROUP BY lot_balances.tenant_id, lot_balances.product, lot_balances.warehouse \
         ), balances AS ( \
           SELECT stock.product, stock.warehouse, \
             CASE WHEN COALESCE(product.lot_tracked, false) THEN \
               COALESCE(lot_positions.usable_qty, 0) + GREATEST( \
                 COALESCE(stock.qty, 0) - COALESCE(stock.held_qty, 0) - COALESCE(lot_positions.total_qty, 0), 0 \
               ) ELSE COALESCE(stock.qty, 0) - COALESCE(stock.held_qty, 0) END AS available_qty \
           FROM inventory__stock_level stock \
           JOIN master_data__product product ON product.tenant_id = stock.tenant_id AND product.id = stock.product \
           LEFT JOIN lot_positions ON lot_positions.tenant_id = stock.tenant_id \
             AND lot_positions.product = stock.product AND lot_positions.warehouse = stock.warehouse \
           WHERE stock.tenant_id = $1 \
         ) SELECT jsonb_build_object( \
           'id', rule.id, 'productId', product.id, 'sku', product.sku, 'product', product.name, \
           'unit', product.uom, 'warehouseId', warehouse.id, 'warehouse', warehouse.name, \
           'minimumQty', rule.minimum_qty, 'targetQty', rule.target_qty, \
           'availableQty', COALESCE(balance.available_qty, 0), \
           'incomingQty', COALESCE(incoming.qty, 0), \
           'requisitionQty', COALESCE(open_requisitions.qty, 0), \
           'committedQty', COALESCE(sales_demand.qty, 0), \
           'projectedQty', COALESCE(balance.available_qty, 0) + COALESCE(incoming.qty, 0) \
             + COALESCE(open_requisitions.qty, 0) - COALESCE(sales_demand.qty, 0), \
           'suggestedQty', GREATEST(rule.target_qty - COALESCE(balance.available_qty, 0) \
             - COALESCE(incoming.qty, 0) - COALESCE(open_requisitions.qty, 0) \
             + COALESCE(sales_demand.qty, 0), 0) \
         ) FROM inventory__reorder_rule rule \
         JOIN master_data__product product ON product.tenant_id = rule.tenant_id AND product.id = rule.product \
         JOIN inventory__warehouse warehouse ON warehouse.tenant_id = rule.tenant_id AND warehouse.id = rule.warehouse \
         LEFT JOIN balances balance ON balance.product = rule.product AND balance.warehouse = rule.warehouse \
         LEFT JOIN incoming ON incoming.product = rule.product AND incoming.warehouse = rule.warehouse \
         LEFT JOIN open_requisitions ON open_requisitions.product = rule.product AND open_requisitions.warehouse = rule.warehouse \
         LEFT JOIN sales_demand ON sales_demand.product = rule.product AND sales_demand.warehouse = rule.warehouse \
         WHERE rule.tenant_id = $1 AND ($2::uuid IS NULL OR rule.warehouse = $2) \
           AND COALESCE(balance.available_qty, 0) + COALESCE(incoming.qty, 0) \
             + COALESCE(open_requisitions.qty, 0) - COALESCE(sales_demand.qty, 0) < rule.minimum_qty \
         ORDER BY product.name, warehouse.name, rule.id",
        ),
        &[&tenant.id, &warehouse, &tenant.business_today()],
    )
    .await
}

fn quality_held_qty_by_unit(items: &[Value]) -> Option<Vec<Value>> {
    let mut totals = BTreeMap::<(Option<String>, Option<String>), Decimal>::new();
    for item in items {
        let key = (
            item.get("uomId").and_then(Value::as_str).map(str::to_owned),
            item.get("unit").and_then(Value::as_str).map(str::to_owned),
        );
        let qty = item.get("heldQty").and_then(money::decimal)?;
        let total = totals.get(&key).copied().unwrap_or(Decimal::ZERO);
        totals.insert(key, total.checked_add(qty)?);
    }
    totals
        .into_iter()
        .map(|((uom_id, unit), qty)| {
            Some(json!({
                "uomId": uom_id,
                "unit": unit.unwrap_or_else(|| "Chưa đặt đơn vị".into()),
                "qty": money::json_number(qty)?,
            }))
        })
        .collect()
}

impl Kernel {
    /// Creates an auditable draft stock count to write off expired lot balances.
    /// The inventory and accounting adjustments only occur after normal review and approval.
    pub async fn create_expiry_writeoff_count(
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
        self.authorize(tenant, actor, "inventory.lot.read")?;
        self.authorize(tenant, actor, "inventory.stock_move.read")?;
        self.authorize(tenant, actor, "inventory.stock_count.create")?;
        let warehouse = Uuid::parse_str(warehouse_id).map_err(|_| {
            ApiError::validation("inventory.stock_count", vec!["Kho không hợp lệ".into()])
        })?;
        let entity = self.ent(tenant, "inventory.stock_count")?;
        let note = "Kiểm kê hủy hàng hết hạn";
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Warehouse not found for this tenant"));
        }
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!(
                "inventory-expiry-writeoff:{}:{}",
                tenant.id, warehouse
            )],
        )
        .await?;
        if let Some(existing) = tx
            .query_opt(
                "SELECT id, status FROM inventory__stock_count WHERE tenant_id = $1 AND warehouse = $2 AND reason = 'damage' AND note = $3 AND status IN ('draft', 'submitted', 'rejected') ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE",
                &[&tenant.id, &warehouse, &note],
            )
            .await?
        {
            let id: Uuid = existing.get(0);
            let status: String = existing.get(1);
            tx.commit().await?;
            return Ok(json!({ "id": id, "warehouseId": warehouse, "status": status, "existing": true }));
        }
        if tenant.has_module("quality") {
            let held_lots = tx
                .query_json(
                    "SELECT jsonb_build_object('lot', qi.lot, 'heldQty', SUM(GREATEST(qi.qty::numeric - COALESCE(disposition.qty, 0) - COALESCE(returned.qty, 0), 0::numeric))) \
                     FROM quality__inspection qi \
                     JOIN inventory__lot lot ON lot.tenant_id = qi.tenant_id AND lot.id = qi.lot \
                     LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS qty FROM quality__inspection_disposition WHERE tenant_id = qi.tenant_id AND inspection = qi.id AND status = 'posted') disposition ON true \
                     LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS qty FROM inventory__stock_move WHERE tenant_id = qi.tenant_id AND source = 'quality_return' AND source_id = qi.id::text AND direction = 'out') returned ON true \
                     WHERE qi.tenant_id = $1 AND qi.warehouse = $2 AND qi.source IN ('purchase_order', 'purchase_receipt') \
                       AND qi.status IN ('pending', 'failed') AND lot.expiry < $3::date \
                     GROUP BY qi.lot \
                     HAVING SUM(GREATEST(qi.qty::numeric - COALESCE(disposition.qty, 0) - COALESCE(returned.qty, 0), 0::numeric)) > 0.000001",
                    &[&tenant.id, &warehouse, &tenant.business_today()],
                )
                .await?;
            if !held_lots.is_empty() {
                return Err(ApiError::validation(
                    "inventory.stock_count",
                    vec![format!(
                        "{} lô hết hạn vẫn đang bị giữ QC; xử lý phiếu QC trước khi tạo phiếu hủy",
                        held_lots.len()
                    )],
                ));
            }
        }
        let lines = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'product', move.product, 'lot', lot.id, 'location', move.location, 'counted_qty', 0 \
                 ) FROM inventory__stock_move move \
                 JOIN inventory__lot lot ON lot.tenant_id = move.tenant_id AND lot.id::text = move.lot AND lot.product = move.product \
                 WHERE move.tenant_id = $1 AND move.warehouse = $2 AND lot.expiry < $3::date \
                 GROUP BY move.product, lot.id, move.location \
                 HAVING SUM(CASE WHEN move.direction = 'in' THEN move.qty::numeric ELSE -move.qty::numeric END) > 0.000001 \
                 ORDER BY move.product, lot.id, move.location NULLS FIRST",
                &[&tenant.id, &warehouse, &tenant.business_today()],
            )
            .await?;
        if lines.is_empty() {
            return Err(ApiError::validation(
                "inventory.stock_count",
                vec!["Kho này không còn lô hết hạn có tồn dương".into()],
            ));
        }
        if lines.len() > 5000 {
            return Err(ApiError::validation(
                "inventory.stock_count",
                vec![
                    "Có hơn 5.000 vị trí lô hết hạn; hãy chia nhỏ quy trình theo kho hoặc khu vực"
                        .into(),
                ],
            ));
        }
        let line_count = lines.len();
        let mut data = Map::new();
        data.insert("warehouse".into(), json!(warehouse));
        data.insert("adjustment_lines".into(), json!(lines));
        data.insert("reason".into(), json!("damage"));
        data.insert("note".into(), json!(note));
        let count = self
            .create_in(&tx, actor, tenant, &entity, data, &Opts::top())
            .await?;
        tx.commit().await?;
        let id = count
            .get("id")
            .cloned()
            .ok_or_else(|| ApiError::internal("Created expiry write-off count has no id"))?;
        Ok(json!({
            "id": id,
            "warehouseId": warehouse,
            "lineCount": line_count,
            "status": "draft",
            "existing": false,
        }))
    }

    /// Lists positive on-hand stock in lots that are expired or near expiry.
    pub async fn inventory_lot_expiry_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        days: i32,
        limit: usize,
        offset: usize,
    ) -> R<Value> {
        if !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "inventory.lot.read")?;
        self.authorize(tenant, actor, "inventory.stock_move.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let grouped = "SELECT lot.id AS lot_id, lot.code, lot.expiry, lot.expiry - $2::date AS days_to_expiry, lot.expiry < $2::date AS expired, \
             product.id AS product_id, product.sku, product.name AS product, product.uom AS unit, \
             warehouse.id AS warehouse_id, warehouse.name AS warehouse, \
             SUM(CASE WHEN move.direction = 'in' THEN move.qty::numeric ELSE -move.qty::numeric END) AS quantity, \
             SUM(CASE WHEN move.direction = 'in' THEN COALESCE(move.total_cost, 0)::numeric ELSE -COALESCE(move.total_cost, 0)::numeric END) + \
             COALESCE((SELECT SUM(va.capitalized_amount::numeric) FROM inventory__valuation_adjustment va JOIN inventory__stock_move layer ON layer.tenant_id=va.tenant_id AND layer.id=va.stock_move WHERE va.tenant_id=lot.tenant_id AND layer.product=lot.product AND layer.lot=lot.id::text AND layer.warehouse IS NOT DISTINCT FROM warehouse.id),0) AS value \
           FROM inventory__lot lot \
           JOIN master_data__product product ON product.tenant_id = lot.tenant_id AND product.id = lot.product \
           JOIN inventory__stock_move move ON move.tenant_id = lot.tenant_id AND move.lot = lot.id::text \
           LEFT JOIN inventory__warehouse warehouse ON warehouse.tenant_id = move.tenant_id AND warehouse.id = move.warehouse \
           WHERE lot.tenant_id = $1 AND lot.expiry IS NOT NULL \
             AND (lot.expiry < $2::date OR ($3 > 0 AND lot.expiry <= $2::date + $3)) \
           GROUP BY lot.tenant_id, lot.id, lot.code, lot.expiry, product.id, product.sku, product.name, product.uom, warehouse.id, warehouse.name \
           HAVING SUM(CASE WHEN move.direction = 'in' THEN move.qty::numeric ELSE -move.qty::numeric END) > 0.000001";
        let count_sql =
            format!("SELECT jsonb_build_object('count', COUNT(*)) FROM ({grouped}) lot_balances");
        let today = tenant.business_today();
        let count = tx
            .query_json(&count_sql, &[&tenant.id, &today, &days])
            .await?
            .first()
            .and_then(|row| row.get("count"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let limit_sql = limit as i64;
        let offset_sql = offset as i64;
        let rows_sql = format!(
            "SELECT jsonb_build_object( \
               'lotId', lot_id, 'code', code, 'expiry', expiry, 'daysToExpiry', days_to_expiry, 'expired', expired, \
               'productId', product_id, 'sku', sku, 'product', product, 'unit', unit, \
               'warehouseId', warehouse_id, 'warehouse', warehouse, 'quantity', quantity, 'value', value \
               ) FROM ({grouped}) lot_balances ORDER BY expiry, product, warehouse NULLS FIRST, lot_id LIMIT $4 OFFSET $5"
        );
        let items = tx
            .query_json(
                &rows_sql,
                &[&tenant.id, &today, &days, &limit_sql, &offset_sql],
            )
            .await?;
        Ok(json!({
            "days": days,
            "items": items,
            "itemCount": count,
            "limit": limit,
            "offset": offset,
            "hasMore": offset.saturating_add(items.len()) < count as usize,
        }))
    }

    /// Shows the tenant-scoped movement history and remaining balance for a tracked lot.
    pub async fn inventory_lot_traceability_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        lot_id: &str,
        limit: usize,
        offset: usize,
    ) -> R<Value> {
        if !tenant.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "inventory.lot.read")?;
        self.authorize(tenant, actor, "inventory.stock_move.read")?;
        let lot_id = Uuid::parse_str(lot_id)
            .map_err(|_| ApiError::new(422, "INVALID_LOT", "lot must be a valid UUID"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let lot = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', lot.id, 'code', lot.code, 'productId', product.id, \
                   'sku', product.sku, 'product', product.name, 'unit', product.uom, \
                   'expiry', lot.expiry, 'expired', lot.expiry < $3::date \
                 ) FROM inventory__lot lot \
                 JOIN master_data__product product ON product.tenant_id = lot.tenant_id AND product.id = lot.product \
                 WHERE lot.tenant_id = $1 AND lot.id = $2",
                &[&tenant.id, &lot_id, &tenant.business_today()],
            )
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| ApiError::not_found("Lot not found for this tenant"))?;
        let movement_count = tx
            .query_json(
                "SELECT COUNT(*) AS count FROM inventory__stock_move WHERE tenant_id = $1 AND lot = $2::text",
                &[&tenant.id, &lot_id],
            )
            .await?
            .first()
            .and_then(|row| row.get("count"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let limit_sql = limit as i64;
        let offset_sql = offset as i64;
        let movements = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', sm.id, 'at', sm.created_at, 'direction', sm.direction, \
                   'quantity', sm.qty, 'unitCost', sm.unit_cost, 'totalCost', sm.total_cost, \
                   'landedCost', COALESCE((SELECT SUM(va.amount) FROM inventory__valuation_adjustment va WHERE va.tenant_id=sm.tenant_id AND va.stock_move=sm.id),0), \
                   'remainingLandedCost', COALESCE((SELECT SUM(va.capitalized_amount) FROM inventory__valuation_adjustment va WHERE va.tenant_id=sm.tenant_id AND va.stock_move=sm.id),0), \
                   'warehouseId', warehouse.id, 'warehouse', warehouse.name, \
                   'locationId', location.id, 'locationCode', location.code, 'location', location.name, \
                   'source', sm.source, 'sourceId', sm.source_id, \
                   'sourceEntity', CASE WHEN sm.source = 'production_order_bom' AND EXISTS (SELECT 1 FROM manufacturing__rework_order ro WHERE ro.tenant_id = sm.tenant_id AND ro.id::text = sm.source_id) THEN 'manufacturing.rework_order' ELSE CASE sm.source \
                     WHEN 'sales_order' THEN 'sales.sales_order' \
                     WHEN 'sales_return' THEN 'sales.sales_return' \
                     WHEN 'purchase_receipt' THEN 'purchasing.purchase_receipt' \
                     WHEN 'purchase_return' THEN 'purchasing.purchase_return' \
                     WHEN 'quality_return' THEN 'quality.inspection' \
                     WHEN 'pos_order' THEN 'pos.pos_order' \
                     WHEN 'pos_order_refund' THEN 'pos.pos_order' \
                     WHEN 'stock_transfer_in' THEN 'inventory.stock_transfer' \
                     WHEN 'stock_transfer_out' THEN 'inventory.stock_transfer' \
                     WHEN 'stock_count' THEN 'inventory.stock_count' \
                     WHEN 'production_order' THEN 'manufacturing.production_order' \
                     WHEN 'production_order_bom' THEN 'manufacturing.production_order' \
                     WHEN 'production_rework' THEN 'manufacturing.rework_order' \
                     WHEN 'harvest' THEN 'agriculture.harvest' \
                     WHEN 'input_application' THEN 'agriculture.input_application' \
                     WHEN 'work_order' THEN 'field-service.work_order' \
                     WHEN 'table_order' THEN 'restaurant.table_order' \
                     WHEN 'repair_order' THEN 'auto-service.repair_order' \
                     WHEN 'prescription' THEN 'clinic.prescription' \
                     WHEN 'maintenance' THEN 'maintenance.maintenance_request' \
                     ELSE NULL END END \
                 ) FROM inventory__stock_move sm \
                 LEFT JOIN inventory__warehouse warehouse ON warehouse.tenant_id = sm.tenant_id AND warehouse.id = sm.warehouse \
                 LEFT JOIN inventory__warehouse_location location ON location.tenant_id = sm.tenant_id AND location.id = sm.location \
                 WHERE sm.tenant_id = $1 AND sm.lot = $2::text \
                 ORDER BY sm.created_at, sm.id LIMIT $3 OFFSET $4",
                &[&tenant.id, &lot_id, &limit_sql, &offset_sql],
            )
            .await?;
        let balances = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'warehouseId', warehouse.id, 'warehouse', warehouse.name, \
                   'quantity', SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END), \
                   'value', SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END) + \
                     COALESCE((SELECT SUM(va.capitalized_amount::numeric) FROM inventory__valuation_adjustment va JOIN inventory__stock_move layer ON layer.tenant_id=va.tenant_id AND layer.id=va.stock_move WHERE va.tenant_id=$1 AND layer.lot=$2::text AND layer.warehouse IS NOT DISTINCT FROM warehouse.id),0) \
                 ) FROM inventory__stock_move sm \
                 LEFT JOIN inventory__warehouse warehouse ON warehouse.tenant_id = sm.tenant_id AND warehouse.id = sm.warehouse \
                 WHERE sm.tenant_id = $1 AND sm.lot = $2::text \
                 GROUP BY warehouse.id, warehouse.name \
                 HAVING abs(SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END)) > 0.000001 \
                    OR abs(SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END) + COALESCE((SELECT SUM(va.capitalized_amount::numeric) FROM inventory__valuation_adjustment va JOIN inventory__stock_move layer ON layer.tenant_id=va.tenant_id AND layer.id=va.stock_move WHERE va.tenant_id=$1 AND layer.lot=$2::text AND layer.warehouse IS NOT DISTINCT FROM warehouse.id),0)) > 0.005 \
                 ORDER BY warehouse.name NULLS FIRST, warehouse.id",
                &[&tenant.id, &lot_id],
            )
            .await?;
        let total_quantity = balances
            .iter()
            .filter_map(|balance| balance.get("quantity").and_then(money::decimal))
            .sum::<Decimal>();
        let total_value = balances
            .iter()
            .filter_map(|balance| balance.get("value").and_then(money::decimal))
            .sum::<Decimal>();
        Ok(json!({
            "lot": lot,
            "quantity": money::json_number(total_quantity),
            "value": money::json_number(total_value),
            "movementCount": movements.len(),
            "movementCountTotal": movement_count,
            "movementLimit": limit,
            "movementOffset": offset,
            "hasMoreMovements": offset.saturating_add(movements.len()) < movement_count as usize,
            "balances": balances,
            "movements": movements,
        }))
    }

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
        let business_today = tenant.business_today();
        let business_timezone = tenant.business_timezone().to_string();
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
                   'productId', p.id, 'sku', p.sku, 'product', p.name, 'uomId', p.uom, 'unit', u.name, \
                   'warehouseId', w.id, 'warehouse', w.name, \
                   'lotId', lot.id, 'lotCode', lot.code, 'layerId', layer.id, 'layerOriginId', layer.fifo_origin_id, \
                   'layerReceivedAt', layer.created_at, 'layerQty', layer.qty, 'heldQty', qi.held_qty, \
                   'unitCost', COALESCE(qi.unit_cost, layer.unit_cost, 0), \
                   'heldValue', qi.held_qty * COALESCE(qi.unit_cost, layer.unit_cost, 0), \
                   'daysHeld', GREATEST($4::date - (qi.created_at AT TIME ZONE $5)::date, 0) \
                 ) FROM held_inspections qi \
                 JOIN master_data__product p ON p.tenant_id = qi.tenant_id AND p.id = qi.product \
                 LEFT JOIN master_data__uom u ON u.tenant_id = p.tenant_id AND u.id = p.uom \
                 JOIN inventory__warehouse w ON w.tenant_id = qi.tenant_id AND w.id = qi.warehouse \
                 LEFT JOIN inventory__lot lot ON lot.tenant_id = qi.tenant_id AND lot.id = qi.lot \
                 LEFT JOIN source_layers layer ON layer.tenant_id = qi.tenant_id AND layer.source = qi.source \
                   AND layer.source_id = qi.source_id AND layer.product = qi.product AND layer.warehouse = qi.warehouse \
                   AND layer.lot IS NOT DISTINCT FROM qi.lot::text \
                   AND layer.unit_cost IS NOT DISTINCT FROM round(COALESCE(qi.unit_cost, 0)::numeric, 4) \
                   AND round(layer.qty::numeric, 6) = round(qi.qty::numeric, 6) AND layer.layer_ordinal = qi.layer_ordinal \
                 WHERE qi.held_qty > 0.000001 \
                 ORDER BY qi.created_at, qi.id",
                &[&tenant.id, &warehouse, &status, &business_today, &business_timezone],
            )
            .await?;
        let held_value = items.iter().try_fold(Decimal::ZERO, |total, item| {
            total.checked_add(item.get("heldValue").and_then(money::decimal)?)
        });
        let (Some(held_value), Some(held_qty_by_unit)) =
            (held_value, quality_held_qty_by_unit(&items))
        else {
            return Err(ApiError::validation(
                "inventory.quality_report",
                vec!["Quality hold report values exceed the supported decimal range".into()],
            ));
        };
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
            "heldQtyByUnit": held_qty_by_unit,
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
                   'value', SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END) + \
                     COALESCE((SELECT SUM(va.capitalized_amount::numeric) FROM inventory__valuation_adjustment va JOIN inventory__stock_move layer ON layer.tenant_id=va.tenant_id AND layer.id=va.stock_move WHERE va.tenant_id=$1 AND layer.product=p.id AND layer.warehouse=w.id AND layer.location IS NOT DISTINCT FROM l.id),0) \
                 ) FROM inventory__stock_move sm \
                 JOIN inventory__warehouse w ON w.tenant_id = sm.tenant_id AND w.id = sm.warehouse \
                 LEFT JOIN inventory__warehouse_location l ON l.tenant_id = sm.tenant_id AND l.id = sm.location \
                 JOIN master_data__product p ON p.tenant_id = sm.tenant_id AND p.id = sm.product \
                 WHERE sm.tenant_id = $1 AND ($2::uuid IS NULL OR sm.warehouse = $2) \
                 GROUP BY w.id, w.name, l.id, l.code, l.name, p.id, p.sku, p.name \
                 HAVING abs(SUM(CASE WHEN sm.direction = 'in' THEN sm.qty::numeric ELSE -sm.qty::numeric END)) > 0.000001 \
                    OR abs(SUM(CASE WHEN sm.direction = 'in' THEN COALESCE(sm.total_cost, 0)::numeric ELSE -COALESCE(sm.total_cost, 0)::numeric END) + COALESCE((SELECT SUM(va.capitalized_amount::numeric) FROM inventory__valuation_adjustment va JOIN inventory__stock_move layer ON layer.tenant_id=va.tenant_id AND layer.id=va.stock_move WHERE va.tenant_id=$1 AND layer.product=p.id AND layer.warehouse=w.id AND layer.location IS NOT DISTINCT FROM l.id),0)) > 0.005 \
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
