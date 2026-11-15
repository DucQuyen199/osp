use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// Post inventory valuation entries for the supported operational stock sources.
/// This replaces catalog subscribers so cost postings stay Rust-owned and atomic.
pub async fn post_stock_movement(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    movement: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("accounting") {
        return Ok(false);
    }
    let direction = movement
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source = movement
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(total_cost) = movement
        .get("total_cost")
        .and_then(money::decimal)
        .filter(|value| *value > Decimal::ZERO)
    else {
        return Ok(false);
    };
    let pre_invoice_purchase_return = if direction == "out"
        && matches!(source, "purchase_return" | "quality_return")
    {
        let return_source_id = movement
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if let Some(return_source_id) = return_source_id {
            let return_record = if source == "quality_return" {
                tx.query_opt("SELECT purchase_order,supplier_invoice FROM purchasing__purchase_return WHERE tenant_id=$1 AND inspection=$2 FOR UPDATE", &[&tenant.id, &return_source_id]).await?
            } else {
                tx.query_opt("SELECT purchase_order,supplier_invoice FROM purchasing__purchase_return WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&tenant.id, &return_source_id]).await?
            };
            let has_bill = if let Some(return_record) = return_record {
                let order_id: Uuid = return_record.get(0);
                let invoice_id: Option<Uuid> = return_record.get(1);
                if let Some(invoice_id) = invoice_id {
                    tx.query_opt(
                        "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND supplier_invoice_id=$2::text AND status IN ('posted','partially_paid','partially_settled','paid','settled') LIMIT 1 FOR UPDATE",
                        &[&tenant.id, &invoice_id.to_string()],
                    ).await?.is_some()
                } else {
                    tx.query_opt(
                        "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2::text AND supplier_invoice_id IS NULL AND status IN ('posted','partially_paid','partially_settled','paid','settled') LIMIT 1 FOR UPDATE",
                        &[&tenant.id, &order_id],
                    ).await?.is_some()
                }
            } else {
                false
            };
            !has_bill
        } else {
            false
        }
    } else {
        false
    };
    let (debit_code, credit_code) = if pre_invoice_purchase_return {
        ("GRNI", "156")
    } else {
        match (direction, source) {
            (
                "out",
                "sales_order" | "pos_order" | "work_order" | "table_order" | "repair_order"
                | "prescription" | "maintenance",
            ) => ("632", "156"),
            ("in", "sales_return" | "pos_order_refund") => ("156", "632"),
            ("in", "purchase_receipt") => ("156", "GRNI"),
            ("out", "production_order_bom") => ("154", "156"),
            ("in", "production_order" | "production_rework" | "production_concession") => {
                ("156", "154")
            }
            ("in", "stock_count") => ("156", "642"),
            ("out", "stock_count") => ("642", "156"),
            ("out", "purchase_return" | "quality_return") => return Ok(false),
            _ => return Ok(false),
        }
    };
    let Some(movement_id) = movement
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(crate::error::ApiError::validation(
            "inventory.stock_move",
            vec!["Stock movement requires a valid id before posting its valuation".into()],
        ));
    };
    let lock_key = format!("accounting.stock_move:{}:{}", tenant.id, movement_id);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    if tx.query_opt(
        "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'stock_move' AND source_id = $2 LIMIT 1",
        &[&tenant.id, &movement_id.to_string()],
    ).await?.is_some() { return Ok(false); }
    let account_id = |code: &'static str| async move {
        tx.query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = $2 FOR SHARE",
            &[&tenant.id, &code],
        )
        .await
        .map(|row| row.map(|row| row.get::<_, Uuid>(0)))
    };
    let debit = account_id(debit_code).await?;
    let credit = if credit_code == "GRNI" {
        Some(
            super::super::application::ensure_account(
                kernel,
                tx,
                tenant,
                "GRNI",
                "Hàng đã nhận chưa có hóa đơn",
                "liability",
            )
            .await?,
        )
    } else {
        account_id(credit_code).await?
    };
    let (Some(debit), Some(credit)) = (debit, credit) else {
        return Err(crate::error::ApiError::validation(
            "accounting.journal_entry",
            vec![format!(
                "Missing required inventory posting accounts {debit_code}/{credit_code}"
            )],
        ));
    };
    let amount_value = money::json_number(total_cost).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.journal_entry",
            vec!["Stock valuation exceeds the supported financial range".into()],
        )
    })?;
    let mut entry = Map::new();
    entry.insert(
        "memo".into(),
        json!(format!("Inventory valuation: {source}")),
    );
    entry.insert("amount".into(), amount_value.clone());
    entry.insert("source".into(), json!("stock_move"));
    entry.insert("source_id".into(), json!(movement_id.to_string()));
    entry.insert(
        "lines".into(),
        json!([
            { "account": debit, "debit": amount_value.clone(), "credit": 0 },
            { "account": credit, "debit": 0, "credit": amount_value }
        ]),
    );
    let entity = kernel.ent(tenant, "accounting.journal_entry")?;
    let options = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let created = kernel
        .create_in(tx, &Actor::System, tenant, &entity, entry, &options)
        .await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    kernel
        .act_in(tx, &Actor::System, tenant, &entity, id, "posted", &options)
        .await?;
    Ok(true)
}
