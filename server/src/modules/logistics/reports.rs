//! Operational read models for dispatch and delivery work.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Lists open and failed shipments for the dispatch board, oldest first.
    pub async fn logistics_delivery_board(&self, actor: &Actor, tenant: &Tenant) -> R<Value> {
        if !tenant.has_module("logistics") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module logistics is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "logistics.shipment.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let items = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', shipment.id, 'status', shipment.status, 'source', shipment.source, \
                   'sourceId', shipment.source_id, 'partyId', shipment.party, \
                   'party', party.name, 'warehouseId', shipment.warehouse, \
                   'carrier', shipment.carrier, 'trackingNumber', shipment.tracking_number, \
                   'vehicleId', shipment.vehicle, 'vehicle', vehicle.plate, \
                   'driverId', shipment.driver, 'driver', driver.name, \
                   'weight', shipment.weight, 'failureReason', shipment.failure_reason, \
                   'origin', shipment.origin, 'destination', shipment.destination, \
                   'createdAt', shipment.created_at, 'updatedAt', shipment.updated_at, \
                   'lastTrackingEvent', latest.status, 'lastTrackingAt', latest.occurred_at, \
                   'lastTrackingLocation', latest.location, \
                   'ageMinutes', GREATEST(0, floor(extract(epoch FROM (now() - shipment.created_at)) / 60))::bigint \
                 ) FROM logistics__shipment shipment \
                 LEFT JOIN master_data__party party ON party.tenant_id = shipment.tenant_id AND party.id = shipment.party \
                 LEFT JOIN logistics__vehicle vehicle ON vehicle.tenant_id = shipment.tenant_id AND vehicle.id = shipment.vehicle \
                 LEFT JOIN logistics__driver driver ON driver.tenant_id = shipment.tenant_id AND driver.id = shipment.driver \
                 LEFT JOIN LATERAL (SELECT status, occurred_at, location FROM logistics__tracking_event event \
                   WHERE event.tenant_id = shipment.tenant_id AND event.shipment = shipment.id \
                   ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1) latest ON true \
                 WHERE shipment.tenant_id = $1 AND shipment.status IN ('created', 'dispatched', 'failed') \
                 ORDER BY CASE shipment.status WHEN 'failed' THEN 0 WHEN 'created' THEN 1 ELSE 2 END, shipment.created_at, shipment.id \
                 LIMIT 500",
                &[&tenant.id],
            )
            .await?;
        let created = items
            .iter()
            .filter(|item| item["status"] == "created")
            .count();
        let dispatched = items
            .iter()
            .filter(|item| item["status"] == "dispatched")
            .count();
        let failed = items
            .iter()
            .filter(|item| item["status"] == "failed")
            .count();
        let truncated = items.len() == 500;
        Ok(json!({
            "items": items,
            "itemCount": created + dispatched + failed,
            "counts": { "created": created, "dispatched": dispatched, "failed": failed },
            "truncated": truncated
        }))
    }

    /// Creates one new draft attempt from a failed shipment, retaining the
    /// original as immutable delivery history and leaving dispatch assignment
    /// to the normal shipment workflow.
    pub async fn create_logistics_redelivery(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        failed_shipment_id: &str,
    ) -> R<Value> {
        if !tenant.has_module("logistics") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module logistics is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "logistics.shipment.read")?;
        self.authorize(tenant, actor, "logistics.shipment.create")?;
        let failed_id = uuid::Uuid::parse_str(failed_shipment_id).map_err(|_| {
            ApiError::validation(
                "logistics.shipment",
                vec!["Failed shipment id is invalid".into()],
            )
        })?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        tx.query_one_row(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("logistics-redelivery:{}:{failed_id}", tenant.id)],
        )
        .await?;
        let failed = tx
            .query_opt(
                "SELECT source, source_id, party, warehouse, origin, destination, lines FROM logistics__shipment WHERE tenant_id = $1 AND id = $2 AND status = 'failed' FOR UPDATE",
                &[&tenant.id, &failed_id],
            )
            .await?
            .ok_or_else(|| ApiError::validation("logistics.shipment", vec!["Only a failed shipment can be retried".into()]))?;
        let source: Option<String> = failed.get(0);
        let source_id: Option<String> = failed.get(1);
        let party: Option<uuid::Uuid> = failed.get(2);
        let warehouse: Option<uuid::Uuid> = failed.get(3);
        let origin: Option<String> = failed.get(4);
        let destination: Option<String> = failed.get(5);
        let lines: Value = failed.get(6);
        if lines.as_array().is_none_or(Vec::is_empty) {
            return Err(ApiError::validation(
                "logistics.shipment",
                vec!["Failed shipment has no item lines to redeliver".into()],
            ));
        }
        if source.as_deref() == Some("sales_order") {
            if !tenant.has_module("sales") {
                return Err(ApiError::validation(
                    "logistics.shipment",
                    vec!["Sales module must be enabled to redeliver a sales order".into()],
                ));
            }
            let Some(order_id) = source_id
                .as_deref()
                .and_then(|value| uuid::Uuid::parse_str(value).ok())
            else {
                return Err(ApiError::validation(
                    "logistics.shipment",
                    vec!["Failed shipment references an invalid sales order".into()],
                ));
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM sales__sales_order WHERE tenant_id = $1 AND id = $2 AND status IN ('confirmed', 'partially_delivered') FOR SHARE",
                    &[&tenant.id, &order_id],
                )
                .await?
                .is_none()
            {
                return Err(ApiError::validation(
                    "logistics.shipment",
                    vec!["The sales order is no longer open for redelivery".into()],
                ));
            }
        }
        if let Some(existing) = tx
            .query_opt(
                "SELECT id FROM logistics__shipment WHERE tenant_id = $1 AND source IS NOT DISTINCT FROM $2 AND source_id IS NOT DISTINCT FROM $3 AND status = 'created' AND party IS NOT DISTINCT FROM $4 AND warehouse IS NOT DISTINCT FROM $5 AND origin IS NOT DISTINCT FROM $6 AND destination IS NOT DISTINCT FROM $7 AND lines = $8::jsonb ORDER BY created_at, id LIMIT 1 FOR UPDATE",
                &[
                    &tenant.id,
                    &source,
                    &source_id,
                    &party,
                    &warehouse,
                    &origin,
                    &destination,
                    &lines,
                ],
            )
            .await?
        {
            let id: uuid::Uuid = existing.get(0);
            tx.commit().await?;
            return Ok(json!({"id": id, "status": "created", "existing": true}));
        }
        let mut data = serde_json::Map::new();
        data.insert("source".into(), json!(source));
        data.insert("source_id".into(), json!(source_id));
        data.insert("party".into(), json!(party));
        data.insert("warehouse".into(), json!(warehouse));
        data.insert("origin".into(), json!(origin));
        data.insert("destination".into(), json!(destination));
        data.insert("lines".into(), lines);
        let entity = self.ent(tenant, "logistics.shipment")?;
        let created = self
            .create_in(&tx, actor, tenant, &entity, data, &Opts::top())
            .await?;
        let id = created
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::internal("Created redelivery shipment has no id"))?;
        tx.commit().await?;
        Ok(json!({"id": id, "status": "created", "existing": false}))
    }
}
