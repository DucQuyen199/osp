use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::{domain, persistence};

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity != "reservation" {
        return Ok(Vec::new());
    }
    let check_in = document
        .get("check_in")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let check_out = document
        .get("check_out")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let (Some(check_in), Some(check_out)) = (check_in, check_out) else {
        return Ok(vec![
            "Reservation needs valid check-in and check-out dates".into(),
        ]);
    };
    let nights = check_out.signed_duration_since(check_in).num_days();
    if nights <= 0 {
        return Ok(vec![
            "Check-out date must be later than check-in date".into(),
        ]);
    }
    let room = document
        .get("room")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let room_type = if let Some(room) = room {
        let Some(room_type) = tx
            .query_opt(
                "SELECT room_type FROM hotel__room WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &room],
            )
            .await?
        else {
            return Ok(vec!["Assigned room was not found in this tenant".into()]);
        };
        let room_type: Uuid = room_type.get(0);
        if document
            .get("room_type")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .is_some_and(|declared| declared != room_type)
        {
            return Ok(vec![
                "Assigned room does not match the selected room type".into(),
            ]);
        }
        document.insert("room_type".into(), json!(room_type));
        room_type
    } else if let Some(room_type) = document
        .get("room_type")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    {
        room_type
    } else {
        return Ok(vec!["Select a room type or assign a room".into()]);
    };
    let Some(type_row) = tx
        .query_opt(
            "SELECT rate::text FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &room_type],
        )
        .await?
    else {
        return Ok(vec![
            "Selected room type was not found in this tenant".into(),
        ]);
    };
    if let Some(room) = room {
        let actual_type = tx
            .query_opt(
                "SELECT room_type FROM hotel__room WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &room],
            )
            .await?
            .map(|row| row.get::<_, Uuid>(0));
        if actual_type != Some(room_type) {
            return Ok(vec![
                "Assigned room changed room type during reservation preparation".into(),
            ]);
        }
    }
    let rate = if document.contains_key("nightly_rate") {
        let Some(rate) = document.get("nightly_rate").and_then(money::decimal) else {
            return Ok(vec!["Nightly room rate must be a decimal amount".into()]);
        };
        rate
    } else {
        let Some(rate_text) = type_row.get::<_, Option<String>>(0) else {
            return Ok(vec!["Selected room type needs a nightly rate".into()]);
        };
        let rate = money::decimal_str(&rate_text).ok_or_else(|| {
            ApiError::validation(
                "hotel.room_type.rate",
                vec!["Stored room type rate is not a valid decimal amount".into()],
            )
        })?;
        let value = money::json_number(rate).ok_or_else(|| {
            ApiError::validation(
                "hotel.reservation.nightly_rate",
                vec!["Room rate exceeds the supported decimal range".into()],
            )
        })?;
        document.insert("nightly_rate".into(), value);
        rate
    };
    if rate < Decimal::ZERO {
        return Ok(vec!["Nightly room rate must be nonnegative".into()]);
    }
    let reservation_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let charges = if let Some(reservation_id) = reservation_id {
        let total_text: String = tx
            .query_one_row(
                "SELECT COALESCE(SUM(amount), 0)::text FROM hotel__folio_charge WHERE tenant_id = $1 AND reservation = $2",
                &[&tenant.id, &reservation_id],
            )
            .await?
            .get(0);
        money::decimal_str(&total_text).ok_or_else(|| {
            ApiError::validation(
                "hotel.reservation.folio",
                vec!["Stored folio total is not a valid decimal amount".into()],
            )
        })?
    } else {
        Decimal::ZERO
    };
    let total = rate
        .checked_mul(Decimal::from(nights))
        .and_then(|room_total| room_total.checked_add(charges))
        .map(|total| total.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
        .ok_or_else(|| {
            ApiError::validation(
                "hotel.reservation.total",
                vec!["Reservation total exceeds the supported decimal range".into()],
            )
        })?;
    let total = money::json_number(total).ok_or_else(|| {
        ApiError::validation(
            "hotel.reservation.total",
            vec!["Reservation total cannot be serialized".into()],
        )
    })?;
    document.insert("nights".into(), json!(nights));
    document.insert("total".into(), total);
    Ok(Vec::new())
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
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    if domain::is_folio_charge(event_type) {
        let reservation = document
            .get("reservation")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Folio charge requires a valid reservation".into()],
                )
            })?;
        let amount = document
            .get("amount")
            .and_then(money::decimal)
            .filter(|amount| *amount >= Decimal::ZERO)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Folio charge amount must be finite and non-negative".into()],
                )
            })?;
        let Some((reservation_id, total, status)) =
            persistence::lock_reservation(tx, tenant, reservation).await?
        else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Folio reservation was not found for this tenant".into()],
            ));
        };
        if !matches!(status.as_str(), "booked" | "checked_in") {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec![
                    "Folio charges can only be added to a booked or checked-in reservation".into(),
                ],
            ));
        }
        let entity = kernel.ent(tenant, "hotel.reservation")?;
        let mut patch = Map::new();
        let updated_total = total
            .checked_add(amount)
            .map(|total| total.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
            .and_then(money::json_number)
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Updated reservation total exceeds the supported decimal range".into()],
                )
            })?;
        patch.insert("total".into(), updated_total);
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &reservation_id.to_string(),
                patch,
                &opts,
            )
            .await?;
        return Ok(true);
    }

    let Some(room_action) = domain::room_transition(event_type) else {
        return Ok(false);
    };
    let Some(room_id) = domain::room_id(document) else {
        if document.get("room").is_none_or(Value::is_null) {
            return Ok(false);
        }
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Reservation room must be a valid room id".into()],
        ));
    };
    if !persistence::lock_room(tx, tenant, room_id).await? {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Reservation room was not found for this tenant".into()],
        ));
    }
    let entity = kernel.ent(tenant, "hotel.room")?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &room_id.to_string(),
            room_action,
            &opts,
        )
        .await?;
    Ok(true)
}
