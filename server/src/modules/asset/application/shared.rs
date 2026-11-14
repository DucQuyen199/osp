//! Helpers shared by fixed-asset application workflows.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub(super) fn asset_amount_error() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "asset.amount",
        vec!["Asset amount exceeds the supported decimal range".into()],
    )
}

pub(super) fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "asset.amount",
            vec![format!(
                "Stored asset {field} is not a valid decimal amount"
            )],
        )
    })
}

pub(super) fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(asset_amount_error)
}

pub(super) fn optional_decimal(document: &Value, field: &str) -> Option<Decimal> {
    match document.get(field) {
        None | Some(Value::Null) => Some(Decimal::ZERO),
        Some(value) => money::decimal(value),
    }
}

pub(super) async fn account_id(tx: &Tx<'_>, tenant: &Tenant, code: &str) -> R<Uuid> {
    tx.query_opt(
        "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = $2",
        &[&tenant.id, &code],
    )
    .await?
    .map(|row| row.get(0))
    .ok_or_else(|| {
        crate::error::ApiError::validation(
            "asset.accounting",
            vec![format!("Required accounting account {code} is missing")],
        )
    })
}

pub(super) async fn post_journal(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_id: Uuid,
    depth: u32,
    memo: &str,
    amount: Decimal,
    source: &str,
    source_id: &str,
    lines: Vec<Value>,
) -> R<()> {
    if amount <= Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "asset.accounting",
            vec!["Asset journal amount must be positive".into()],
        ));
    }
    let entity = kernel.ent(tenant, "accounting.journal_entry")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let mut data = Map::new();
    data.insert("memo".into(), json!(memo));
    data.insert("amount".into(), decimal_json(amount)?);
    data.insert("source".into(), json!(source));
    data.insert("source_id".into(), json!(source_id));
    data.insert("lines".into(), Value::Array(lines));
    let entry = kernel
        .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
        .await?;
    let entry_id = entry["id"]
        .as_str()
        .ok_or_else(|| crate::error::ApiError::internal("Created asset journal entry has no id"))?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            entry_id,
            "posted",
            &opts,
        )
        .await?;
    Ok(())
}

pub(super) fn line(account: Uuid, debit: Decimal, credit: Decimal) -> R<Value> {
    Ok(json!({
        "account": account,
        "debit": decimal_json(debit)?,
        "credit": decimal_json(credit)?
    }))
}
