//! Normalize construction commands and calculate trusted BOQ totals.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value};

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    match entity {
        "site" => trim(document, &["name", "address"]),
        "subcontract" => trim(document, &["scope"]),
        "site_diary" => trim(document, &["weather", "notes"]),
        "boq" => prepare_boq(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: uuid::Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "construction.boq.approved" {
        return Ok(false);
    }
    let Some(previous_id) = document
        .get("supersedes")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return Ok(true);
    };
    let entity = kernel.ent(tenant, "construction.boq")?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            previous_id,
            "superseded",
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

fn trim(document: &mut Map<String, Value>, fields: &[&str]) -> R<Vec<String>> {
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value));
        }
    }
    Ok(Vec::new())
}

async fn prepare_boq(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if document.get("revision").is_none_or(Value::is_null) {
        let revision = if let Some(parent) = document
            .get("supersedes")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        {
            let Some(row) = tx.query_opt(
                "SELECT revision::text FROM construction__boq WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                &[&tenant.id, &parent],
            ).await? else {
                return Ok(vec!["BOQ gốc điều chỉnh không tồn tại trong doanh nghiệp".into()]);
            };
            let previous: String = row.get(0);
            crate::money::decimal_str(&previous).unwrap_or_default() + rust_decimal::Decimal::ONE
        } else {
            rust_decimal::Decimal::ONE
        };
        document.insert(
            "revision".into(),
            crate::money::json_number(revision).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "construction.boq.revision",
                    vec!["BOQ revision cannot be represented".into()],
                )
            })?,
        );
    }
    if document.get("number").is_none_or(Value::is_null) {
        if let Some(project) = document
            .get("project")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        {
            let revision = document
                .get("revision")
                .and_then(crate::money::decimal)
                .unwrap_or(rust_decimal::Decimal::ONE);
            document.insert(
                "number".into(),
                Value::String(format!(
                    "BOQ-{}-R{}",
                    &project.simple().to_string()[..8],
                    revision
                )),
            );
        }
    }
    let Some(items) = document.get("items").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut total = Decimal::ZERO;
    for item in items {
        let qty = item.get("qty").and_then(money::decimal).unwrap_or_default();
        let unit_price = item
            .get("unit_price")
            .and_then(money::decimal)
            .unwrap_or_default();
        let Some(line_total) = qty.checked_mul(unit_price) else {
            return Ok(vec![
                "BOQ line value exceeds the supported decimal range".into(),
            ]);
        };
        let Some(updated_total) = total.checked_add(line_total) else {
            return Ok(vec!["BOQ total exceeds the supported decimal range".into()]);
        };
        total = updated_total;
    }
    let total = total.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let value = money::json_number(total).ok_or_else(|| {
        crate::error::ApiError::validation(
            "construction.boq",
            vec!["BOQ total exceeds the supported decimal range".into()],
        )
    })?;
    document.insert("total".into(), value);
    Ok(Vec::new())
}
