//! Real-estate workflows that must update their property register atomically.
use super::{domain, persistence};
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::{Datelike, Duration};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// Keep rent billing aligned with an approved addendum on a lease-linked
/// contract. The caller applies this within the same tenant transaction as the
/// contract amendment, so later rent cycles use the approved terms only.
async fn apply_lease_amendment(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    lease_id: Uuid,
    amendment_id: Uuid,
    effective_date: &str,
    changes: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<()> {
    let Some(row) = tx
        .query_opt(
            "SELECT jsonb_build_object('status', status, 'start_date', start_date, 'end_date', end_date, 'next_rent_date', next_rent_date, 'billing_interval', billing_interval) FROM real_estate__lease WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &lease_id],
        )
        .await?
    else {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Lease nguồn của hợp đồng không còn tồn tại".into()],
        ));
    };
    let lease: Value = row.get(0);
    if lease.get("status").and_then(Value::as_str) != Some("active") {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Chỉ lease đang hoạt động mới nhận điều chỉnh từ phụ lục".into()],
        ));
    }
    let Some(changes) = changes.as_object() else {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Nội dung phụ lục không hợp lệ".into()],
        ));
    };
    let Some(effective_date) = chrono::NaiveDate::parse_from_str(effective_date, "%Y-%m-%d").ok()
    else {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Ngày hiệu lực phụ lục không hợp lệ".into()],
        ));
    };
    let today = tenant.business_today();
    let old_end = domain::date(&lease, "end_date");
    let new_end = match changes.get("end_date") {
        Some(Value::Null) => {
            return Err(crate::error::ApiError::validation(
                "contract.amendment.applied",
                vec!["Lease bất động sản phải duy trì ngày kết thúc xác định".into()],
            ));
        }
        Some(value) => value
            .as_str()
            .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()),
        None => old_end,
    };
    if new_end.is_none_or(|end| end < effective_date) {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Ngày kết thúc lease phải bằng hoặc sau ngày hiệu lực phụ lục".into()],
        ));
    }
    let new_end = new_end.expect("validated lease end date");
    if (changes.contains_key("value") || changes.contains_key("end_date"))
        && let Some(next_rent) = domain::date(&lease, "next_rent_date")
        && next_rent <= today
        && next_rent < effective_date
        && next_rent <= new_end
    {
        return Err(crate::error::ApiError::validation(
            "contract.amendment.applied",
            vec!["Hãy lập hóa đơn kỳ thuê đến hạn trước khi áp dụng thay đổi lease".into()],
        ));
    }

    let mut patch = Map::from_iter([
        (
            "amendment_in_progress".into(),
            json!(amendment_id.to_string()),
        ),
        ("last_amendment".into(), json!(amendment_id.to_string())),
    ]);
    if let Some(value) = changes.get("value") {
        if value.is_null()
            || !crate::money::decimal(value).is_some_and(|amount| amount >= Decimal::ZERO)
        {
            return Err(crate::error::ApiError::validation(
                "contract.amendment.applied",
                vec!["Giá thuê sau điều chỉnh phải là số không âm".into()],
            ));
        }
        patch.insert("rent".into(), value.clone());
    }
    if let Some(value) = changes.get("end_date") {
        patch.insert("end_date".into(), value.clone());
    }

    let next_rent = domain::date(&lease, "next_rent_date");
    let updated_next = if let Some(next_rent) = next_rent {
        if next_rent > new_end {
            Some(None)
        } else {
            None
        }
    } else if old_end.is_some_and(|end| new_end > end) {
        let start = domain::date(&lease, "start_date").ok_or_else(|| {
            crate::error::ApiError::validation(
                "contract.amendment.applied",
                vec!["Lease cần ngày bắt đầu để tính kỳ thu tiếp theo".into()],
            )
        })?;
        let mut due = start;
        let anchor = start.day();
        let months = domain::interval_months(&lease);
        let mut periods = 0;
        while due <= effective_date && periods < 1200 {
            due = domain::next_anchor_date(due, anchor, months).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "contract.amendment.applied",
                    vec!["Không thể tính kỳ thu tiếp theo của lease".into()],
                )
            })?;
            periods += 1;
        }
        Some((due <= new_end).then_some(due))
    } else {
        None
    };
    if let Some(next_rent) = updated_next {
        patch.insert(
            "next_rent_date".into(),
            next_rent.map(|date| json!(date)).unwrap_or(Value::Null),
        );
    }

    let entity = kernel.ent(tenant, "real-estate.lease")?;
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &lease_id.to_string(),
            patch,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(())
}

async fn handle_contract_amendment(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let Some(contract_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Err(crate::error::ApiError::validation(
            "contract.contract.amended",
            vec!["Sự kiện hợp đồng cần mã UUID hợp lệ".into()],
        ));
    };
    let Some(amendment_id) = document
        .get("last_amendment")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(false);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT c.source, c.source_id, a.effective_date::text, a.changes FROM contract__contract c JOIN contract__amendment a ON a.tenant_id = c.tenant_id AND a.contract = c.id WHERE c.tenant_id = $1 AND c.id = $2 AND a.id = $3 AND a.status = 'effective' FOR SHARE OF c, a",
            &[&tenant.id, &contract_id, &amendment_id],
        )
        .await?
    else {
        return Ok(false);
    };
    let source: Option<String> = row.get(0);
    if source.as_deref() != Some("real_estate_lease") {
        return Ok(false);
    }
    let source_id: Option<String> = row.get(1);
    let lease_id = source_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "contract.contract.amended",
                vec!["Hợp đồng lease không có mã nguồn hợp lệ".into()],
            )
        })?;
    let effective_date: String = row.get(2);
    let changes: Value = row.get(3);
    apply_lease_amendment(
        kernel,
        tx,
        tenant,
        lease_id,
        amendment_id,
        &effective_date,
        &changes,
        event_id,
        depth,
    )
    .await?;
    Ok(true)
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
    if event_type == "contract.contract.amended" {
        return handle_contract_amendment(kernel, tx, tenant, document, event_id, depth).await;
    }
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
    let today = tenant.business_today();
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
