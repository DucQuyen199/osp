use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Value, json};
use uuid::Uuid;

impl Kernel {
    pub async fn create_consolidated_trial_balance_snapshot(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        let report = self
            .consolidated_trial_balance(actor, owner, group_id, from, to)
            .await?;
        let entity = self.ent(owner, "consolidation.report_snapshot")?;
        let group_id = super::domain::parse_id(group_id, "Company group")?;
        let reporting_currency = report
            .get("reportingCurrency")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::internal("Consolidated report is missing its reporting currency")
            })?;
        let snapshot_at = chrono::Utc::now().to_rfc3339();

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, true).await?;
        if tx
            .query_opt(
                "SELECT id FROM consolidation__company_group WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                &[&owner.id, &group_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Company group"));
        }
        let grant_exists = tx
            .query_opt(
                "SELECT id FROM consolidation__report_grant WHERE tenant_id=$1 AND \"group\"=$2 AND user_id=$3 AND report_type='trial_balance' AND status='active' LIMIT 1",
                &[&owner.id, &group_id, &actor.user_id()],
            )
            .await?
            .is_some();
        if !grant_exists {
            return Err(ApiError::forbidden(
                "consolidation.report_grant.trial_balance",
            ));
        }

        let row = self
            .create_in(
                &tx,
                &Actor::System,
                owner,
                &entity,
                json!({
                    "group": group_id.to_string(),
                    "report_type": "trial_balance",
                    "requested_by": actor.user_id(),
                    "from_date": report.get("from").cloned().unwrap_or(Value::Null),
                    "to_date": report.get("to").cloned().unwrap_or(Value::Null),
                    "reporting_currency": reporting_currency,
                    "snapshot_at": snapshot_at,
                    "payload": report,
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
                &Opts::top(),
            )
            .await?;
        let snapshot_id = parse_id(
            row.get("id").and_then(Value::as_str).unwrap_or_default(),
            "Report snapshot",
        )?;
        self.audit(
            &tx,
            owner,
            actor,
            "company_group.trial_balance.snapshotted",
            &format!("consolidation.report_snapshot#{snapshot_id}"),
            Some(format!("group={group_id}; report=trial_balance")),
        )
        .await?;
        tx.commit().await?;
        Ok(json!({
            "snapshotId": snapshot_id,
            "snapshotAt": snapshot_at,
            "report": report,
        }))
    }

    pub async fn list_consolidated_trial_balance_snapshots(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
    ) -> R<Value> {
        self.authorize_snapshot_report(actor, owner)?;
        let group_id = super::domain::parse_id(group_id, "Company group")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, false).await?;
        let group_exists = tx
            .query_opt(
                "SELECT id FROM consolidation__company_group WHERE tenant_id=$1 AND id=$2",
                &[&owner.id, &group_id],
            )
            .await?
            .is_some();
        if !group_exists {
            return Err(ApiError::not_found("Company group"));
        }
        self.require_snapshot_grant(&tx, actor, owner, &group_id)
            .await?;
        let rows = tx
            .query(
                "SELECT id, requested_by, from_date::text, to_date::text, reporting_currency, snapshot_at::text FROM consolidation__report_snapshot WHERE tenant_id=$1 AND \"group\"=$2 ORDER BY snapshot_at DESC, id DESC LIMIT 50",
                &[&owner.id, &group_id],
            )
            .await?;
        let items: Vec<Value> = rows
            .into_iter()
            .map(|row| {
                json!({
                    "id": row.get::<_, Uuid>(0),
                    "requestedBy": row.get::<_, String>(1),
                    "from": row.get::<_, Option<String>>(2),
                    "to": row.get::<_, String>(3),
                    "reportingCurrency": row.get::<_, String>(4),
                    "snapshotAt": row.get::<_, String>(5),
                })
            })
            .collect();
        tx.commit().await?;
        Ok(json!({ "items": items }))
    }

    pub async fn read_consolidated_trial_balance_snapshot(
        &self,
        actor: &Actor,
        owner: &Tenant,
        snapshot_id: &str,
    ) -> R<Value> {
        self.authorize_snapshot_report(actor, owner)?;
        let snapshot_id = parse_id(snapshot_id, "Report snapshot")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, false).await?;
        let row = tx
            .query_opt(
                "SELECT snapshot.\"group\", snapshot.requested_by, snapshot.from_date::text, snapshot.to_date::text, snapshot.reporting_currency, snapshot.snapshot_at::text, snapshot.payload FROM consolidation__report_snapshot snapshot WHERE snapshot.tenant_id=$1 AND snapshot.id=$2 AND EXISTS (SELECT 1 FROM consolidation__report_grant grant_row WHERE grant_row.tenant_id=snapshot.tenant_id AND grant_row.\"group\"=snapshot.\"group\" AND grant_row.user_id=$3 AND grant_row.report_type='trial_balance' AND grant_row.status='active')",
                &[&owner.id, &snapshot_id, &actor.user_id()],
            )
            .await?
            .ok_or_else(|| ApiError::not_found("Report snapshot"))?;
        let report: Value = row.get(6);
        let group_id: Uuid = row.get(0);
        let requested_by: String = row.get(1);
        let snapshot_at: String = row.get(5);
        self.audit_raw_ro(
            owner,
            actor,
            "company_group.trial_balance.snapshot_read",
            &format!("consolidation.report_snapshot#{snapshot_id}"),
        )
        .await?;
        tx.commit().await?;
        Ok(json!({
            "snapshotId": snapshot_id,
            "groupId": group_id,
            "requestedBy": requested_by,
            "from": row.get::<_, Option<String>>(2),
            "to": row.get::<_, String>(3),
            "reportingCurrency": row.get::<_, String>(4),
            "snapshotAt": snapshot_at,
            "report": report,
        }))
    }

    fn authorize_snapshot_report(&self, actor: &Actor, owner: &Tenant) -> R<()> {
        self.ent(owner, "consolidation.company_group")?;
        self.ent(owner, "consolidation.report_snapshot")?;
        self.authorize(owner, actor, "consolidation.company_group.read")?;
        self.authorize(owner, actor, "accounting.journal_entry.read")?;
        Ok(())
    }

    async fn require_snapshot_grant(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        owner: &Tenant,
        group_id: &Uuid,
    ) -> R<()> {
        let grant_exists = tx
            .query_opt(
                "SELECT id FROM consolidation__report_grant WHERE tenant_id=$1 AND \"group\"=$2 AND user_id=$3 AND report_type='trial_balance' AND status='active' LIMIT 1",
                &[&owner.id, group_id, &actor.user_id()],
            )
            .await?
            .is_some();
        if !grant_exists {
            return Err(ApiError::forbidden(
                "consolidation.report_grant.trial_balance",
            ));
        }
        Ok(())
    }
}

fn parse_id(value: &str, resource: &'static str) -> R<Uuid> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(resource))
}
