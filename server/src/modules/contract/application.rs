//! Contract event reactions and use-case coordination.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Value, json};
use uuid::Uuid;

const LEASE_SOURCE: &str = "real_estate_lease";

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    let lease_activated = event_type == "real-estate.lease.activated";
    let lease_terminated = event_type == "real-estate.lease.terminated";
    if !lease_activated && !lease_terminated {
        return Ok(false);
    }
    let Some(lease_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Lease event requires a valid source record".into()],
        ));
    };
    let source_id = lease_id.to_string();
    let lock_key = format!("contract.lease:{}:{source_id}", tenant.id);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let existing = tx
        .query_opt(
            "SELECT id, status FROM contract__contract WHERE tenant_id = $1 AND source = $2 AND source_id = $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &LEASE_SOURCE, &source_id],
        )
        .await?;
    let entity = kernel.ent(tenant, "contract.contract")?;

    if lease_activated {
        if existing.is_some() {
            return Ok(true);
        }
        let mut data = serde_json::Map::new();
        data.insert("title".into(), json!("Hợp đồng thuê bất động sản"));
        data.insert("source".into(), json!(LEASE_SOURCE));
        data.insert("source_id".into(), json!(source_id));
        for (target, source) in [
            ("party", "tenant"),
            ("start_date", "start_date"),
            ("end_date", "end_date"),
            ("value", "rent"),
        ] {
            if let Some(value) = document.get(source) {
                data.insert(target.into(), value.clone());
            }
        }
        kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                data,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        return Ok(true);
    }

    let Some(contract) = existing else {
        return Ok(true);
    };
    let contract_id: Uuid = contract.get(0);
    let status: String = contract.get(1);
    let action = match status.as_str() {
        "draft" => "cancelled",
        "active" => "terminated",
        _ => return Ok(true),
    };
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &contract_id.to_string(),
            action,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
