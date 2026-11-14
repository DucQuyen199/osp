use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::{domain, persistence};

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("loyalty") {
        return Ok(false);
    }
    let Some(kind) = domain::event_kind(event_type) else {
        return Ok(false);
    };
    let source_id = document.get("id").and_then(Value::as_str).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Loyalty source event requires an id".into()],
        )
    })?;
    let (party, txn_source, change) = match kind {
        domain::PointsEvent::Earn { source } => {
            let Some(party) = domain::party_id(document) else {
                return Ok(false);
            };
            let total = document
                .get("total")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            let points = domain::points_for(total).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Loyalty source total exceeds the supported decimal range".into()],
                )
            })?;
            if points <= Decimal::ZERO {
                return Ok(true);
            }
            (party, source, points)
        }
        domain::PointsEvent::Reverse { source } => {
            let Some(party) = domain::party_id(document) else {
                return Ok(false);
            };
            if !persistence::transaction_exists(tx, tenant, "pos_order", source_id).await? {
                return Ok(true);
            }
            let total = document
                .get("total")
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            let points = domain::points_for(total).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Loyalty refund total exceeds the supported decimal range".into()],
                )
            })?;
            if points <= Decimal::ZERO {
                return Ok(true);
            }
            let change = Decimal::ZERO.checked_sub(points).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Loyalty point reversal exceeds the supported decimal range".into()],
                )
            })?;
            (party, source, change)
        }
        domain::PointsEvent::ReverseSalesReturn => {
            if persistence::transaction_exists(tx, tenant, "sales_return", source_id).await? {
                return Ok(true);
            }
            let Some((party, points)) = persistence::sales_return_reversal(
                tx,
                tenant,
                Uuid::parse_str(source_id).map_err(|_| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Sales return id must be a valid UUID".into()],
                    )
                })?,
            )
            .await?
            else {
                return Ok(true);
            };
            let change = Decimal::ZERO.checked_sub(points).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Loyalty point reversal exceeds the supported decimal range".into()],
                )
            })?;
            (party, "sales_return", change)
        }
    };
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    if persistence::transaction_exists(tx, tenant, txn_source, source_id).await? {
        return Ok(true);
    }
    let Some((member_id, balance)) = persistence::lock_member(tx, tenant, party).await? else {
        return Ok(true);
    };
    let new_balance = balance
        .checked_add(change)
        .filter(|balance| *balance >= Decimal::ZERO);
    let Some(new_balance) = new_balance else {
        return Err(ApiError::validation(
            event_type,
            vec!["Số dư điểm sau giao dịch không được âm hoặc vượt giới hạn".into()],
        ));
    };
    let txn = kernel.ent(tenant, "loyalty.point_txn")?;
    let mut entry = Map::new();
    entry.insert("party".into(), json!(party));
    let change_value = money::json_number(change).ok_or_else(|| {
        ApiError::validation(
            event_type,
            vec!["Điểm giao dịch vượt giới hạn Decimal".into()],
        )
    })?;
    entry.insert("points".into(), change_value);
    entry.insert("source".into(), json!(txn_source));
    entry.insert("source_id".into(), json!(source_id));
    kernel
        .create_in(tx, &Actor::System, tenant, &txn, entry, &opts)
        .await?;
    let entity = kernel.ent(tenant, "loyalty.member")?;
    let mut patch = Map::new();
    let balance_value = money::json_number(new_balance).ok_or_else(|| {
        ApiError::validation(event_type, vec!["Số dư điểm vượt giới hạn Decimal".into()])
    })?;
    patch.insert("points".into(), balance_value);
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &member_id.to_string(),
            patch,
            &opts,
        )
        .await?;
    Ok(true)
}
