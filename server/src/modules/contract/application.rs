//! Contract event reactions and use-case coordination.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value, json};
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
    if !tenant.has_module("contract") {
        return Ok(false);
    }
    if event_type == "contract.amendment.approved" {
        let amendment_id = source_id(event_type, document)?;
        let Some(row) = tx
            .query_opt(
                "SELECT effective_date <= $3::date FROM contract__amendment WHERE tenant_id = $1 AND id = $2 AND status = 'approved' FOR UPDATE",
                &[&tenant.id, &amendment_id, &tenant.business_today()],
            )
            .await?
        else {
            return Ok(true);
        };
        let due: bool = row.get(0);
        if due {
            let entity = kernel.ent(tenant, "contract.amendment")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &amendment_id.to_string(),
                    "applied",
                    &Opts {
                        depth: Some(depth + 1),
                        causation: Some(event_id),
                        silent: false,
                    },
                )
                .await?;
        }
        return Ok(true);
    }
    if event_type == "contract.amendment.applied" {
        let amendment_id = source_id(event_type, document)?;
        let Some(row) = tx
            .query_opt(
                "SELECT contract FROM contract__amendment WHERE tenant_id = $1 AND id = $2 AND status = 'effective' FOR SHARE",
                &[&tenant.id, &amendment_id],
            )
            .await?
        else {
            return Ok(true);
        };
        let contract_id: Uuid = row.get(0);
        let contract = kernel.ent(tenant, "contract.contract")?;
        let patch = Map::from_iter([(
            "amendment_in_progress".into(),
            Value::String(amendment_id.to_string()),
        )]);
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &contract,
                &contract_id.to_string(),
                patch,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &contract,
                &contract_id.to_string(),
                "amended",
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        return Ok(true);
    }
    if matches!(
        event_type,
        "contract.contract.expired" | "contract.contract.terminated"
    ) {
        let Some(contract_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Sự kiện kết thúc hợp đồng cần mã UUID hợp lệ".into()],
            ));
        };
        cancel_open_amendments(kernel, tx, tenant, contract_id, event_id, depth).await?;
        return Ok(true);
    }

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
    cancel_open_amendments(kernel, tx, tenant, contract_id, event_id, depth).await?;
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

async fn cancel_open_amendments(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    contract_id: Uuid,
    event_id: Uuid,
    depth: u32,
) -> R<()> {
    let rows = tx
        .query(
            "SELECT id FROM contract__amendment WHERE tenant_id = $1 AND contract = $2 AND status IN ('draft', 'submitted', 'approved', 'rejected') ORDER BY created_at, id FOR UPDATE SKIP LOCKED",
            &[&tenant.id, &contract_id],
        )
        .await?;
    let entity = kernel.ent(tenant, "contract.amendment")?;
    for row in rows {
        let id: Uuid = row.get(0);
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id.to_string(),
                "cancelled",
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
    }
    Ok(())
}

fn source_id(event_type: &str, document: &Value) -> R<Uuid> {
    document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Sự kiện phụ lục hợp đồng cần mã UUID hợp lệ".into()],
            )
        })
}

/// Apply the approved amendment currently marked on the contract before the
/// kernel writes the `contract.amended` action event.
pub async fn prepare_amendment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(amendment_id) = document
        .get("amendment_in_progress")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec![
            "Không có phụ lục đang chờ áp dụng trên hợp đồng".into(),
        ]);
    };
    let Some(contract_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec![
            "Không xác định được hợp đồng cần áp dụng phụ lục".into(),
        ]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT contract, reference, effective_date::text, reason, changes FROM contract__amendment WHERE tenant_id = $1 AND id = $2 AND status = 'effective' FOR UPDATE",
            &[&tenant.id, &amendment_id],
        )
        .await?
    else {
        return Ok(vec!["Phụ lục chưa được phê duyệt hoặc chưa đến ngày hiệu lực".into()]);
    };
    let amendment_contract: Uuid = row.get(0);
    if amendment_contract != contract_id {
        return Ok(vec!["Phụ lục không thuộc hợp đồng đang cập nhật".into()]);
    }
    let reference: Option<String> = row.get(1);
    let effective_date: String = row.get(2);
    let reason: String = row.get(3);
    let changes: Value = row.get(4);
    let errors = super::domain::validate_amendment(
        &Value::Object(document.clone()),
        &json!({
            "effective_date": effective_date,
            "reason": reason,
            "changes": changes,
        }),
    );
    if !errors.is_empty() {
        return Ok(errors);
    }
    let Some(changes) = changes.as_object() else {
        return Ok(vec!["Nội dung phụ lục không hợp lệ".into()]);
    };
    for (field, value) in changes {
        document.insert(field.clone(), value.clone());
    }
    let history = document
        .entry("amendment_history")
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(history) = history.as_array_mut() else {
        return Ok(vec!["Lịch sử phụ lục hợp đồng hiện không hợp lệ".into()]);
    };
    history.push(json!({
        "amendment": amendment_id,
        "reference": reference,
        "effective_date": effective_date,
        "reason": reason,
        "changes": changes,
        "applied_at": chrono::Utc::now().to_rfc3339(),
    }));
    document.insert(
        "last_amendment".into(),
        Value::String(amendment_id.to_string()),
    );
    document.insert("amendment_in_progress".into(), Value::Null);
    Ok(Vec::new())
}
