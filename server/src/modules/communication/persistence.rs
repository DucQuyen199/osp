//! Persist queued communication records through the shared tenant transaction.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::Map;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &serde_json::Value,
) -> R<Vec<String>> {
    if entity != "reminder" || action != "queued" {
        return Ok(Vec::new());
    }
    let Some(id) = document
        .get("id")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Reminder requires a valid id".into()]);
    };
    let row = tx
        .query_opt(
            "SELECT status, send_at <= now() FROM communication__reminder WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?;
    match row {
        Some(row) if row.get::<_, String>(0) == "pending" && row.get::<_, bool>(1) => {
            Ok(Vec::new())
        }
        Some(_) => Ok(vec![
            "Only a pending reminder whose scheduled time has arrived can be queued".into(),
        ]),
        None => Ok(vec!["Reminder was not found for this tenant".into()]),
    }
}

pub async fn enqueue_message(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    message: Map<String, serde_json::Value>,
    event_id: Uuid,
    depth: u32,
) -> R<()> {
    enqueue_message_with_key(
        kernel,
        tx,
        tenant,
        message,
        &event_id.to_string(),
        event_id,
        depth,
    )
    .await
}

pub async fn enqueue_message_with_key(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    mut message: Map<String, serde_json::Value>,
    idempotency_key: &str,
    event_id: Uuid,
    depth: u32,
) -> R<()> {
    let existing = tx
        .query_opt(
            "SELECT 1 FROM communication__message_log WHERE tenant_id = $1 AND source_event = $2 LIMIT 1",
            &[&tenant.id, &idempotency_key],
        )
        .await?
        .is_some();
    if existing {
        return Ok(());
    }
    message.insert("source_event".into(), serde_json::json!(idempotency_key));
    message.insert("status".into(), serde_json::json!("queued"));
    message.insert("attempts".into(), serde_json::json!(0));
    let entity = kernel.ent(tenant, "communication.message_log")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            message,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(())
}
