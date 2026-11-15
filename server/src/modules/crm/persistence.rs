//! Tenant-scoped CRM cross-record invariants.
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
    if entity == "pipeline_stage" && matches!(action, "created" | "updated") {
        let Some(stage) = document.get("stage").and_then(Value::as_str) else {
            return Ok(vec!["CRM pipeline stage code is required".into()]);
        };
        let id = parse_uuid(document, "id");
        let lock_key = format!("crm-pipeline-stage:{}:{stage}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM crm__pipeline_stage WHERE tenant_id = $1 AND stage = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &stage, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec![
                "Each CRM pipeline stage can have only one probability configuration per tenant".into(),
            ]);
        }
    }
    if entity == "pipeline_stage" && action == "removed" {
        if let Some(stage) = document.get("stage").and_then(Value::as_str) {
            let lock_key = format!("crm-pipeline-stage:{}:{stage}", tenant.id);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            if tx
                .query_opt(
                    "SELECT id FROM crm__deal WHERE tenant_id = $1 AND (pipeline_stage = $2 OR lower(btrim(stage)) = $2) LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &stage],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Không thể xóa giai đoạn đang được dùng bởi cơ hội bán hàng".into(),
                ]);
            }
        }
    }
    if entity == "deal" && matches!(action, "created" | "updated") {
        if let Some(stage) = document
            .get("pipeline_stage")
            .and_then(Value::as_str)
            .filter(|stage| !stage.is_empty())
        {
            if super::domain::canonical_pipeline_stage(stage).is_none() {
                let lock_key = format!("crm-pipeline-stage:{}:{stage}", tenant.id);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                if tx
                    .query_opt(
                        "SELECT id FROM crm__pipeline_stage WHERE tenant_id = $1 AND stage = $2 LIMIT 1 FOR SHARE",
                        &[&tenant.id, &stage],
                    )
                    .await?
                    .is_none()
                {
                    return Ok(vec![
                        "Tạo cấu hình xác suất cho giai đoạn này trước khi gán cơ hội".into(),
                    ]);
                }
            }
        }
    }
    if entity == "activity" {
        return validate_activity(tx, tenant, action, document).await;
    }
    if entity == "lead" && action == "converted" {
        let lead_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(lead_id) = lead_id else {
            return Ok(vec!["Lead conversion requires a valid id".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND source = 'crm_lead' AND source_id = $2 LIMIT 1",
                &[&tenant.id, &lead_id.to_string()],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["This lead has already been converted".into()]);
        }
    }
    if entity == "deal" && action == "won" {
        let party_id = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(party_id) = party_id else {
            return Ok(vec!["A won deal requires a valid customer".into()]);
        };
        let customer = tx
            .query_opt(
                "SELECT is_customer FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &party_id],
            )
            .await?;
        if !customer.is_some_and(|row| row.get::<_, Option<bool>>(0) != Some(false)) {
            return Ok(vec![
                "Deal customer was not found or is not a customer".into(),
            ]);
        }
        let warehouse = parse_uuid(document, "warehouse");
        if let Some(warehouse) = warehouse {
            if tx
                .query_opt(
                    "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &warehouse],
                )
                .await?
                .is_none()
            {
                return Ok(vec!["Kho xuất hàng không thuộc doanh nghiệp này".into()]);
            }
        }
        if let Some(price_list) = parse_uuid(document, "price_list") {
            if tx
                .query_opt(
                    "SELECT id FROM sales__price_list WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &price_list],
                )
                .await?
                .is_none()
            {
                return Ok(vec!["Bảng giá không thuộc doanh nghiệp này".into()]);
            }
        }
    }
    Ok(Vec::new())
}

async fn validate_activity(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let targets: Vec<_> = ["deal", "lead", "party"]
        .iter()
        .filter_map(|field| {
            document
                .get(*field)
                .filter(|value| !value.is_null())
                .map(|value| (*field, value))
        })
        .collect();
    if targets.len() > 1 {
        return Ok(vec![
            "CRM activity must reference only one lead, deal, or customer".into(),
        ]);
    }
    if action == "created" && targets.is_empty() {
        return Ok(vec![
            "Link a CRM activity to a lead, deal, or customer".into(),
        ]);
    }
    if action == "updated" {
        let Some(id) = parse_uuid(document, "id") else {
            return Ok(vec!["Cannot identify the CRM activity to update".into()]);
        };
        let existing = tx
            .query_opt(
                "SELECT deal, lead, party FROM crm__activity WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id],
            )
            .await?;
        let Some(existing) = existing else {
            return Ok(vec!["CRM activity was not found in this tenant".into()]);
        };
        let old_targets = [
            existing.get::<_, Option<Uuid>>(0),
            existing.get::<_, Option<Uuid>>(1),
            existing.get::<_, Option<Uuid>>(2),
        ];
        let new_targets = [
            parse_uuid(document, "deal"),
            parse_uuid(document, "lead"),
            parse_uuid(document, "party"),
        ];
        if old_targets.iter().any(Option::is_some) && old_targets != new_targets {
            return Ok(vec![
                "A CRM activity's record association is immutable to preserve customer history"
                    .into(),
            ]);
        }
        if targets.is_empty() {
            return Ok(Vec::new());
        }
    }
    let Some((field, value)) = targets.first() else {
        return Ok(Vec::new());
    };
    let Some(id) = value.as_str().and_then(|value| Uuid::parse_str(value).ok()) else {
        return Ok(vec!["CRM activity target must be a valid record id".into()]);
    };
    let exists = match *field {
        "deal" => tx
            .query_opt(
                "SELECT id FROM crm__deal WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &id],
            )
            .await?
            .is_some(),
        "lead" => tx
            .query_opt(
                "SELECT id FROM crm__lead WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &id],
            )
            .await?
            .is_some(),
        "party" => tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &id],
            )
            .await?
            .is_some(),
        _ => false,
    };
    if exists {
        Ok(Vec::new())
    } else {
        Ok(vec![
            "CRM activity target was not found in this tenant".into(),
        ])
    }
}

fn parse_uuid(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
