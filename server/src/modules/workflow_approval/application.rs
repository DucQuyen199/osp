use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::Value;
use uuid::Uuid;

use super::{domain, persistence};

pub async fn authorize_decision(
    tx: &Tx<'_>,
    tenant: &Tenant,
    actor: &Actor,
    action: &str,
    request: &Value,
) -> R<()> {
    persistence::authorize_decision(tx, tenant, actor, action, request).await
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("workflow-approval") {
        return Ok(false);
    }
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    if event_type == "contract.amendment.cancelled" {
        let record_id = document.get("id").and_then(Value::as_str).ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Cancelled amendment event requires a source id".into()],
            )
        })?;
        let request = tx
            .query_opt(
                "SELECT id FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'contract.amendment' AND record_id = $2 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
                &[&tenant.id, &record_id],
            )
            .await?;
        if let Some(request) = request {
            let request_id: Uuid = request.get(0);
            let entity = kernel.ent(tenant, "workflow-approval.approval_request")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &request_id.to_string(),
                    "cancelled",
                    &opts,
                )
                .await?;
        }
        return Ok(true);
    }
    if let Some(request) = domain::request_for_event(event_type, document) {
        let entity = kernel.ent(tenant, "workflow-approval.approval_request")?;
        kernel
            .create_in(tx, &Actor::System, tenant, &entity, request, &opts)
            .await?;
        return Ok(true);
    }

    let Some((target, action)) = domain::decision_for_event(event_type, document) else {
        return Ok(false);
    };
    let record_id = document
        .get("record_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Approval decision requires a valid source record id".into()],
            )
        })?;
    let table = persistence::table_for(target).ok_or_else(|| {
        crate::error::ApiError::validation(
            event_type,
            vec!["Approval target is not supported".into()],
        )
    })?;
    if !persistence::lock_record(tx, tenant, table, record_id).await? {
        if domain::is_optional_target(target) {
            return Ok(true);
        }
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Approval target was not found for this tenant".into()],
        ));
    }
    let entity = kernel.ent(tenant, target)?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &record_id.to_string(),
            action,
            &opts,
        )
        .await?;
    Ok(true)
}
