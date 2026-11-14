//! Tenant-scoped insurance references, policy limits, and historical protection.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "insurance.persistence",
            vec![format!("Stored insurance {field} is not a valid decimal")],
        )
    })
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "policy" => validate_policy(tx, tenant, action, document).await,
        "claim" => validate_claim(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_policy(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if action != "removed" {
        let Some(party) = parse_id(document, "party") else {
            return Ok(vec!["Bên mua bảo hiểm phải là đối tác hợp lệ".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            errors.push("Bên mua bảo hiểm không tồn tại trong doanh nghiệp".into());
        }
        let number = document
            .get("number")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        tx.query_one_row(
            "SELECT pg_advisory_xact_lock(hashtextextended('insurance:policy-number:' || $1::text || ':' || lower(btrim($2)), 0))",
            &[&tenant.id, &number],
        )
        .await?;
        if tx.query_opt(
            "SELECT id FROM insurance__policy WHERE tenant_id = $1 AND lower(btrim(number)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &number, &id],
        ).await?.is_some() {
            errors.push("Số hợp đồng bảo hiểm đã tồn tại trong doanh nghiệp".into());
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM insurance__claim WHERE tenant_id = $1 AND policy = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Hợp đồng đã có hồ sơ bồi thường nên không thể xóa".into());
            }
        }
    }
    if action == "cancelled" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM insurance__claim WHERE tenant_id = $1 AND policy = $2 AND status IN ('approved', 'paid') LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Không thể hủy hợp đồng đã có hồ sơ bồi thường được duyệt hoặc chi trả".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_claim(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(policy) = parse_id(document, "policy") else {
        return Ok(vec!["Hồ sơ bồi thường cần hợp đồng bảo hiểm hợp lệ".into()]);
    };
    let Some(incident_date) = document.get("incident_date").and_then(Value::as_str) else {
        return Ok(vec!["Hồ sơ bồi thường cần ngày xảy ra sự cố".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT status, coverage_limit::text, start_date::text, end_date::text FROM insurance__policy WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &policy],
    ).await? else {
        return Ok(vec!["Hợp đồng bảo hiểm không tồn tại trong doanh nghiệp".into()]);
    };
    let policy_status: String = row.get(0);
    let coverage_limit = decimal_column(&row, 1, "coverage limit")?;
    let start_date: Option<String> = row.get(2);
    let end_date: Option<String> = row.get(3);
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if let Some(account) = parse_id(document, "expense_account") {
        if tx.query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
            &[&tenant.id, &account],
        ).await?.is_none() {
            errors.push("Claim payout requires an expense account in this tenant".into());
        }
    }
    if action == "created" && policy_status != "active" {
        errors.push("Chỉ hợp đồng đang có hiệu lực mới tiếp nhận bồi thường".into());
    }
    if start_date
        .as_deref()
        .is_none_or(|start| incident_date < start)
        || end_date.as_deref().is_none_or(|end| incident_date > end)
    {
        errors.push("Ngày xảy ra sự cố nằm ngoài thời hạn bảo hiểm".into());
    }
    let number = document
        .get("number")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended('insurance:claim-number:' || $1::text || ':' || lower(btrim($2)), 0))",
        &[&tenant.id, &number],
    )
    .await?;
    if tx.query_opt(
        "SELECT id FROM insurance__claim WHERE tenant_id = $1 AND lower(btrim(number)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &number, &id],
    ).await?.is_some() {
        errors.push("Mã hồ sơ bồi thường đã tồn tại trong doanh nghiệp".into());
    }
    if action == "approved" {
        let amount = document
            .get("approved_amount")
            .filter(|value| !value.is_null())
            .and_then(money::decimal)
            .or_else(|| document.get("amount").and_then(money::decimal))
            .unwrap_or_default();
        let existing = tx.query_opt(
            "SELECT COALESCE(sum(COALESCE(approved_amount, amount)::numeric), 0)::text FROM insurance__claim WHERE tenant_id = $1 AND policy = $2 AND status IN ('approved', 'paid') AND ($3::uuid IS NULL OR id <> $3)",
            &[&tenant.id, &policy, &id],
        ).await?;
        let existing = existing
            .map(|row| decimal_column(&row, 0, "existing claims"))
            .transpose()?
            .unwrap_or(Decimal::ZERO);
        let total_claims = existing.checked_add(amount);
        let limit = coverage_limit.checked_add(Decimal::new(1, 4));
        if total_claims
            .zip(limit)
            .is_none_or(|(total, limit)| total > limit)
        {
            errors.push(format!(
                "Tổng bồi thường vượt hạn mức bảo hiểm ({coverage_limit})"
            ));
        }
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
