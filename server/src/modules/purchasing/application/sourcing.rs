use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

type PurchaseLineKey = (Uuid, Decimal, Option<Uuid>);

fn accumulate_lines(
    quantities: &mut std::collections::BTreeMap<PurchaseLineKey, Decimal>,
    lines: &Value,
    source: &str,
    event_type: &str,
) -> R<()> {
    let Some(lines) = lines.as_array() else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec![format!(
                "{source} lines are invalid; received quantities cannot be verified"
            )],
        ));
    };
    if lines.is_empty() {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec![format!(
                "{source} has no lines; received quantities cannot be verified"
            )],
        ));
    }
    for (index, line) in lines.iter().enumerate() {
        let Some(product) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec![format!(
                    "{source} line {} has an invalid product",
                    index + 1
                )],
            ));
        };
        let Some(price) = line.get("price").and_then(money::decimal) else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec![format!("{source} line {} has an invalid price", index + 1)],
            ));
        };
        let Some(qty) = line.get("qty").and_then(money::decimal) else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec![format!(
                    "{source} line {} has an invalid quantity",
                    index + 1
                )],
            ));
        };
        if price < Decimal::ZERO || qty <= Decimal::ZERO {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec![format!(
                    "{source} line {} has a negative price or nonpositive quantity",
                    index + 1
                )],
            ));
        }
        let unit = match line.get("uom") {
            Some(Value::String(value)) => Some(Uuid::parse_str(value).map_err(|_| {
                crate::error::ApiError::validation(
                    event_type,
                    vec![format!("{source} line {} has an invalid unit", index + 1)],
                )
            })?),
            Some(value) if !value.is_null() => {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec![format!("{source} line {} has an invalid unit", index + 1)],
                ));
            }
            _ => None,
        };
        let total = quantities
            .entry((product, price, unit))
            .or_insert(Decimal::ZERO);
        *total = total.checked_add(qty).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec![format!(
                    "{source} quantities exceed the supported decimal range"
                )],
            )
        })?;
    }
    Ok(())
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    receipt: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "purchasing.purchase_receipt.received" {
        return Ok(false);
    }
    let receipt_id = receipt
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Purchase receipt requires a valid id".into()],
            )
        })?;
    let order_id = receipt
        .get("purchase_order")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Purchase receipt requires a valid purchase order".into()],
            )
        })?;
    let order = tx
        .query_opt(
            "SELECT status, lines FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Purchase order was not found for this tenant".into()],
            )
        })?;
    let status: String = order.get(0);
    let order_lines: Value = order.get(1);
    let mut ordered = std::collections::BTreeMap::<PurchaseLineKey, Decimal>::new();
    accumulate_lines(&mut ordered, &order_lines, "Purchase order", event_type)?;
    let receipts = tx
        .query(
            "SELECT id, lines FROM purchasing__purchase_receipt WHERE tenant_id = $1 AND purchase_order = $2 AND status = 'received'",
            &[&tenant.id, &order_id],
        )
        .await?;
    if !receipts
        .iter()
        .any(|row| row.get::<_, Uuid>(0) == receipt_id)
    {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Received receipt is missing from the purchase order history".into()],
        ));
    }
    let mut received = std::collections::BTreeMap::<PurchaseLineKey, Decimal>::new();
    for row in receipts {
        let lines: Value = row.get(1);
        accumulate_lines(
            &mut received,
            &lines,
            "Received purchase receipt",
            event_type,
        )?;
    }
    let complete = !ordered.is_empty()
        && ordered.iter().all(|(key, quantity)| {
            received
                .get(key)
                .copied()
                .unwrap_or_default()
                .checked_add(Decimal::new(1, 6))
                .is_some_and(|amount| amount >= *quantity)
        });
    let entity = kernel.ent(tenant, "purchasing.purchase_order")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    match (status.as_str(), complete) {
        ("received", true) => {}
        ("approved" | "partially_received", true) => {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &order_id.to_string(),
                    "received",
                    &opts,
                )
                .await?;
        }
        ("approved", false) => {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &order_id.to_string(),
                    "partially_received",
                    &opts,
                )
                .await?;
        }
        ("partially_received", false) => {}
        _ => {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Purchase order is not eligible for additional receipt posting".into()],
            ));
        }
    }
    Ok(true)
}

pub async fn create_order_from_requisition(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    requisition: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Value> {
    create_order_from_source(
        kernel,
        tx,
        tenant,
        requisition,
        "purchase_requisition",
        event_id,
        depth,
    )
    .await
}

pub async fn create_order_from_rfq(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    rfq: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Value> {
    create_order_from_source(kernel, tx, tenant, rfq, "rfq", event_id, depth).await
}

async fn create_order_from_source(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    source: &Value,
    source_type: &str,
    event_id: Uuid,
    depth: u32,
) -> R<Value> {
    let (source_table, expected_status, event_type) = match source_type {
        "purchase_requisition" => (
            "purchasing__purchase_requisition",
            "approved",
            "purchasing.purchase_requisition.approved",
        ),
        "rfq" => ("purchasing__rfq", "accepted", "purchasing.rfq.accepted"),
        _ => {
            return Err(crate::error::ApiError::validation(
                "purchasing.purchase_order",
                vec!["Unsupported purchase order source".into()],
            ));
        }
    };
    let source_id = source
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Purchase order source requires a valid id".into()],
            )
        })?;
    let sql =
        format!("SELECT status FROM {source_table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE");
    let source_row = tx
        .query_opt(&sql, &[&tenant.id, &source_id])
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Purchase order source was not found for this tenant".into()],
            )
        })?;
    let source_status: String = source_row.get(0);
    if source_status != expected_status {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec![format!(
                "Purchase order source must be {expected_status} before conversion"
            )],
        ));
    }
    if let Some(existing) = tx
        .query_opt(
            "SELECT id FROM purchasing__purchase_order WHERE tenant_id = $1 AND source = $2 AND source_id = $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &source_type, &source_id.to_string()],
        )
        .await?
    {
        let id: Uuid = existing.get(0);
        return Ok(json!({ "id": id.to_string() }));
    }
    let entity = kernel.ent(tenant, "purchasing.purchase_order")?;
    let mut order = Map::new();
    for field in ["supplier", "warehouse", "department"] {
        if let Some(value) = source.get(field) {
            order.insert(field.to_string(), value.clone());
        }
    }
    let lines_field = if source_type == "rfq" {
        "quote_lines"
    } else {
        "lines"
    };
    if let Some(lines) = source.get(lines_field) {
        order.insert("lines".into(), lines.clone());
    }
    order.insert("source".into(), Value::String(source_type.into()));
    order.insert("source_id".into(), Value::String(source_id.to_string()));
    let created = kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            order,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    if source_type == "rfq"
        && let Some(requisition_id) = source
            .get("purchase_requisition")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    {
        let requisition_entity = kernel.ent(tenant, "purchasing.purchase_requisition")?;
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &requisition_entity,
                &requisition_id.to_string(),
                "sourced",
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        let rfq_entity = kernel.ent(tenant, "purchasing.rfq")?;
        let competing_quotes = tx
            .query(
                "SELECT id FROM purchasing__rfq WHERE tenant_id = $1 AND purchase_requisition = $2 AND id <> $3 AND status IN ('sent', 'quoted') ORDER BY id FOR UPDATE",
                &[&tenant.id, &requisition_id, &source_id],
            )
            .await?;
        for quote in competing_quotes {
            let quote_id: Uuid = quote.get(0);
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &rfq_entity,
                    &quote_id.to_string(),
                    "rejected",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        }
    }
    Ok(created)
}
