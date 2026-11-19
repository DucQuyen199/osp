use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Value, json};
use uuid::Uuid;

const TRIAL_BALANCE: &str = "trial_balance";

impl Kernel {
    pub async fn grant_consolidated_report(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
        user_id: &str,
        report_type: &str,
    ) -> R<Value> {
        self.authorize(owner, actor, "tenant.admin")?;
        self.ent(owner, "consolidation.company_group")?;
        let grant_entity = self.ent(owner, "consolidation.report_grant")?;
        if !matches!(report_type, TRIAL_BALANCE | "intercompany_match_preview") {
            return Err(ApiError::validation(
                "consolidation.report_grant",
                vec!["The requested consolidated report type is not available for grants".into()],
            ));
        }
        let group_id = uuid(group_id, "Company group")?;
        if user_id.trim().is_empty() {
            return Err(ApiError::validation(
                "consolidation.report_grant",
                vec!["A user ID is required".into()],
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, true).await?;
        if tx
            .query_opt(
                "SELECT id FROM consolidation__company_group WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                &[&owner.id, &group_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Company group"));
        }
        if tx
            .query_opt(
                "SELECT id FROM osp_users WHERE tenant_id=$1 AND id=$2 AND disabled=false",
                &[&owner.id, &user_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Active user in this tenant"));
        }
        if tx
            .query_opt(
                "SELECT id FROM consolidation__report_grant WHERE tenant_id=$1 AND \"group\"=$2 AND user_id=$3 AND report_type=$4 AND status='active' LIMIT 1",
                &[&owner.id, &group_id, &user_id, &report_type],
            )
            .await?
            .is_some()
        {
            return Err(ApiError::new(
                409,
                "REPORT_GRANT_EXISTS",
                "This user already has an active grant for the report",
            ));
        }
        let record = self
            .create_in(
                &tx,
                &Actor::System,
                owner,
                &grant_entity,
                json!({
                    "group": group_id.to_string(),
                    "user_id": user_id,
                    "report_type": report_type,
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
                &Opts::top(),
            )
            .await?;
        let grant_id = uuid(
            record.get("id").and_then(Value::as_str).unwrap_or_default(),
            "Report grant",
        )?;
        self.audit(
            &tx,
            owner,
            actor,
            "company_group.report_granted",
            &format!("consolidation.report_grant#{grant_id}"),
            Some(format!("user={user_id}; report={report_type}")),
        )
        .await?;
        tx.commit().await?;
        Ok(
            json!({ "grantId": grant_id, "groupId": group_id, "userId": user_id, "reportType": report_type, "status": "active" }),
        )
    }

    pub async fn revoke_consolidated_report_grant(
        &self,
        actor: &Actor,
        owner: &Tenant,
        grant_id: &str,
    ) -> R<Value> {
        self.authorize(owner, actor, "tenant.admin")?;
        let id = uuid(grant_id, "Report grant")?;
        let entity = self.ent(owner, "consolidation.report_grant")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, true).await?;
        let row = tx
            .query_opt(
                "SELECT status, user_id, report_type FROM consolidation__report_grant WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                &[&owner.id, &id],
            )
            .await?
            .ok_or_else(|| ApiError::not_found("Report grant"))?;
        if row.get::<_, String>(0) == "active" {
            self.act_in(
                &tx,
                &Actor::System,
                owner,
                &entity,
                grant_id,
                "revoked",
                &Opts::top(),
            )
            .await?;
            self.audit(
                &tx,
                owner,
                actor,
                "company_group.report_grant_revoked",
                &format!("consolidation.report_grant#{id}"),
                Some(format!(
                    "user={}; report={}",
                    row.get::<_, String>(1),
                    row.get::<_, String>(2)
                )),
            )
            .await?;
        }
        tx.commit().await?;
        Ok(json!({ "grantId": id, "status": "revoked" }))
    }
}

fn uuid(value: &str, resource: &'static str) -> R<Uuid> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(resource))
}
