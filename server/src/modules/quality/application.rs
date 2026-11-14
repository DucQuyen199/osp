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
            let entity = kernel.ent(tenant, "quality.inspection")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &inspection_id.to_string(),
                    "retest",
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
            let open = tx
                .query(
                    "SELECT id FROM quality__nonconformance WHERE tenant_id = $1 AND inspection = $2 AND status = 'open' ORDER BY created_at, id FOR UPDATE",
                    &[&tenant.id, &inspection_id],
                )
                .await?;
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
