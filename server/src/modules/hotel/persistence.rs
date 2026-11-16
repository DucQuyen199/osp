use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub async fn lock_reservation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    id: Uuid,
) -> R<Option<(Uuid, Decimal, String)>> {
    let Some(row) = tx
        .query_opt(
            "SELECT id, COALESCE(total, 0)::text, status FROM hotel__reservation WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?
    else {
        return Ok(None);
    };
    let total_text: String = row.get(1);
    let total = money::decimal_str(&total_text).ok_or_else(|| {
        ApiError::validation(
            "hotel.reservation.total",
            vec!["Stored reservation total is not a valid decimal amount".into()],
        )
    })?;
    Ok(Some((row.get(0), total, row.get(2))))
}

pub async fn lock_room(tx: &Tx<'_>, tenant: &Tenant, id: Uuid) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT id FROM hotel__room WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?
        .is_some())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "room" && action == "maintenance" {
        let Some(room_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Room maintenance requires a valid room id".into()]);
        };
        let Some(room_type) = tx
            .query_opt(
                "SELECT room_type FROM hotel__room WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &room_id],
            )
            .await?
            .map(|row| row.get::<_, Uuid>(0))
        else {
            return Ok(vec!["Room was not found in this tenant".into()]);
        };
        tx.query_opt(
            "SELECT id FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &room_type],
        )
        .await?;
        let Some(room) = tx
            .query_opt(
                "SELECT status FROM hotel__room WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &room_id],
            )
            .await?
        else {
            return Ok(vec!["Room was not found in this tenant".into()]);
        };
        if room.get::<_, String>(0) != "cleaning" {
            return Ok(vec![
                "Only a room awaiting cleaning can be placed into maintenance".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND room = $2 AND status IN ('booked', 'checked_in') LIMIT 1",
                &[&tenant.id, &room_id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Reassign active reservations before taking this room out of service".into()]);
        }
        let would_overbook: bool = tx
            .query_one_row(
                "WITH active AS ( \
                   SELECT reservation.check_in, reservation.check_out \
                   FROM hotel__reservation reservation \
                   LEFT JOIN hotel__room assigned ON assigned.tenant_id = reservation.tenant_id AND assigned.id = reservation.room \
                   WHERE reservation.tenant_id = $1 AND COALESCE(assigned.room_type, reservation.room_type) = $2 \
                     AND reservation.status IN ('booked', 'checked_in') \
                 ), capacity AS ( \
                   SELECT COUNT(*)::bigint AS rooms FROM hotel__room \
                   WHERE tenant_id = $1 AND room_type = $2 AND id <> $3 AND status <> 'maintenance' \
                 ) \
                 SELECT EXISTS ( \
                   SELECT 1 FROM (SELECT DISTINCT check_in AS day FROM active) dates CROSS JOIN capacity \
                   WHERE (SELECT COUNT(*) FROM active WHERE check_in <= dates.day AND check_out > dates.day) > capacity.rooms \
                 )",
                &[&tenant.id, &room_type, &room_id],
            )
            .await?
            .get(0);
        if would_overbook {
            return Ok(vec!["Reassign reservations or resolve the room-type capacity conflict before maintenance".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "room" && matches!(action, "occupied" | "cleaning" | "ready") {
        let Some(room_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Room action requires a valid room id".into()]);
        };
        let valid = match action {
            "occupied" => tx
                .query_opt(
                    "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND room = $2 AND status = 'checked_in' LIMIT 1",
                    &[&tenant.id, &room_id],
                )
                .await?
                .is_some(),
            "cleaning" => tx
                .query_opt(
                    "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND room = $2 AND status = 'checked_out' ORDER BY check_out DESC LIMIT 1",
                    &[&tenant.id, &room_id],
                )
                .await?
                .is_some(),
            "ready" => tx
                .query_opt(
                    "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND room = $2 AND status = 'checked_in' LIMIT 1",
                    &[&tenant.id, &room_id],
                )
                .await?
                .is_none(),
            _ => false,
        };
        if !valid {
            return Ok(vec![
                "Room status must be synchronized from a valid reservation transition".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "room" && action == "removed" {
        let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(Vec::new());
        };
        let Some(room_type) = tx
            .query_opt(
                "SELECT room_type FROM hotel__room WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &id],
            )
            .await?
        else {
            return Ok(Vec::new());
        };
        let room_type: Uuid = room_type.get(0);
        tx.query_opt(
            "SELECT id FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &room_type],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM hotel__room WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id],
            )
            .await?
            .is_none()
        {
            return Ok(Vec::new());
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__reservation WHERE tenant_id = $1 AND room = $2 LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "Room history is referenced by reservations and must be retained".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "room_type" && action == "removed" {
        let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(Vec::new());
        };
        tx.query_opt(
            "SELECT id FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__room WHERE tenant_id = $1 AND room_type = $2 UNION ALL SELECT 1 FROM hotel__reservation WHERE tenant_id = $1 AND room_type = $2 LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Room type referenced by rooms or reservations cannot be removed".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "room" && matches!(action, "created" | "updated") {
        let Some(room_type) = document
            .get("room_type")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Room requires a valid room type in this tenant".into(),
            ]);
        };
        if tx
            .query_opt(
                "SELECT id FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &room_type],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Room type was not found in this tenant".into()]);
        }
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        let number = document
            .get("number")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__room WHERE tenant_id = $1 AND number = $2 AND id <> $3 LIMIT 1",
                &[&tenant.id, &number, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Room number must be unique within the tenant".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "room_type" && action == "updated" {
        let Some(room_type) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Room type id is required".into()]);
        };
        if let Some(capacity) = document.get("capacity").and_then(crate::money::decimal) {
            let capacity_text = capacity.normalize().to_string();
            if tx
                .query_opt(
                    "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND room_type = $2 AND status IN ('booked', 'checked_in') AND COALESCE(guest_count, 1)::numeric > $3::numeric LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &room_type, &capacity_text],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Không thể giảm sức chứa xuống thấp hơn số khách của một đặt phòng đang hoạt động".into(),
                ]);
            }
        }
        return Ok(Vec::new());
    }
    if entity == "reservation" && matches!(action, "created" | "updated") {
        let Some(party) = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Reservation requires a valid guest".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Guest was not found in this tenant".into()]);
        }
        let Some(check_in) = document
            .get("check_in")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            return Ok(vec!["Reservation check-in date is invalid".into()]);
        };
        let Some(check_out) = document
            .get("check_out")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            return Ok(vec!["Reservation check-out date is invalid".into()]);
        };
        if check_out <= check_in {
            return Ok(vec![
                "Check-out date must be later than check-in date".into(),
            ]);
        }
        let reservation_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        let assigned_room = document
            .get("room")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let room_type = if let Some(room_id) = assigned_room {
            let Some(row) = tx
                .query_opt(
                    "SELECT room_type, status FROM hotel__room WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &room_id],
                )
                .await?
            else {
                return Ok(vec!["Assigned room was not found in this tenant".into()]);
            };
            let actual_type: Uuid = row.get(0);
            let room_status: String = row.get(1);
            if room_status == "maintenance" {
                return Ok(vec![
                    "A room under maintenance cannot be assigned to a reservation".into(),
                ]);
            }
            if document
                .get("room_type")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .is_some_and(|requested_type| requested_type != actual_type)
            {
                return Ok(vec![
                    "Assigned room does not match the reservation room type".into(),
                ]);
            }
            actual_type
        } else if let Some(room_type) = document
            .get("room_type")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            room_type
        } else {
            return Ok(vec!["Select a room type or assign a room".into()]);
        };
        let Some(type_row) = tx
            .query_opt(
                "SELECT capacity::text FROM hotel__room_type WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &room_type],
            )
            .await?
        else {
            return Ok(vec!["Room type was not found in this tenant".into()]);
        };
        let guest_count = document
            .get("guest_count")
            .and_then(Value::as_i64)
            .unwrap_or(1);
        if let Some(capacity_text) = type_row.get::<_, Option<String>>(0) {
            let Some(capacity) = crate::money::decimal_str(&capacity_text) else {
                return Err(crate::error::ApiError::validation(
                    "hotel.room_type.capacity",
                    vec!["Sức chứa lưu trong loại phòng không phải số nguyên hợp lệ".into()],
                ));
            };
            if Decimal::from(guest_count) > capacity {
                return Ok(vec![format!(
                    "Loại phòng này chỉ tiếp nhận tối đa {capacity} khách"
                )]);
            }
        }
        let room_count: i64 = tx
            .query_one_row(
                "SELECT COUNT(*)::bigint FROM hotel__room WHERE tenant_id = $1 AND room_type = $2 AND status <> 'maintenance'",
                &[&tenant.id, &room_type],
            )
            .await?
            .get(0);
        if room_count == 0 {
            return Ok(vec![
                "Room type has no rooms available for reservation".into(),
            ]);
        }
        let occupied: i64 = tx
            .query_one_row(
                "SELECT COUNT(*)::bigint FROM hotel__reservation r LEFT JOIN hotel__room assigned ON assigned.tenant_id = r.tenant_id AND assigned.id = r.room WHERE r.tenant_id = $1 AND COALESCE(assigned.room_type, r.room_type) = $2 AND r.id <> $3 AND r.status IN ('booked', 'checked_in') AND r.check_in < $5 AND r.check_out > $4",
                &[&tenant.id, &room_type, &reservation_id, &check_in, &check_out],
            )
            .await?
            .get(0);
        if occupied >= room_count {
            return Ok(vec![
                "No room of this type is available for the requested dates".into(),
            ]);
        }
        if let Some(room_id) = assigned_room {
            let locked_room = tx.query_opt(
                "SELECT status FROM hotel__room WHERE tenant_id = $1 AND id = $2 AND room_type = $3 FOR UPDATE",
                &[&tenant.id, &room_id, &room_type],
            )
            .await?;
            let Some(locked_room) = locked_room else {
                return Ok(vec![
                    "Assigned room no longer matches the selected room type".into(),
                ]);
            };
            if locked_room.get::<_, String>(0) == "maintenance" {
                return Ok(vec![
                    "A room under maintenance cannot be assigned to a reservation".into(),
                ]);
            }
            if tx
                .query_opt(
                    "SELECT id FROM hotel__reservation WHERE tenant_id = $1 AND id <> $2 AND room = $3 AND status IN ('booked', 'checked_in') AND check_in < $5 AND check_out > $4 LIMIT 1",
                    &[&tenant.id, &reservation_id, &room_id, &check_in, &check_out],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Room already has an overlapping active reservation".into()]);
            }
        }
        return Ok(Vec::new());
    }
    if entity == "reservation" && action == "checked_in" {
        let Some(room_id) = document
            .get("room")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Assign a room before checking in".into()]);
        };
        let business_today = tenant.business_today();
        let row = tx
            .query_opt(
                "SELECT room.status, reservation.check_in <= $4 AND reservation.check_out > $4 FROM hotel__room room CROSS JOIN hotel__reservation reservation WHERE room.tenant_id = $1 AND room.id = $2 AND reservation.tenant_id = $1 AND reservation.id = $3 FOR UPDATE OF room",
                &[&tenant.id, &room_id, &document.get("id").and_then(Value::as_str).and_then(|id| Uuid::parse_str(id).ok()).unwrap_or(Uuid::nil()), &business_today],
            )
            .await?;
        let Some(row) = row else {
            return Ok(vec!["Reservation room was not found in this tenant".into()]);
        };
        let status: String = row.get(0);
        let within_stay: bool = row.get(1);
        if status != "vacant" {
            return Ok(vec!["Room must be vacant before guest check-in".into()]);
        }
        if !within_stay {
            return Ok(vec![
                "Guest can only check in on or after the reservation date and before its checkout date".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "reservation" && action == "cancelled" {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__folio_charge WHERE tenant_id = $1 AND reservation = $2 LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Reservation with folio charges cannot be cancelled".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "reservation" && action == "no_show" {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        let business_today = tenant.business_today();
        let Some(row) = tx
            .query_opt(
                "SELECT check_in < $3 FROM hotel__reservation WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id, &business_today],
            )
            .await?
        else {
            return Ok(vec!["Không tìm thấy đặt phòng trong doanh nghiệp".into()]);
        };
        if !row.get::<_, bool>(0) {
            return Ok(vec![
                "Chỉ xác nhận khách vắng mặt sau khi ngày nhận phòng đã kết thúc".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__folio_charge WHERE tenant_id = $1 AND reservation = $2 LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "Đặt phòng có phí folio cần được xử lý trước khi ghi nhận khách vắng mặt".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "reservation" && action == "removed" {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        if tx
            .query_opt(
                "SELECT 1 FROM hotel__folio_charge WHERE tenant_id = $1 AND reservation = $2 LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Reservation with folio charges must be retained as financial history".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "folio_charge" && action == "created" {
        let Some(reservation_id) = document
            .get("reservation")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Folio charge requires a valid reservation".into()]);
        };
        let row = tx
            .query_opt(
                "SELECT status FROM hotel__reservation WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &reservation_id],
            )
            .await?;
        let Some(row) = row else {
            return Ok(vec![
                "Folio reservation was not found in this tenant".into(),
            ]);
        };
        let status: String = row.get(0);
        if !matches!(status.as_str(), "booked" | "checked_in") {
            return Ok(vec![
                "Folio charges can only be added before checkout".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    Ok(Vec::new())
}
