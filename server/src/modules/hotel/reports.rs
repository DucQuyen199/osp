//! Operational read models for hotel reception and housekeeping.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Lists one prioritized housekeeping page and full room availability counts.
    pub async fn hotel_housekeeping_board(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        limit: i64,
        offset: i64,
    ) -> R<Value> {
        if !tenant.has_module("hotel") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module hotel is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "hotel.room.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin_snapshot(&mut conn, &tenant.id).await?;
        let items = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', room.id, 'number', room.number, 'floor', room.floor, \
                   'status', room.status, 'maintenanceReason', room.maintenance_reason, \
                   'roomTypeId', room_type.id, 'roomType', room_type.name, \
                   'dirtySince', room.updated_at, 'lastCheckout', previous.check_out, \
                   'nextArrival', next.check_in, \
                   'priority', CASE WHEN next.check_in = $2::date THEN 'today' ELSE 'normal' END \
                 ) FROM hotel__room room \
                 JOIN hotel__room_type room_type ON room_type.tenant_id = room.tenant_id AND room_type.id = room.room_type \
                 LEFT JOIN LATERAL (SELECT reservation.check_out FROM hotel__reservation reservation \
                   WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id AND reservation.status = 'checked_out' \
                   ORDER BY reservation.updated_at DESC, reservation.id DESC LIMIT 1) previous ON true \
                 LEFT JOIN LATERAL (SELECT reservation.check_in FROM hotel__reservation reservation \
                   WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id AND reservation.status = 'booked' AND reservation.check_in >= $2::date \
                   ORDER BY reservation.check_in, reservation.created_at, reservation.id LIMIT 1) next ON true \
                 WHERE room.tenant_id = $1 AND room.status IN ('cleaning', 'maintenance') \
                 ORDER BY (room.status = 'maintenance') DESC, (next.check_in = $2::date) DESC NULLS LAST, next.check_in NULLS LAST, room.floor, room.number, room.id \
                 LIMIT $3 OFFSET $4",
                &[&tenant.id, &tenant.business_today(), &limit, &offset],
            )
            .await?;
        let counts = tx
            .query_one_row(
                "SELECT \
                   COUNT(*) FILTER (WHERE room.status IN ('cleaning', 'maintenance')), \
                   COUNT(*) FILTER (WHERE room.status = 'cleaning'), \
                   COUNT(*) FILTER (WHERE room.status = 'cleaning' AND EXISTS ( \
                     SELECT 1 FROM hotel__reservation reservation \
                     WHERE reservation.tenant_id = room.tenant_id AND reservation.room = room.id \
                       AND reservation.status = 'booked' AND reservation.check_in = $2::date \
                   )), \
                   COUNT(*) FILTER (WHERE room.status = 'vacant'), \
                   COUNT(*) FILTER (WHERE room.status = 'occupied'), \
                   COUNT(*) FILTER (WHERE room.status = 'maintenance') \
                 FROM hotel__room room WHERE room.tenant_id = $1",
                &[&tenant.id, &tenant.business_today()],
            )
            .await?;
        let item_count: i64 = counts.get(0);
        let cleaning_count: i64 = counts.get(1);
        let due_today: i64 = counts.get(2);
        let ready_count: i64 = counts.get(3);
        let occupied_count: i64 = counts.get(4);
        let maintenance_count: i64 = counts.get(5);
        Ok(json!({
            "items": items,
            "itemCount": item_count,
            "cleaningCount": cleaning_count,
            "dueToday": due_today,
            "readyCount": ready_count,
            "occupiedCount": occupied_count,
            "maintenanceCount": maintenance_count,
            "pageSize": limit,
            "offset": offset,
            "hasMore": item_count > offset + limit
        }))
    }
}
