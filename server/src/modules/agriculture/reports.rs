//! Agriculture cost read models derived from valued inventory issues.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

impl Kernel {
    /// Returns the material cost of inventory issues recorded against one crop cycle.
    pub async fn agriculture_crop_cycle_input_costs(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        cycle_id: Uuid,
    ) -> R<Value> {
        if !tenant.has_module("agriculture") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module agriculture is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "agriculture.crop_cycle.read")?;
        self.authorize(tenant, actor, "agriculture.input_application.read")?;
        self.authorize(tenant, actor, "inventory.stock_move.read")?;

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let report = tx
            .query_opt(
                "SELECT jsonb_build_object( \
                   'cycleId', cc.id, \
                   'areaHectares', farm.area, \
                   'materialCost', costs.total, \
                   'costPerHectare', CASE WHEN farm.area > 0 THEN costs.total / farm.area ELSE NULL END, \
                   'byKind', jsonb_build_object( \
                     'fertilizer', costs.fertilizer, \
                     'pesticide', costs.pesticide, \
                     'seed', costs.seed, \
                     'water', costs.water \
                   ) \
                 ) \
                 FROM agriculture__crop_cycle cc \
                 JOIN agriculture__farm farm ON farm.tenant_id = cc.tenant_id AND farm.id = cc.farm \
                 CROSS JOIN LATERAL ( \
                   SELECT \
                     COALESCE(SUM(move.total_cost::numeric), 0) AS total, \
                     COALESCE(SUM(move.total_cost::numeric) FILTER (WHERE ia.kind = 'fertilizer'), 0) AS fertilizer, \
                     COALESCE(SUM(move.total_cost::numeric) FILTER (WHERE ia.kind = 'pesticide'), 0) AS pesticide, \
                     COALESCE(SUM(move.total_cost::numeric) FILTER (WHERE ia.kind = 'seed'), 0) AS seed, \
                     COALESCE(SUM(move.total_cost::numeric) FILTER (WHERE ia.kind = 'water'), 0) AS water \
                   FROM agriculture__input_application ia \
                   LEFT JOIN inventory__stock_move move ON move.tenant_id = ia.tenant_id \
                     AND move.source = 'input_application' AND move.source_id = ia.id::text AND move.direction = 'out' \
                   WHERE ia.tenant_id = cc.tenant_id AND ia.cycle = cc.id \
                 ) costs \
                 WHERE cc.tenant_id = $1 AND cc.id = $2",
                &[&tenant.id, &cycle_id],
            )
            .await?
            .map(|row| row.get::<_, Value>(0));
        let Some(report) = report else {
            return Err(ApiError::not_found(
                "Không tìm thấy vụ mùa trong doanh nghiệp",
            ));
        };
        tx.commit().await?;
        Ok(report)
    }
}
