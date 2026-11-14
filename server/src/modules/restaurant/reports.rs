//! Operational read models for restaurant service.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Lists tickets that still belong on the kitchen display, oldest first.
    pub async fn restaurant_kitchen_board(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        station: Option<&str>,
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
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
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
                 ORDER BY ticket.created_at, ticket.id LIMIT 500",
                &[&tenant.id, &station],
            )
            .await?;
        Ok(
            json!({ "station": station, "items": items, "itemCount": items.len(), "truncated": items.len() == 500 }),
        )
    }
}
