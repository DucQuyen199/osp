//! Shipment completion and source-event use cases for sales.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Hash, PartialEq, Eq)]
struct PriceBucket(Decimal, Option<String>);

fn sales_amount_error() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "sales.amount",
        vec!["Sales quantity exceeds the supported decimal range".into()],
    )
}

fn shipment_quantities(lines: &Value) -> R<HashMap<(String, PriceBucket), Decimal>> {
    let mut quantities = HashMap::new();
    for line in lines.as_array().into_iter().flatten() {
        if matches!(
            line.get("kind").and_then(Value::as_str),
            Some("service" | "digital")
        ) {
            continue;
        }
        let (Some(product), Some(price), Some(qty)) = (
            line.get("product").and_then(Value::as_str),
            line.get("price").and_then(money::decimal),
            line.get("qty").and_then(money::decimal),
        ) else {
            continue;
        };
        let price_bucket = PriceBucket(
            price.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero),
            line.get("uom").and_then(Value::as_str).map(str::to_owned),
        );
        let quantity = quantities
            .entry((product.into(), price_bucket))
            .or_insert(Decimal::ZERO);
        *quantity = quantity.checked_add(qty).ok_or_else(sales_amount_error)?;
    }
    Ok(quantities)
}

pub(in crate::modules::sales) async fn all_order_quantities_delivered(
    tx: &Tx<'_>,
    tenant: &Tenant,
    order_id: Uuid,
    order_lines: &Value,
) -> R<bool> {
    let ordered = shipment_quantities(order_lines)?;
    let delivered_rows = tx.query(
        "SELECT COALESCE(delivered_lines, lines) FROM logistics__shipment WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND status = 'delivered'",
        &[&tenant.id, &order_id.to_string()],
    ).await?;
    let mut delivered = HashMap::<(String, PriceBucket), Decimal>::new();
    for row in delivered_rows {
        let lines: Value = row.get(0);
        for (key, qty) in shipment_quantities(&lines)? {
            let delivered_qty = delivered.entry(key).or_insert(Decimal::ZERO);
            *delivered_qty = delivered_qty
                .checked_add(qty)
                .ok_or_else(sales_amount_error)?;
        }
    }
    Ok(ordered.iter().all(|(key, qty)| {
        delivered
            .get(key)
            .copied()
            .unwrap_or_default()
            .checked_add(Decimal::new(1, 6))
            .is_some_and(|delivered| delivered >= *qty)
    }))
}

pub(in crate::modules::sales) async fn has_delivered_order_quantities(
    tx: &Tx<'_>,
    tenant: &Tenant,
    order_id: Uuid,
) -> R<bool> {
    let rows = tx.query(
        "SELECT COALESCE(delivered_lines, lines) FROM logistics__shipment WHERE tenant_id = $1 AND source = 'sales_order' AND source_id = $2 AND status = 'delivered'",
        &[&tenant.id, &order_id.to_string()],
    ).await?;
    for row in rows {
        let lines: Value = row.get(0);
        if shipment_quantities(&lines)?
            .values()
            .any(|qty| *qty > Decimal::new(1, 6))
        {
            return Ok(true);
        }
    }
    Ok(false)
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
    let child = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    match event_type {
        "sales.sales_order.cancelled"
            if document.get("source").and_then(Value::as_str) == Some("ecommerce") =>
        {
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Cancelled ecommerce sale requires a valid source order id".into()],
                    )
                })?;
            let Some(order) = tx
                .query_opt(
                    "SELECT status FROM ecommerce__web_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &source_id],
                )
                .await?
            else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Source ecommerce order was not found for this tenant".into()],
                ));
            };
            if order.get::<_, String>(0) == "placed" {
                let entity = kernel.ent(tenant, "ecommerce.web_order")?;
                kernel
                    .act_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &entity,
                        &source_id.to_string(),
                        "cancelled",
                        &child,
                    )
                    .await?;
            }
            return Ok(true);
        }
        "crm.deal.won" | "sales.quotation.accepted" => {
            let mut data = Map::new();
            let mut put = |target: &str, source: &str| {
                if let Some(value) = document.get(source) {
                    data.insert(target.into(), value.clone());
                }
            };
            match event_type {
                "crm.deal.won" => {
                    put("party", "party");
                    put("total", "amount");
                    data.insert("source".into(), json!("crm_deal"));
                }
                "sales.quotation.accepted" => {
                    for field in [
                        "party",
                        "warehouse",
                        "shipping_address",
                        "price_list",
                        "lines",
                        "total",
                    ] {
                        put(field, field);
                    }
                    data.insert("source".into(), json!("quotation"));
                }
                _ => return Ok(false),
            }
            let source_id = document.get("id").cloned().ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Sales source document requires an id".into()],
                )
            })?;
            data.insert("source_id".into(), source_id);
            let entity = kernel.ent(tenant, "sales.sales_order")?;
            kernel
                .create_in(tx, &Actor::System, tenant, &entity, data, &child)
                .await?;
            Ok(true)
        }
        "logistics.shipment.delivered"
            if document.get("source").and_then(Value::as_str) == Some("sales_order") =>
        {
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Sales shipment requires a valid source order id".into()],
                    )
                })?;
            let row = tx
                .query_opt(
                    "SELECT id, status, lines FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &source_id],
                )
                .await?;
            let Some(row) = row else {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec!["Source sales order was not found for this tenant".into()],
                ));
            };
            let order_id: Uuid = row.get(0);
            let order_status: String = row.get(1);
            let order_lines: Value = row.get(2);
            if !all_order_quantities_delivered(tx, tenant, order_id, &order_lines).await? {
                if order_status == "confirmed" {
                    let entity = kernel.ent(tenant, "sales.sales_order")?;
                    kernel
                        .act_in(
                            tx,
                            &Actor::System,
                            tenant,
                            &entity,
                            &order_id.to_string(),
                            "partially_delivered",
                            &child,
                        )
                        .await?;
                }
                return Ok(true);
            }
            let entity = kernel.ent(tenant, "sales.sales_order")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &order_id.to_string(),
                    "delivered",
                    &child,
                )
                .await?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
