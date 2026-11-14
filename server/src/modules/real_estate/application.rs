//! Real-estate workflows that must update their property register atomically.
use super::{domain, persistence};
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::{Datelike, Duration};
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if matches!(
        event_type,
        "real-estate.reservation.reserved"
            | "real-estate.reservation.cancelled"
            | "real-estate.reservation.expired"
            | "real-estate.reservation.converted"
    ) {
        return handle_reservation_event(kernel, tx, tenant, event_type, document, event_id, depth)
            .await;
    }
    let lease_activated = event_type == domain::LEASE_ACTIVATED_EVENT;
    let lease_terminated = event_type == domain::LEASE_TERMINATED_EVENT;
    let rent_due = event_type == domain::LEASE_RENT_DUE_EVENT;
    if rent_due {
        return bill_due_rent(kernel, tx, tenant, document, event_id, depth).await;
    }
    if !lease_activated && !lease_terminated {
        return Ok(false);
    }
    let lease_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Lease event requires a valid lease record".into()],
            )
        })?;
    if lease_activated {
        let start = domain::date(document, "start_date").ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Active lease requires a valid start date".into()],
            )
        })?;
        let lease = kernel.ent(tenant, "real-estate.lease")?;
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &lease,
                &lease_id.to_string(),
                Map::from_iter([("next_rent_date".into(), json!(start.to_string()))]),
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
    } else {
        let lease = kernel.ent(tenant, "real-estate.lease")?;
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &lease,
                &lease_id.to_string(),
                Map::from_iter([("next_rent_date".into(), Value::Null)]),
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
    }
    let property = domain::leased_property(document).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Activated lease requires a valid property".into()],
        )
    })?;
    let Some(property_status) = persistence::lock_property_status(tx, tenant, property).await?
    else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Lease property was not found for this tenant".into()],
        ));
    };
    let action = if lease_activated {
        if property_status == "leased" {
            return Ok(true);
        }
        "leased"
    } else {
        let lease_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Terminated lease requires a valid lease record".into()],
                )
            })?;
        if persistence::has_other_active_lease(tx, tenant, property, lease_id).await? {
            return Ok(true);
        }
        if property_status != "leased" {
            return Ok(true);
        }
        "released"
    };
    let entity = kernel.ent(tenant, "real-estate.property")?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &property.to_string(),
            action,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

async fn handle_reservation_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let property = document
        .get("property")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Reservation event requires a valid property".into()],
            )
        })?;
    let property_status = persistence::lock_property_status(tx, tenant, property)
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Reservation property was not found for this tenant".into()],
            )
        })?;
    let property_entity = kernel.ent(tenant, "real-estate.property")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    match event_type {
        "real-estate.reservation.reserved" if property_status == "available" => {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &property_entity,
                    &property.to_string(),
                    "reserved",
                    &opts,
                )
                .await?;
        }
        "real-estate.reservation.reserved" if property_status == "reserved" => {}
        "real-estate.reservation.converted" => {
            if property_status != "reserved" {
                return Err(crate::error::ApiError::validation(
                    event_type,
                    vec![
                        "Only a held property can be converted from a reservation to a sale".into(),
                    ],
                ));
            }
            let buyer = document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        event_type,
                        vec!["Reservation conversion requires a buyer".into()],
                    )
                })?;
            let agreed_price = document.get("agreed_price").cloned().ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Reservation conversion requires an agreed sale price".into()],
                )
            })?;
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &property_entity,
                    &property.to_string(),
                    Map::from_iter([
                        ("buyer".into(), json!(buyer)),
                        ("sale_price".into(), agreed_price),
                    ]),
                    &opts,
                )
                .await?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &property_entity,
                    &property.to_string(),
                    "sold",
                    &opts,
                )
                .await?;
        }
        "real-estate.reservation.cancelled" | "real-estate.reservation.expired"
            if property_status == "reserved" =>
        {
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &property_entity,
                    &property.to_string(),
                    "released",
                    &opts,
                )
                .await?;
        }
        "real-estate.reservation.cancelled" if property_status == "available" => {}
        _ => {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Property status does not match the reservation transition".into()],
            ));
        }
    }
    Ok(true)
}

async fn bill_due_rent(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let lease_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                domain::LEASE_RENT_DUE_EVENT,
                vec!["Rent billing requires a valid lease".into()],
            )
        })?;
    let first_due = domain::date(document, "next_rent_date").ok_or_else(|| {
        crate::error::ApiError::validation(
            domain::LEASE_RENT_DUE_EVENT,
            vec!["Rent billing requires a next rent date".into()],
        )
    })?;
    let end = domain::date(document, "end_date").ok_or_else(|| {
        crate::error::ApiError::validation(
            domain::LEASE_RENT_DUE_EVENT,
            vec!["Rent billing requires the lease end date".into()],
        )
    })?;
    let start = domain::date(document, "start_date").unwrap_or(first_due);
    let party = document
        .get("tenant")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                domain::LEASE_RENT_DUE_EVENT,
                vec!["Rent billing requires a tenant party".into()],
            )
        })?;
    let amount = document.get("rent").cloned().ok_or_else(|| {
        crate::error::ApiError::validation(
            domain::LEASE_RENT_DUE_EVENT,
            vec!["Rent billing requires an amount".into()],
        )
    })?;
    let today = chrono::Utc::now().date_naive();
    let anchor = start.day();
    let months = domain::interval_months(document);
    let rent_cycle = kernel.ent(tenant, "real-estate.rent_cycle")?;
    let mut due = first_due;
    let mut created = 0;
    while due <= today && due <= end && created < 24 {
        let next = domain::next_anchor_date(due, anchor, months).ok_or_else(|| {
            crate::error::ApiError::validation(
                domain::LEASE_RENT_DUE_EVENT,
                vec!["Cannot calculate the next rent date".into()],
            )
        })?;
        let period_end = (next - Duration::days(1)).min(end);
        let cycle = Map::from_iter([
            ("lease".into(), json!(lease_id)),
            ("party".into(), json!(party)),
            ("period_start".into(), json!(due)),
            ("period_end".into(), json!(period_end)),
            ("amount".into(), amount.clone()),
            ("due_date".into(), json!(due)),
            ("status".into(), json!("invoiced")),
        ]);
        kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &rent_cycle,
                cycle,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        created += 1;
        due = next;
    }
    let next_value = if due <= end { json!(due) } else { Value::Null };
    let lease = kernel.ent(tenant, "real-estate.lease")?;
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &lease,
            &lease_id.to_string(),
            Map::from_iter([("next_rent_date".into(), next_value)]),
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
