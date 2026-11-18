//! Tenant-scoped campaign and segment uniqueness checks.
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
    if entity == "campaign_member" && matches!(action, "created" | "updated") {
        let Some(campaign) = document
            .get("campaign")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Campaign attribution requires a valid campaign".into(),
            ]);
        };
        let Some(lead) = document
            .get("lead")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Campaign attribution requires a valid CRM lead".into(),
            ]);
        };
        let campaign_row = tx
            .query_opt(
                "SELECT status FROM marketing__campaign WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &campaign],
            )
            .await?;
        if !campaign_row
            .is_some_and(|row| matches!(row.get::<_, String>(0).as_str(), "launched" | "completed"))
        {
            return Ok(vec![
                "Leads can be attributed only to launched or completed campaigns".into(),
            ]);
        }
        if tx
            .query_opt(
                "SELECT id FROM crm__lead WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &lead],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Campaign lead was not found in this tenant".into()]);
        }
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let lock_key = format!("marketing-campaign-member:{}:{campaign}:{lead}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM marketing__campaign_member WHERE tenant_id = $1 AND campaign = $2 AND lead = $3 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &campaign, &lead, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "This lead is already attributed to this campaign".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "campaign_cost" && action == "created" {
        let Some(campaign) = document
            .get("campaign")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Campaign cost requires a valid campaign".into()]);
        };
        let Some(bill) = document
            .get("bill")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Campaign cost requires a valid accounting bill".into(),
            ]);
        };
        if tx
            .query_opt(
                "SELECT id FROM marketing__campaign WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &campaign],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Campaign was not found in this tenant".into()]);
        }
        let Some(allocated_amount) = document
            .get("allocated_amount")
            .and_then(crate::money::decimal)
            .map(|amount| amount.normalize().to_string())
        else {
            return Ok(vec![
                "Campaign cost requires a valid allocated amount".into(),
            ]);
        };
        let bill_row = tx
            .query_opt(
                "SELECT status, COALESCE(base_total, total)::numeric::text FROM accounting__bill WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &bill],
            )
            .await?;
        let Some(bill_row) = bill_row else {
            return Ok(vec!["Accounting bill was not found in this tenant".into()]);
        };
        let status: String = bill_row.get(0);
        let bill_amount: String = bill_row.get(1);
        if matches!(status.as_str(), "draft" | "void") {
            return Ok(vec![
                "Campaign costs must reference a positive bill that has been posted".into(),
            ]);
        }
        let lock_key = format!("marketing-campaign-cost:{}:{bill}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        let capacity = tx
            .query_opt(
                "SELECT $3::text::numeric > 0 AND $4::text::numeric > 0 AND COALESCE(sum(COALESCE(cc.allocated_amount::numeric, COALESCE(b.base_total, b.total)::numeric)), 0)::numeric + $3::text::numeric <= $4::text::numeric FROM marketing__campaign_cost cc JOIN accounting__bill b ON b.tenant_id = cc.tenant_id AND b.id = cc.bill WHERE cc.tenant_id = $1 AND cc.bill = $2",
                &[&tenant.id, &bill, &allocated_amount, &bill_amount],
            )
            .await?
            .is_some_and(|row| row.get::<_, bool>(0));
        if !capacity {
            return Ok(vec![
                "Campaign allocations for a bill cannot exceed its original base amount".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    let (table, field, label) = match entity {
        "campaign" => ("marketing__campaign", "name", "Campaign"),
        "segment" => ("marketing__segment", "name", "Segment"),
        _ => return Ok(Vec::new()),
    };
    let Some(value) = document.get(field).and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let normalized = value.trim().to_ascii_lowercase();
    let lock_key = format!("marketing-name:{}:{table}:{normalized}", tenant.id);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let sql = format!(
        "SELECT id FROM {table} WHERE tenant_id = $1 AND lower(btrim({field})) = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE"
    );
    if tx
        .query_opt(&sql, &[&tenant.id, &normalized, &id])
        .await?
        .is_some()
    {
        return Ok(vec![format!("{label} name already exists in this tenant")]);
    }
    Ok(Vec::new())
}
