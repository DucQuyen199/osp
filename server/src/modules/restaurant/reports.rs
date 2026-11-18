//! Operational read models for restaurant service.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Lists one page of tickets on the kitchen display and full lane counts.
    pub async fn restaurant_kitchen_board(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        station: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> R<Value> {
        if !tenant.has_module("restaurant") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module restaurant is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "restaurant.kitchen_ticket.read")?;
        let station = station.filter(|value| !value.is_empty() && *value != "all");
        if station.is_some_and(|value| !matches!(value, "kitchen" | "bar")) {
            return Err(ApiError::new(
                422,
                "INVALID_STATION",
                "station must be kitchen, bar, or all",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin_snapshot(&mut conn, &tenant.id).await?;
        let items = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', ticket.id, 'orderId', order_record.id, \
                   'tableId', dining_table.id, 'table', dining_table.name, \
                   'station', ticket.station, 'status', ticket.status, 'lines', ticket.lines, \
                   'createdAt', ticket.created_at \
                 ) FROM restaurant__kitchen_ticket ticket \
                 JOIN restaurant__table_order order_record ON order_record.tenant_id = ticket.tenant_id AND order_record.id = ticket.\"order\" \
                 LEFT JOIN restaurant__table dining_table ON dining_table.tenant_id = order_record.tenant_id AND dining_table.id = order_record.\"table\" \
                 WHERE ticket.tenant_id = $1 AND order_record.status IN ('sent', 'served') \
                   AND ($2::text IS NULL OR ticket.station = $2) \
                 ORDER BY ticket.created_at, ticket.id LIMIT $3 OFFSET $4",
                &[&tenant.id, &station, &limit, &offset],
            )
            .await?;
        let counts = tx
            .query_one_row(
                "SELECT count(*)::bigint, \
                   count(*) FILTER (WHERE ticket.status = 'queued')::bigint, \
                   count(*) FILTER (WHERE ticket.status = 'preparing')::bigint, \
                   count(*) FILTER (WHERE ticket.status = 'ready')::bigint \
                 FROM restaurant__kitchen_ticket ticket \
                 JOIN restaurant__table_order order_record ON order_record.tenant_id = ticket.tenant_id AND order_record.id = ticket.\"order\" \
                 WHERE ticket.tenant_id = $1 AND order_record.status IN ('sent', 'served') AND ($2::text IS NULL OR ticket.station = $2)",
                &[&tenant.id, &station],
            )
            .await?;
        let total: i64 = counts.get(0);
        let queued: i64 = counts.get(1);
        let preparing: i64 = counts.get(2);
        let ready: i64 = counts.get(3);
        Ok(json!({
            "station": station,
            "items": items,
            "itemCount": total,
            "counts": { "queued": queued, "preparing": preparing, "ready": ready },
            "pageSize": limit,
            "offset": offset,
            "hasMore": total > offset + limit
        }))
    }
}
