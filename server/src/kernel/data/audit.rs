use super::shared::*;

impl Kernel {
    pub(crate) async fn audit(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        actor: &Actor,
        action: &str,
        target: &str,
        detail: Option<String>,
    ) -> R<()> {
        if matches!(actor, Actor::System) {
            return Ok(());
        }
        self.audit_raw(tx, &t.id, actor.user_id(), action, Some(target), detail)
            .await
    }

    pub(crate) async fn audit_raw(
        &self,
        tx: &Tx<'_>,
        tenant: &str,
        user: &str,
        action: &str,
        target: Option<&str>,
        detail: Option<String>,
    ) -> R<()> {
        tx.execute(
            "INSERT INTO osp_audit (tenant_id, id, at, user_id, action, target, detail) VALUES ($1, $2, now(), $3, $4, $5, $6)",
            &[&tenant, &Uuid::new_v4(), &user, &action, &target, &detail],
        )
        .await?;
        Ok(())
    }
}
