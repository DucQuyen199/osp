//! Tenant-scoped employee and objective relationship checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "objective" => validate_objective(tx, tenant, action, document).await,
        "key_result" => validate_key_result(tx, tenant, document).await,
        "review" => validate_review(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_objective(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if let Some(owner) = parse_id(document, "owner") {
        if tx
            .query_opt(
                "SELECT id FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &owner],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Objective owner is not an employee in this tenant".into(),
            ]);
        }
    }
    if action == "removed" {
        if let Some(id) = parse_id(document, "id") {
            if tx
                .query_opt(
                    "SELECT id FROM performance__key_result WHERE tenant_id = $1 AND objective = $2 LIMIT 1",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["An objective with key results cannot be deleted".into()]);
            }
        }
    }
    Ok(Vec::new())
}

async fn validate_key_result(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(objective) = parse_id(document, "objective") else {
        return Ok(vec!["Key result requires a valid objective".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM performance__objective WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &objective],
        )
        .await?
        .is_none()
    {
        return Ok(vec![
            "Key result objective does not exist in this tenant".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_review(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(employee) = parse_id(document, "employee") else {
        return Ok(vec!["Review requires a valid employee".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &employee],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Review employee does not exist in this tenant".into()]);
    }
    if let Some(reviewer) = parse_id(document, "reviewer") {
        if reviewer == employee {
            return Ok(vec![
                "A performance review cannot be reviewed by the employee themselves".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT id FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &reviewer],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Reviewer is not an employee in this tenant".into()]);
        }
    }
    let Some(period) = document
        .get("period")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|period| !period.is_empty())
    else {
        return Ok(Vec::new());
    };
    let id = parse_id(document, "id");
    if action != "removed"
        && tx
            .query_opt(
                "SELECT id FROM performance__review WHERE tenant_id = $1 AND employee = $2 AND lower(btrim(period)) = lower($3) AND ($4::uuid IS NULL OR id <> $4) LIMIT 1",
                &[&tenant.id, &employee, &period, &id],
            )
            .await?
            .is_some()
    {
        return Ok(vec!["An employee can have only one review per period".into()]);
    }
    Ok(Vec::new())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
