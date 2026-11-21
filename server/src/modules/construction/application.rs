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
        "progress_claim" => trim(document, &["notes"]),
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
    if event_type == "construction.material_request.created" {
        create_purchase_requisition(kernel, tx, tenant, document, event_id, depth).await?;
        return Ok(true);
    }
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

async fn create_purchase_requisition(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    request: &Value,
    event_id: uuid::Uuid,
    depth: u32,
) -> R<()> {
    let request_id = request
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| crate::error::ApiError::internal("Material request has no id"))?;
    let boq_id = request
        .get("boq")
        .and_then(Value::as_str)
        .ok_or_else(|| crate::error::ApiError::internal("Material request has no BOQ"))?;
    let boq_uuid = uuid::Uuid::parse_str(boq_id).map_err(|_| {
        crate::error::ApiError::validation(
            "construction.material_request",
            vec!["BOQ reference is invalid".into()],
        )
    })?;
    let row = tx
        .query_opt(
            "SELECT items FROM construction__boq WHERE tenant_id=$1 AND id=$2 AND status='approved' FOR SHARE",
            &[&tenant.id, &boq_uuid],
        )
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "construction.material_request",
                vec!["Only an approved BOQ can create a purchase requisition".into()],
            )
        })?;
    let items: Value = row.get(0);
    let lines = items
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, item)| {
            let product = item.get("product")?.as_str()?;
            let uom = item.get("uom")?.as_str()?;
            let qty = item.get("qty")?;
            Some(serde_json::json!({
                "product": product,
                "uom": uom,
                "qty": qty,
                "description": item.get("description").cloned().unwrap_or(Value::Null),
                "source_line_index": index,
            }))
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return Err(crate::error::ApiError::validation(
            "construction.material_request",
            vec!["The approved BOQ has no linked material lines".into()],
        ));
    }

    let mut requisition = Map::new();
    for field in [
        "warehouse",
        "sourcing_method",
        "supplier",
        "requested_by",
        "reason",
    ] {
        if let Some(value) = request.get(field).filter(|value| !value.is_null()) {
            requisition.insert(field.to_owned(), value.clone());
        }
    }
    requisition.insert("lines".into(), Value::Array(lines));
    requisition.insert(
        "source".into(),
        Value::String("construction_material_request".into()),
    );
    requisition.insert("source_id".into(), Value::String(request_id.to_owned()));
    let requisition_entity = kernel.ent(tenant, "purchasing.purchase_requisition")?;
    let created = kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &requisition_entity,
            requisition,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    let requisition_id = created
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| crate::error::ApiError::internal("Purchase requisition has no id"))?;
    let request_uuid = uuid::Uuid::parse_str(request_id)
        .map_err(|_| crate::error::ApiError::internal("Material request id is invalid"))?;
    let requisition_uuid = uuid::Uuid::parse_str(requisition_id)
        .map_err(|_| crate::error::ApiError::internal("Purchase requisition id is invalid"))?;
    let updated = tx
        .execute(
            "UPDATE construction__material_request SET purchase_requisition=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
            &[&requisition_uuid, &tenant.id, &request_uuid],
        )
        .await?;
    if updated != 1 {
        return Err(crate::error::ApiError::internal(
            "Unable to persist the material request purchase link",
        ));
    }
    Ok(())
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
    if let Some(items) = document.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            for field in ["unit", "description"] {
                if let Some(value) = item
                    .get(field)
                    .and_then(Value::as_str)
                    .map(|value| value.trim().to_owned())
                {
                    item[field] = Value::String(value);
                }
            }
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
