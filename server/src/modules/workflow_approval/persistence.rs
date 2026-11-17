use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Tenant},
    money,
};
use serde_json::Value;
use uuid::Uuid;

fn listed_as(value: Option<&Value>, user_id: &str, roles: &[String]) -> bool {
    let Some(value) = value else {
        return false;
    };
    match value {
        Value::String(entry) => entry == user_id || roles.iter().any(|role| role == entry),
        Value::Array(entries) => entries.iter().any(|entry| {
            entry
                .as_str()
                .is_some_and(|entry| entry == user_id || roles.iter().any(|role| role == entry))
        }),
        Value::Object(entries) => {
            ["users", "userIds"].iter().any(|key| {
                entries.get(*key).is_some_and(|users| {
                    users.as_array().is_some_and(|users| {
                        users.iter().any(|entry| entry.as_str() == Some(user_id))
                    })
                })
            }) || entries.get("roles").is_some_and(|allowed_roles| {
                allowed_roles.as_array().is_some_and(|allowed_roles| {
                    allowed_roles.iter().any(|entry| {
                        entry
                            .as_str()
                            .is_some_and(|entry| roles.iter().any(|role| role == entry))
                    })
                })
            })
        }
        _ => false,
    }
}

pub async fn authorize_decision(
    tx: &Tx<'_>,
    tenant: &Tenant,
    actor: &Actor,
    action: &str,
    request: &Value,
) -> R<()> {
    if !matches!(action, "approved" | "rejected") {
        return Ok(());
    }
    let Actor::User { id, roles, .. } = actor else {
        return Ok(());
    };
    if request.get("requested_by_user").and_then(Value::as_str) == Some(id.as_str()) {
        return Err(ApiError::forbidden(
            "A user cannot approve or reject their own request",
        ));
    }
    let Some(entity) = request.get("entity").and_then(Value::as_str) else {
        return Err(ApiError::validation(
            "workflow-approval.approval_request",
            vec!["Approval request must identify its target entity".into()],
        ));
    };
    let amount = request
        .get("amount")
        .and_then(money::decimal)
        .unwrap_or_default()
        .abs();
    let amount_text = amount.normalize().to_string();
    let rule = tx
        .query_opt(
            "SELECT approvers FROM workflow_approval__approval_rule WHERE tenant_id = $1 AND entity = $2 AND (min_amount IS NULL OR min_amount <= $3::text::numeric) ORDER BY min_amount DESC NULLS LAST, id LIMIT 1 FOR SHARE",
            &[&tenant.id, &entity, &amount_text],
        )
        .await?;
    if let Some(rule) = rule {
        let approvers: Value = rule.get(0);
        if !listed_as(Some(&approvers), id, roles) {
            return Err(ApiError::forbidden(
                "The approval rule does not authorize this user or role",
            ));
        }
    }
    Ok(())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity != "approval_rule" || !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    let Some(target) = document.get("entity").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .unwrap_or(Uuid::nil());
    let min_amount = document
        .get("min_amount")
        .filter(|amount| !amount.is_null())
        .and_then(money::decimal)
        .map(|amount| amount.normalize().to_string());
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("workflow-approval:{}:{target}", tenant.id)],
    )
    .await?;
    if tx
        .query_opt(
            "SELECT 1 FROM workflow_approval__approval_rule WHERE tenant_id = $1 AND entity = $2 AND min_amount IS NOT DISTINCT FROM $3::text::numeric AND id <> $4 LIMIT 1",
            &[&tenant.id, &target, &min_amount, &id],
        )
        .await?
        .is_some()
    {
        return Ok(vec![
            "Each approval target may have only one rule for a given minimum amount".into(),
        ]);
    }

    let Some(approvers) = document.get("approvers") else {
        return Ok(vec![
            "Approval rules must define at least one approver".into(),
        ]);
    };
    let (mut user_ids, role_ids) = match approvers {
        Value::Array(entries) => {
            let (roles, users): (Vec<_>, Vec<_>) = entries
                .iter()
                .filter_map(Value::as_str)
                .partition(|entry| tenant.roles.contains_key(*entry));
            (
                users.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                roles.into_iter().map(str::to_owned).collect::<Vec<_>>(),
            )
        }
        Value::Object(entries) => {
            let users = ["users", "userIds"]
                .iter()
                .filter_map(|key| entries.get(*key))
                .filter_map(Value::as_array)
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let roles = entries
                .get("roles")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            (users, roles)
        }
        _ => (Vec::new(), Vec::new()),
    };
    user_ids.sort_unstable();
    user_ids.dedup();
    let roles_exist = role_ids.iter().all(|role| tenant.roles.contains_key(role));
    let users_exist = user_ids.is_empty()
        || tx
            .query(
                "SELECT count(*)::bigint FROM osp_users WHERE tenant_id = $1 AND id = ANY($2)",
                &[&tenant.id, &user_ids],
            )
            .await?
            .first()
            .map(|row| row.get::<_, i64>(0))
            .unwrap_or_default()
            == user_ids.len() as i64;
    if !roles_exist || !users_exist {
        return Ok(vec![
            "Approval rules may reference only users and roles belonging to this tenant".into(),
        ]);
    }
    Ok(Vec::new())
}

pub fn table_for(entity: &str) -> Option<&'static str> {
    match entity {
        "purchasing.purchase_order" => Some("purchasing__purchase_order"),
        "purchasing.supplier_invoice" => Some("purchasing__supplier_invoice"),
        "purchasing.purchase_requisition" => Some("purchasing__purchase_requisition"),
        "payroll.payroll_run" => Some("payroll__payroll_run"),
        "inventory.stock_count" => Some("inventory__stock_count"),
        "manufacturing.conditional_acceptance" => Some("manufacturing__conditional_acceptance"),
        "sales.sales_return" => Some("sales__sales_return"),
        "purchasing.purchase_return" => Some("purchasing__purchase_return"),
        "expense.expense_claim" => Some("expense__expense_claim"),
        "hrm.leave_request" => Some("hrm__leave_request"),
        "accounting.settlement_batch" => Some("accounting__settlement_batch"),
        "accounting.journal_entry" => Some("accounting__journal_entry"),
        "contract.amendment" => Some("contract__amendment"),
        _ => None,
    }
}

pub async fn lock_record(tx: &Tx<'_>, tenant: &Tenant, table: &str, id: Uuid) -> R<bool> {
    let sql = format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE");
    Ok(tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_some())
}
