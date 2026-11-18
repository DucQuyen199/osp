use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "recruitment.application.hired" {
        return Ok(false);
    }
    let application_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Hired application requires a valid id".into()],
            )
        })?;
    let employee_data = tx
        .query_opt(
            "SELECT c.email, c.phone, j.department::text, j.position::text, a.candidate::text FROM recruitment__application a JOIN recruitment__candidate c ON c.tenant_id = a.tenant_id AND c.id = a.candidate JOIN recruitment__job_opening j ON j.tenant_id = a.tenant_id AND j.id = a.job WHERE a.tenant_id = $1 AND a.id = $2 AND a.status = 'hired' FOR SHARE OF c, j",
            &[&tenant.id, &application_id],
        )
        .await?;
    let Some(employee_data) = employee_data else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Hired application, candidate, or job was not found for this tenant".into()],
        ));
    };
    let mut data = Map::new();
    if let Some(name) = document.get("candidate_name") {
        data.insert("name".into(), name.clone());
    }
    for (field, column) in [
        ("email", 0usize),
        ("phone", 1),
        ("department", 2),
        ("position", 3),
        ("source_id", 4),
    ] {
        let value: Option<String> = employee_data.get(column);
        if let Some(value) = value {
            let value = if field == "email" {
                value.trim().to_owned()
            } else {
                value
            };
            data.insert(field.into(), Value::String(value));
        }
    }
    data.insert("source".into(), Value::String("recruitment".into()));
    let entity = kernel.ent(tenant, "hrm.employee")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    kernel
        .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
        .await?;
    Ok(true)
}
