//! Operational read models for hotel reception and housekeeping.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Lists rooms awaiting housekeeping, prioritizing rooms with today's next arrival.
    pub async fn hotel_housekeeping_board(&self, actor: &Actor, tenant: &Tenant) -> R<Value> {
        if !tenant.has_module("hotel") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module hotel is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "hotel.room.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let items = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', room.id, 'number', room.number, 'floor', room.floor, \
                   'roomTypeId', room_type.id, 'roomType', room_type.name, \
                   'dirtySince', room.updated_at, 'lastCheckout', previous.check_out, \
                   'nextArrival', next.check_in, \
                   'priority', CASE WHEN next.check_in = CURRENT_DATE THEN 'today' ELSE 'normal' END \
                 ) FROM hotel__room room \
                 JOIN hotel__room_type room_type ON room_type.tenant_id = room.tenant_id AND room_type.id = room.room_type \
                 LEFT JOIN LATERAL (SELECT reservation.check_out FROM hotel__reservation reservation \
                   WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id AND reservation.status = 'checked_out' \
                   ORDER BY reservation.updated_at DESC, reservation.id DESC LIMIT 1) previous ON true \
                 LEFT JOIN LATERAL (SELECT reservation.check_in FROM hotel__reservation reservation \
                   WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id AND reservation.status = 'booked' AND reservation.check_in >= CURRENT_DATE \
                   ORDER BY reservation.check_in, reservation.created_at, reservation.id LIMIT 1) next ON true \
                 WHERE room.tenant_id = $1 AND room.status = 'cleaning' \
                 ORDER BY (next.check_in = CURRENT_DATE) DESC NULLS LAST, next.check_in NULLS LAST, room.floor, room.number, room.id \
                 LIMIT 500",
                &[&tenant.id],
            )
            .await?;
        let counts = tx
            .query_one_row(
                "SELECT \
                   COUNT(*) FILTER (WHERE room.status = 'cleaning'), \
                   COUNT(*) FILTER (WHERE room.status = 'cleaning' AND EXISTS ( \
                     SELECT 1 FROM hotel__reservation reservation \
                     WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id \
                       AND reservation.status = 'booked' AND reservation.check_in = CURRENT_DATE \
                   )), \
                   COUNT(*) FILTER (WHERE room.status = 'vacant'), \
                   COUNT(*) FILTER (WHERE room.status = 'occupied') \
                 FROM hotel__room room WHERE room.tenant_id = $1",
                &[&tenant.id],
            )
            .await?;
        let cleaning_count: i64 = counts.get(0);
        let due_today: i64 = counts.get(1);
        let ready_count: i64 = counts.get(2);
        let occupied_count: i64 = counts.get(3);
        let truncated = items.len() == 500;
        Ok(json!({
            "items": items,
            "cleaningCount": cleaning_count,
            "dueToday": due_today,
            "readyCount": ready_count,
            "occupiedCount": occupied_count,
            "truncated": truncated
        }))
    }
}
