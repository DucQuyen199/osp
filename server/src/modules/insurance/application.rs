//! Normalize policy and claim commands before domain and persistence checks.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

impl Kernel {
    pub async fn insurance_cancel_policy(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        policy_id: &str,
        reason: &str,
    ) -> R<Value> {
        if !tenant.has_module("insurance") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module insurance is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "insurance.policy.update")?;
        self.authorize(tenant, actor, "insurance.policy.cancelled")?;
        let reason = reason.trim();
        if !(5..=500).contains(&reason.chars().count()) {
            return Err(ApiError::validation(
                "insurance.policy.cancelled",
                vec!["Cần ghi lý do hủy hợp đồng từ 5 đến 500 ký tự".into()],
            ));
        }
        let policy_id = Uuid::parse_str(policy_id)
            .map_err(|_| ApiError::not_found("Insurance policy was not found"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let entity = self.ent(tenant, "insurance.policy")?;
        self.update_in(
            &tx,
            &Actor::System,
            tenant,
            &entity,
            &policy_id.to_string(),
            Map::from_iter([("cancellation_reason".into(), serde_json::json!(reason))]),
            &Opts::top(),
        )
        .await?;
        let cancelled = self
            .act_in(
                &tx,
                actor,
                tenant,
                &entity,
                &policy_id.to_string(),
                "cancelled",
                &Opts::top(),
            )
            .await?;
        tx.commit().await?;
        Ok(cancelled)
    }
}

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let mut errors = Vec::new();
    for field in match entity {
        "policy" => &["number", "product"][..],
        "claim" => &["number"][..],
        _ => &[][..],
    } {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() {
                errors.push(format!("Trường {field} không được để trống"));
            }
        }
    }
    if entity == "claim" {
        if let Some(value) = document
            .get("description")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert("description".into(), Value::String(value));
        }
    }
    errors
}
