//! CRM application handlers for transactional cross-context workflows.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    lead: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "crm.lead.converted" {
        return Ok(false);
    }
    let lead_id = lead
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Lead conversion requires a valid lead id".into()],
            )
        })?;
    let name = lead
        .get("company")
        .and_then(Value::as_str)
        .filter(|company| !company.trim().is_empty())
        .or_else(|| lead.get("name").and_then(Value::as_str))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Lead conversion requires a customer name".into()],
            )
        })?;
    let mut customer = Map::new();
    customer.insert("name".into(), json!(name));
    customer.insert(
        "kind".into(),
        json!(if lead
            .get("company")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            "company"
        } else {
            "person"
        }),
    );
    for field in ["email", "phone"] {
        if let Some(value) = lead.get(field).filter(|value| !value.is_null()) {
            customer.insert(field.into(), value.clone());
        }
    }
    customer.insert("is_customer".into(), json!(true));
    customer.insert("source".into(), json!("crm_lead"));
    customer.insert("source_id".into(), json!(lead_id));
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let party_entity = kernel.ent(tenant, "master-data.party")?;
    let existing_customer = if let Some(email) = lead
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
    {
        let normalized_email = email.to_ascii_lowercase();
        let lock_key = format!("crm.lead-email:{}:{normalized_email}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        tx.query_opt(
            "SELECT id, COALESCE(is_customer, false) FROM master_data__party WHERE tenant_id = $1 AND lower(btrim(email)) = $2 ORDER BY created_at, id LIMIT 1 FOR UPDATE",
            &[&tenant.id, &normalized_email],
        )
        .await?
    } else {
        None
    };
    let party_id = if let Some(existing) = existing_customer {
        let id: Uuid = existing.get(0);
        let is_customer: bool = existing.get(1);
        if !is_customer {
            kernel
                .update_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &party_entity,
                    &id.to_string(),
                    Map::from_iter([("is_customer".into(), json!(true))]),
                    &opts,
                )
                .await?;
        }
        json!(id)
    } else {
        let party = kernel
            .create_in(tx, &Actor::System, tenant, &party_entity, customer, &opts)
            .await?;
        party
            .get("id")
            .cloned()
            .ok_or_else(|| crate::error::ApiError::internal("Created CRM customer has no id"))?
    };
    let lead_entity = kernel.ent(tenant, "crm.lead")?;
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &lead_entity,
            &lead_id.to_string(),
            Map::from_iter([("party".into(), party_id)]),
            &opts,
        )
        .await?;
    Ok(true)
}
