use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Value, json};
use uuid::Uuid;

const INVITE_LIFETIME_HOURS: i64 = 48;

fn target(member: Uuid) -> String {
    format!("consolidation.member#{member}")
}

impl Kernel {
    pub async fn invite_company_group_member(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
        member_tenant_id: &str,
    ) -> R<Value> {
        self.authorize(owner, actor, "tenant.admin")?;
        let group_uuid = super::domain::parse_id(group_id, "Company group")?;
        if member_tenant_id == owner.id {
            return Err(ApiError::validation(
                "consolidation.member",
                vec!["A tenant cannot join its own company group".into()],
            ));
        }
        let member_tenant = self.tenant(member_tenant_id).await?;
        if member_tenant.suspended || !member_tenant.has_module("consolidation") {
            return Err(ApiError::new(
                409,
                "MEMBER_TENANT_UNAVAILABLE",
                "The invited tenant must be active and enable consolidation",
            ));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, true).await?;
        if !super::persistence::lock_group(&tx, &owner.id, group_uuid).await? {
            return Err(ApiError::not_found("Company group"));
        }
        if super::persistence::has_open_membership(&tx, &owner.id, group_uuid, &member_tenant.id)
            .await?
        {
            return Err(ApiError::new(
                409,
                "MEMBER_ALREADY_EXISTS",
                "This tenant already has an open membership",
            ));
        }
        let entity = self.ent(owner, "consolidation.member")?;
        let record = self
            .create_in(
                &tx,
                &Actor::System,
                owner,
                &entity,
                json!({
                    "group": group_id,
                    "member_tenant_id": member_tenant.id,
                    "member_name": member_tenant.name,
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
                &Opts::top(),
            )
            .await?;
        let id = super::domain::parse_id(
            record.get("id").and_then(Value::as_str).unwrap_or_default(),
            "Company group member",
        )?;
        let token = crate::kernel::auth::new_token();
        tx.execute(
            "INSERT INTO consolidation_invite_tokens (tenant_id, member_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval '48 hours')",
            &[&owner.id, &id, &crate::kernel::auth::hash_token(&token)],
        ).await?;
        self.audit(
            &tx,
            owner,
            actor,
            "company_group.invite_created",
            &target(id),
            Some(member_tenant.id.clone()),
        )
        .await?;
        tx.commit().await?;
        Ok(
            json!({ "memberId": id, "memberTenantId": member_tenant.id, "expiresInHours": INVITE_LIFETIME_HOURS, "inviteToken": token }),
        )
    }

    pub async fn accept_company_group_invite(
        &self,
        actor: &Actor,
        member_tenant: &Tenant,
        owner_tenant_id: &str,
        member_id: &str,
        invite_token: &str,
    ) -> R<Value> {
        self.authorize(member_tenant, actor, "tenant.admin")?;
        let owner = self.tenant(owner_tenant_id).await?;
        let id = super::domain::parse_id(member_id, "Company group member")?;
        let mut owner_conn = self.pool.get().await?;
        let owner_tx = Tx::begin(&mut owner_conn, &owner.id, true).await?;
        let row = owner_tx.query_opt(
            "SELECT member_tenant_id, status FROM consolidation__member WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            &[&owner.id, &id],
        ).await?.ok_or_else(|| ApiError::not_found("Company group member"))?;
        if row.get::<_, String>(0) != member_tenant.id {
            return Err(ApiError::not_found("Company group member"));
        }
        if row.get::<_, String>(1) == "revoked" {
            return Err(ApiError::new(
                409,
                "INVITE_REVOKED",
                "This invitation has been revoked",
            ));
        }
        if row.get::<_, String>(1) == "invited" {
            let token_hash = crate::kernel::auth::hash_token(invite_token);
            let valid = owner_tx.query_opt(
                "SELECT member_id FROM consolidation_invite_tokens WHERE tenant_id=$1 AND member_id=$2 AND token_hash=$3 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
                &[&owner.id, &id, &token_hash],
            ).await?.is_some();
            if !valid {
                return Err(ApiError::new(
                    403,
                    "INVITE_INVALID",
                    "Invitation token is invalid, expired, or already used",
                ));
            }
        }

        let mut child_conn = self.pool.get().await?;
        let child_tx = Tx::begin(&mut child_conn, &member_tenant.id, true).await?;
        let shared_entity = self.ent(member_tenant, "consolidation.shared_company")?;
        let child_row = child_tx.query_opt(
            "SELECT id, status FROM consolidation__shared_company WHERE tenant_id=$1 AND owner_tenant_id=$2 AND owner_member_id=$3 LIMIT 1 FOR UPDATE",
            &[&member_tenant.id, &owner.id, &id.to_string()],
        ).await?;
        let shared_id = if let Some(existing) = child_row {
            let shared_id: Uuid = existing.get(0);
            if existing.get::<_, String>(1) == "revoked" {
                return Err(ApiError::new(
                    409,
                    "SHARE_REVOKED",
                    "This company share was previously revoked",
                ));
            }
            shared_id
        } else {
            let saved = self
                .create_in(
                    &child_tx,
                    &Actor::System,
                    member_tenant,
                    &shared_entity,
                    json!({
                        "owner_tenant_id": owner.id,
                        "owner_member_id": id.to_string(),
                        "owner_name": owner.name,
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
                    &Opts::top(),
                )
                .await?;
            super::domain::parse_id(
                saved.get("id").and_then(Value::as_str).unwrap_or_default(),
                "Shared company",
            )?
        };
        self.audit(
            &child_tx,
            member_tenant,
            actor,
            "company_group.consent_granted",
            &format!("consolidation.shared_company#{shared_id}"),
            Some(owner.id.clone()),
        )
        .await?;
        child_tx.commit().await?;

        if row.get::<_, String>(1) == "invited" {
            let entity = self.ent(&owner, "consolidation.member")?;
            self.act_in(
                &owner_tx,
                &Actor::System,
                &owner,
                &entity,
                member_id,
                "accepted",
                &Opts::top(),
            )
            .await?;
            owner_tx.execute("UPDATE consolidation__member SET consented_by=$3, consented_at=now() WHERE tenant_id=$1 AND id=$2", &[&owner.id, &id, &actor.user_id()]).await?;
            owner_tx.execute("UPDATE consolidation_invite_tokens SET used_at=now() WHERE tenant_id=$1 AND member_id=$2 AND used_at IS NULL", &[&owner.id, &id]).await?;
            let actor_ref = format!("{}:{}", member_tenant.id, actor.user_id());
            self.audit_raw(
                &owner_tx,
                &owner.id,
                &actor_ref,
                "company_group.consent_granted",
                Some(&target(id)),
                Some(member_tenant.id.clone()),
            )
            .await?;
        }
        owner_tx.commit().await?;
        Ok(json!({ "memberId": id, "status": "active" }))
    }

    pub async fn revoke_company_group_member(
        &self,
        actor: &Actor,
        owner: &Tenant,
        member_id: &str,
    ) -> R<Value> {
        self.authorize(owner, actor, "tenant.admin")?;
        let id = super::domain::parse_id(member_id, "Company group member")?;
        let entity = self.ent(owner, "consolidation.member")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, true).await?;
        let record = tx.query_opt("SELECT member_tenant_id, status FROM consolidation__member WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&owner.id, &id]).await?.ok_or_else(|| ApiError::not_found("Company group member"))?;
        let member_tenant_id: String = record.get(0);
        if record.get::<_, String>(1) != "revoked" {
            self.act_in(
                &tx,
                &Actor::System,
                owner,
                &entity,
                member_id,
                "revoked",
                &Opts::top(),
            )
            .await?;
            tx.execute("UPDATE consolidation_invite_tokens SET used_at=COALESCE(used_at,now()) WHERE tenant_id=$1 AND member_id=$2", &[&owner.id, &id]).await?;
            self.audit(
                &tx,
                owner,
                actor,
                "company_group.share_revoked",
                &target(id),
                Some(member_tenant_id.clone()),
            )
            .await?;
        }
        tx.commit().await?;
        let member_tenant = self.tenant(&member_tenant_id).await?;
        let mut member_conn = self.pool.get().await?;
        let member_tx = Tx::begin(&mut member_conn, &member_tenant.id, true).await?;
        if let Some(shared) = member_tx.query_opt(
            "SELECT id FROM consolidation__shared_company WHERE tenant_id=$1 AND owner_tenant_id=$2 AND owner_member_id=$3 AND status='active' FOR UPDATE",
            &[&member_tenant.id, &owner.id, &id.to_string()],
        ).await? {
            let shared_id: Uuid = shared.get(0);
            let shared_entity = self.ent(&member_tenant, "consolidation.shared_company")?;
            self.act_in(&member_tx, &Actor::System, &member_tenant, &shared_entity, &shared_id.to_string(), "revoked", &Opts::top()).await?;
            let actor_ref = format!("{}:{}", owner.id, actor.user_id());
            self.audit_raw(&member_tx, &member_tenant.id, &actor_ref, "company_group.share_revoked", Some(&format!("consolidation.shared_company#{shared_id}")), Some("group owner revoked membership".into())).await?;
        }
        member_tx.commit().await?;
        Ok(json!({ "memberId": id, "status": "revoked" }))
    }

    pub async fn revoke_shared_company(
        &self,
        actor: &Actor,
        member_tenant: &Tenant,
        owner_tenant_id: &str,
        owner_member_id: &str,
    ) -> R<Value> {
        self.authorize(member_tenant, actor, "tenant.admin")?;
        let owner = self.tenant(owner_tenant_id).await?;
        let id = super::domain::parse_id(owner_member_id, "Company group member")?;
        let mut owner_conn = self.pool.get().await?;
        let owner_tx = Tx::begin(&mut owner_conn, &owner.id, true).await?;
        let row = owner_tx.query_opt("SELECT member_tenant_id,status FROM consolidation__member WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&owner.id,&id]).await?.ok_or_else(|| ApiError::not_found("Company group member"))?;
        if row.get::<_, String>(0) != member_tenant.id {
            return Err(ApiError::not_found("Company group member"));
        }
        if row.get::<_, String>(1) != "revoked" {
            let entity = self.ent(&owner, "consolidation.member")?;
            self.act_in(
                &owner_tx,
                &Actor::System,
                &owner,
                &entity,
                owner_member_id,
                "revoked",
                &Opts::top(),
            )
            .await?;
            owner_tx.execute("UPDATE consolidation_invite_tokens SET used_at=COALESCE(used_at,now()) WHERE tenant_id=$1 AND member_id=$2", &[&owner.id,&id]).await?;
            let actor_ref = format!("{}:{}", member_tenant.id, actor.user_id());
            self.audit_raw(
                &owner_tx,
                &owner.id,
                &actor_ref,
                "company_group.share_revoked",
                Some(&target(id)),
                Some("member tenant revoked consent".into()),
            )
            .await?;
        }
        owner_tx.commit().await?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &member_tenant.id, true).await?;
        if let Some(row) = tx.query_opt("SELECT id FROM consolidation__shared_company WHERE tenant_id=$1 AND owner_tenant_id=$2 AND owner_member_id=$3 AND status='active' FOR UPDATE", &[&member_tenant.id,&owner.id,&id.to_string()]).await? {
            let shared_id: Uuid = row.get(0);
            let entity = self.ent(member_tenant,"consolidation.shared_company")?;
            self.act_in(&tx,&Actor::System,member_tenant,&entity,&shared_id.to_string(),"revoked",&Opts::top()).await?;
            self.audit(&tx,member_tenant,actor,"company_group.share_revoked",&format!("consolidation.shared_company#{shared_id}"),Some(owner.id.clone())).await?;
        }
        tx.commit().await?;
        Ok(json!({ "memberId":id,"ownerTenantId":owner.id,"status":"revoked" }))
    }
}
