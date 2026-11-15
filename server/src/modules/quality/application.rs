use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "quality.amount",
            vec![format!(
                "Stored quality {field} is not a valid decimal amount"
            )],
        )
    })
}

fn optional_decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "quality.amount",
                    vec![format!(
                        "Stored quality {field} is not a valid decimal amount"
                    )],
                )
            })
        })
        .transpose()
        .map(|value| value.unwrap_or(Decimal::ZERO))
}

fn id(document: &Value, key: &str) -> Option<Uuid> {
    document
        .get(key)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn event_opts(event_id: Uuid, depth: u32) -> Opts {
    Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    }
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let opts = event_opts(event_id, depth);
    match event_type {
        "manufacturing.rework_order.done" => {
            let inspection_id = id(document, "inspection").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Completed rework requires its quality-inspection id".into()],
                )
            })?;
            let production_order_id = id(document, "production_order").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Completed rework requires its production-order id".into()],
                )
            })?;
            let rework_order_id = id(document, "id").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Completed rework requires its rework-order id".into()],
                )
            })?;
            let rework = tx
                .query_opt(
                    "SELECT qi.product, qi.warehouse, qi.lot, qi.unit_cost::text FROM quality__inspection qi WHERE qi.tenant_id = $1 AND qi.id = $2 FOR SHARE",
                    &[&tenant.id, &inspection_id],
                )
                .await?
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Rework source inspection was not found".into()],
                    )
                })?;
            let qty = document
                .get("qty")
                .cloned()
                .filter(|value| money::decimal(value).is_some_and(|qty| qty > Decimal::ZERO))
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Completed rework requires a positive quantity".into()],
                    )
                })?;
            let mut data = Map::from_iter([
                ("product".into(), json!(rework.get::<_, Uuid>(0))),
                ("source".into(), json!("production_rework")),
                ("source_id".into(), json!(production_order_id)),
                ("qty".into(), qty),
                ("warehouse".into(), json!(rework.get::<_, Uuid>(1))),
                ("rework_order".into(), json!(rework_order_id)),
            ]);
            if let Some(lot) = rework.get::<_, Option<Uuid>>(2) {
                data.insert("lot".into(), json!(lot));
            }
            let unit_cost = optional_decimal_column(&rework, 3, "rework inspection unit cost")?;
            if unit_cost > Decimal::ZERO {
                data.insert(
                    "unit_cost".into(),
                    money::json_number(unit_cost).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Rework unit cost exceeds the supported decimal range".into()],
                        )
                    })?,
                );
            }
            let entity = kernel.ent(tenant, "quality.inspection")?;
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
                .await?;
            Ok(true)
        }
        "manufacturing.conditional_acceptance.approved" => {
            let acceptance_id = id(document, "id").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Approved conditional acceptance requires a valid id".into()],
                )
            })?;
            let inspection_id = id(document, "inspection").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Conditional acceptance requires its failed quality inspection".into()],
                )
            })?;
            let inspection = tx.query_opt(
                "SELECT source, source_id, product, warehouse, lot, rework_order FROM quality__inspection WHERE tenant_id = $1 AND id = $2 AND status = 'failed' FOR UPDATE",
                &[&tenant.id, &inspection_id],
            ).await?.ok_or_else(|| crate::error::ApiError::validation(
                event_type,
                vec!["Conditional acceptance source inspection is no longer failed".into()],
            ))?;
            let source: String = inspection.get(0);
            let source_id: String = inspection.get(1);
            let order_id = Uuid::parse_str(&source_id).map_err(|_| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Conditional acceptance source order is invalid".into()],
                )
            })?;
            let qty = document.get("qty").cloned().ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Conditional acceptance quantity is missing".into()],
                )
            })?;
            let mut data = Map::from_iter([
                ("product".into(), json!(inspection.get::<_, Uuid>(2))),
                ("source".into(), json!("production_concession")),
                ("source_id".into(), json!(order_id)),
                ("qty".into(), qty),
                ("warehouse".into(), json!(inspection.get::<_, Uuid>(3))),
                ("conditional_acceptance".into(), json!(acceptance_id)),
                (
                    "note".into(),
                    json!(
                        document
                            .get("condition")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    ),
                ),
            ]);
            if let Some(lot) = inspection.get::<_, Option<Uuid>>(4) {
                data.insert("lot".into(), json!(lot));
            }
            if source == "production_rework"
                && let Some(rework_order) = inspection.get::<_, Option<Uuid>>(5)
            {
                data.insert("rework_order".into(), json!(rework_order));
            }
            let entity = kernel.ent(tenant, "quality.inspection")?;
            let accepted = kernel
                .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
                .await?;
            let accepted_id = accepted.get("id").and_then(Value::as_str).ok_or_else(|| {
                crate::error::ApiError::internal(
                    "Conditional acceptance quality inspection has no id",
                )
            })?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    accepted_id,
                    "passed",
                    &opts,
                )
                .await?;
            Ok(true)
        }
        "quality.inspection_disposition.posted" => {
            let inspection_id = id(document, "inspection").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Disposition requires an inspection id".into()],
                )
            })?;
            let qty = document
                .get("qty")
                .and_then(money::decimal)
                .filter(|qty| *qty > Decimal::ZERO)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Disposition quantity must be positive".into()],
                    )
                })?;
            let inspection = tx.query_opt(
                "SELECT product, warehouse FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &inspection_id],
            ).await?;
            let Some(inspection) = inspection else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Quality inspection was not found".into()],
                ));
            };
            let product: Uuid = inspection.get(0);
            let warehouse: Uuid = inspection.get(1);
            let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let stock = tx.query_opt(
                "SELECT id, held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
                &[&tenant.id, &product, &warehouse],
            ).await?;
            let Some(stock) = stock else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["No held inventory exists for this quality inspection".into()],
                ));
            };
            let held = optional_decimal_column(&stock, 1, "held quantity")?;
            if held + Decimal::new(1, 6) < qty {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Insufficient held inventory to release this disposition".into()],
                ));
            }
            let entity = kernel.ent(tenant, "inventory.stock_level")?;
            let mut patch = Map::new();
            let remaining = held
                .checked_sub(qty)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            patch.insert(
                "held_qty".into(),
                money::json_number(remaining).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Disposition quantity exceeds the supported decimal range".into()],
                    )
                })?,
            );
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &stock.get::<_, Uuid>(0).to_string(),
                    patch,
                    &opts,
                )
                .await?;
            Ok(true)
        }
        "manufacturing.production_order.done" => {
            if document
                .get("good_qty")
                .and_then(money::decimal)
                .is_some_and(|quantity| quantity.is_zero())
            {
                // A fully scrapped batch has no finished goods to inspect or receive.
                return Ok(true);
            }
            let mut data = Map::new();
            for field in ["product", "warehouse"] {
                if let Some(value) = document.get(field) {
                    data.insert(field.into(), value.clone());
                }
            }
            let product_id = id(document, "product").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Production order requires a valid output product".into()],
                )
            })?;
            let lot_tracked = tx
                .query_opt(
                    "SELECT COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product_id],
                )
                .await?
                .is_some_and(|row| row.get::<_, bool>(0));
            if lot_tracked {
                let code = document
                    .get("output_lot_code")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|code| !code.is_empty())
                    .ok_or_else(|| {
                        crate::error::ApiError::validation(
                            event_type,
                            vec!["Thành phẩm theo dõi lô cần mã lô đầu ra".into()],
                        )
                    })?;
                let lot = kernel.ent(tenant, "inventory.lot")?;
                let mut lot_data = Map::from_iter([
                    ("product".into(), json!(product_id)),
                    ("code".into(), json!(code)),
                ]);
                if let Some(expiry) = document
                    .get("output_expiry")
                    .filter(|value| !value.is_null())
                {
                    lot_data.insert("expiry".into(), expiry.clone());
                }
                let created = kernel
                    .create_in(tx, &Actor::System, tenant, &lot, lot_data, &opts)
                    .await?;
                data.insert(
                    "lot".into(),
                    created.get("id").cloned().ok_or_else(|| {
                        crate::error::ApiError::internal("Created production lot has no id")
                    })?,
                );
            }
            data.insert(
                "qty".into(),
                document
                    .get("good_qty")
                    .cloned()
                    .or_else(|| document.get("qty").cloned())
                    .unwrap_or(Value::Null),
            );
            data.insert("source".into(), json!("production_order"));
            data.insert(
                "source_id".into(),
                document.get("id").cloned().ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Production order requires an id for quality inspection".into()],
                    )
                })?,
            );
            let entity = kernel.ent(tenant, "quality.inspection")?;
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
                .await?;
            Ok(true)
        }
        "purchasing.purchase_receipt.received" => {
            let source_id = document.get("id").cloned().ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Purchase receipt requires an id for quality inspection".into()],
                )
            })?;
            let warehouse = document.get("warehouse").cloned();
            let lines = document
                .get("lines")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let entity = kernel.ent(tenant, "quality.inspection")?;
            for line in lines {
                if line.get("product").and_then(Value::as_str).is_none()
                    || line.get("tracked") != Some(&Value::Bool(true))
                {
                    continue;
                }
                let mut data = Map::new();
                for field in ["product", "lot"] {
                    if let Some(value) = line.get(field) {
                        data.insert(field.into(), value.clone());
                    }
                }
                if let Some(qty) = line.get("base_qty").or_else(|| line.get("qty")) {
                    data.insert("qty".into(), qty.clone());
                }
                if let Some(lot) = line
                    .get("lot")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                {
                    data.insert("lot".into(), json!(lot));
                }
                if let Some(warehouse) = &warehouse {
                    data.insert("warehouse".into(), warehouse.clone());
                }
                if let Some(price) = line.get("base_price").or_else(|| line.get("price")) {
                    data.insert("unit_cost".into(), price.clone());
                }
                data.insert("source".into(), json!("purchase_receipt"));
                data.insert("source_id".into(), source_id.clone());
                kernel
                    .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
                    .await?;
            }
            Ok(true)
        }
        "quality.inspection.passed"
            if matches!(
                document.get("source").and_then(Value::as_str),
                Some("purchase_order" | "purchase_receipt")
            ) =>
        {
            let product = id(document, "product").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Purchase quality inspection requires a valid product".into()],
                )
            })?;
            let warehouse = id(document, "warehouse").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Purchase quality inspection requires a valid warehouse".into()],
                )
            })?;
            let qty = document
                .get("qty")
                .and_then(money::decimal)
                .filter(|value| *value > Decimal::ZERO)
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Purchase quality inspection quantity must be positive".into()],
                    )
                })?;
            let inspection_id = id(document, "id").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Purchase quality inspection requires an id".into()],
                )
            })?;
            let released = tx.query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                &[&tenant.id, &inspection_id],
            ).await?;
            let released = released
                .map(|row| decimal_column(&row, 0, "released quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let remaining_qty = qty
                .checked_sub(released)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let stock = tx
                .query_opt(
                    "SELECT id, held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
                    &[&tenant.id, &product, &warehouse],
                )
                .await?;
            let Some(stock) = stock else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["No held inventory exists for this purchase inspection".into()],
                ));
            };
            let held = optional_decimal_column(&stock, 1, "held quantity")?;
            if held + Decimal::new(1, 6) < remaining_qty {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Insufficient held inventory to release after QC".into()],
                ));
            }
            let stock_id: Uuid = stock.get(0);
            let entity = kernel.ent(tenant, "inventory.stock_level")?;
            let mut patch = Map::new();
            let remaining = held
                .checked_sub(remaining_qty)
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            patch.insert(
                "held_qty".into(),
                money::json_number(remaining).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Released quantity exceeds the supported decimal range".into()],
                    )
                })?,
            );
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &stock_id.to_string(),
                    patch,
                    &opts,
                )
                .await?;
            Ok(true)
        }
        "quality.inspection.failed" => {
            let mut data = Map::new();
            data.insert("title".into(), json!("Không đạt kiểm tra chất lượng"));
            data.insert("severity".into(), json!("major"));
            data.insert(
                "inspection".into(),
                document.get("id").cloned().ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Failed inspection requires an id".into()],
                    )
                })?,
            );
            for field in ["note", "source", "source_id"] {
                if let Some(value) = document.get(field) {
                    let target = if field == "note" {
                        "description"
                    } else {
                        field
                    };
                    data.insert(target.into(), value.clone());
                }
            }
            let entity = kernel.ent(tenant, "quality.nonconformance")?;
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
                .await?;
            Ok(true)
        }
        "quality.inspection.passed" => {
            let inspection_id = id(document, "id").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Passed inspection requires an id".into()],
                )
            })?;
            let entity = kernel.ent(tenant, "quality.nonconformance")?;
            let mut open = tx
                .query(
                    "SELECT id FROM quality__nonconformance WHERE tenant_id = $1 AND inspection = $2 AND status = 'open' ORDER BY created_at, id FOR UPDATE",
                    &[&tenant.id, &inspection_id],
                )
                .await?;
            if matches!(
                document.get("source").and_then(Value::as_str),
                Some("production_rework" | "production_concession")
            ) {
                if let Some(order_id) = id(document, "source_id") {
                    let accepted = tx.query_opt(
                        "SELECT COALESCE(po.good_qty, po.qty)::text, COALESCE(SUM(qi.qty::numeric) FILTER (WHERE qi.source IN ('production_rework', 'production_concession') AND qi.status = 'passed'), 0)::text, COALESCE((SELECT SUM(pd.qty::numeric) FROM manufacturing__production_disposition pd JOIN quality__inspection inspected ON inspected.tenant_id = pd.tenant_id AND inspected.id = pd.inspection WHERE pd.tenant_id = po.tenant_id AND inspected.source_id = po.id::text AND inspected.source IN ('production_order', 'production_rework') AND pd.status = 'posted'), 0)::text FROM manufacturing__production_order po LEFT JOIN quality__inspection qi ON qi.tenant_id = po.tenant_id AND qi.source_id = po.id::text WHERE po.tenant_id = $1 AND po.id = $2 GROUP BY po.id, po.good_qty, po.qty",
                        &[&tenant.id, &order_id],
                    ).await?;
                    if let Some(accepted) = accepted {
                        let planned_good =
                            decimal_column(&accepted, 0, "accepted production quantity")?;
                        let reworked_good = decimal_column(&accepted, 1, "passed rework quantity")?;
                        let disposed_qty =
                            decimal_column(&accepted, 2, "disposed production quantity")?;
                        if reworked_good
                            .checked_add(disposed_qty)
                            .is_some_and(|total| {
                                money::within_tolerance(total, planned_good, Decimal::new(1, 6))
                            })
                        {
                            let initial = tx.query(
                                "SELECT nc.id FROM quality__nonconformance nc JOIN quality__inspection qi ON qi.tenant_id = nc.tenant_id AND qi.id = nc.inspection WHERE nc.tenant_id = $1 AND qi.source = 'production_order' AND qi.source_id = $2 AND nc.status = 'open' ORDER BY nc.created_at, nc.id FOR UPDATE OF nc",
                                &[&tenant.id, &order_id.to_string()],
                            ).await?;
                            open.extend(initial);
                        }
                    }
                }
            }
            for row in open {
                let nonconformance_id: Uuid = row.get(0);
                kernel
                    .act_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &entity,
                        &nonconformance_id.to_string(),
                        "closed",
                        &opts,
                    )
                    .await?;
            }
            Ok(true)
        }
        "manufacturing.production_disposition.posted" => {
            let inspection_id = id(document, "inspection").ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Production scrap disposition requires a quality-inspection id".into()],
                )
            })?;
            let inspection = tx.query_opt(
                "SELECT source, source_id, qty::text FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &inspection_id],
            ).await?;
            let Some(inspection) = inspection else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Production quality inspection was not found".into()],
                ));
            };
            let source: String = inspection.get(0);
            let order_id = inspection
                .get::<_, String>(1)
                .parse::<Uuid>()
                .map_err(|_| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Inspection source order is invalid".into()],
                    )
                })?;
            let inspected_qty = decimal_column(&inspection, 2, "inspection quantity")?;
            let scrapped = tx.query_one_row(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM manufacturing__production_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                &[&tenant.id, &inspection_id],
            ).await?;
            let scrapped_qty = decimal_column(&scrapped, 0, "disposed inspection quantity")?;
            let order = tx.query_opt(
                "SELECT COALESCE(good_qty, qty)::text FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &order_id],
            ).await?;
            let mut close_order_nc = false;
            if let Some(order) = order {
                let good_qty = decimal_column(&order, 0, "accepted production quantity")?;
                let received = tx.query_one_row(
                    "SELECT COALESCE(SUM(sm.qty::numeric), 0)::text FROM inventory__stock_move sm LEFT JOIN manufacturing__rework_order ro ON ro.tenant_id = sm.tenant_id AND ro.id::text = sm.source_id WHERE sm.tenant_id = $1 AND sm.direction = 'in' AND ((sm.source IN ('production_order', 'production_concession') AND sm.source_id = $2) OR (sm.source = 'production_rework' AND ro.production_order::text = $2))",
                    &[&tenant.id, &order_id.to_string()],
                ).await?;
                let received_qty = decimal_column(&received, 0, "received production quantity")?;
                let disposed = tx.query_one_row(
                    "SELECT COALESCE(SUM(pd.qty::numeric), 0)::text FROM manufacturing__production_disposition pd JOIN quality__inspection qi ON qi.tenant_id = pd.tenant_id AND qi.id = pd.inspection WHERE pd.tenant_id = $1 AND qi.source_id = $2 AND qi.source IN ('production_order', 'production_rework') AND pd.status = 'posted'",
                    &[&tenant.id, &order_id.to_string()],
                ).await?;
                let disposed_qty = decimal_column(&disposed, 0, "disposed production quantity")?;
                close_order_nc = received_qty.checked_add(disposed_qty).is_some_and(|total| {
                    money::within_tolerance(total, good_qty, Decimal::new(1, 6))
                });
            }
            if !matches!(
                source.as_str(),
                "production_order" | "production_rework" | "production_concession"
            ) {
                return Ok(false);
            }
            if scrapped_qty
                .checked_add(Decimal::new(1, 6))
                .is_some_and(|total| total < inspected_qty)
                && !close_order_nc
            {
                return Ok(true);
            }
            let open = if close_order_nc {
                tx.query(
                    "SELECT nc.id FROM quality__nonconformance nc JOIN quality__inspection qi ON qi.tenant_id = nc.tenant_id AND qi.id = nc.inspection WHERE nc.tenant_id = $1 AND qi.source_id = $2 AND qi.source IN ('production_order', 'production_rework') AND nc.status = 'open' ORDER BY nc.created_at, nc.id FOR UPDATE OF nc",
                    &[&tenant.id, &order_id.to_string()],
                ).await?
            } else {
                tx.query(
                    "SELECT id FROM quality__nonconformance WHERE tenant_id = $1 AND inspection = $2 AND status = 'open' ORDER BY created_at, id FOR UPDATE",
                    &[&tenant.id, &inspection_id],
                ).await?
            };
            let entity = kernel.ent(tenant, "quality.nonconformance")?;
            for row in open {
                let nonconformance_id: Uuid = row.get(0);
                kernel
                    .act_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &entity,
                        &nonconformance_id.to_string(),
                        "closed",
                        &opts,
                    )
                    .await?;
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}
