//! Tenant-scoped property locks and lease exclusivity checks.
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
    match (entity, action) {
        ("lease", "activated") => validate_lease_activation(tx, tenant, document).await,
        ("lease", "rent_due") => validate_rent_due(tx, tenant, document).await,
        ("lease", "terminated") => validate_lease_termination(tx, tenant, document).await,
        ("property", "leased") => validate_property_has_active_lease(tx, tenant, document).await,
        ("property", "released") => {
            validate_property_has_no_active_lease(tx, tenant, document).await
        }
        ("viewing", "created" | "updated") => validate_viewing(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_rent_due(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(id) = parse_id(document, "id") else {
        return Ok(vec!["Rent billing requires a valid lease record".into()]);
    };
    let row = tx.query_opt(
        "SELECT status, next_rent_date, end_date FROM real_estate__lease WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &id],
    ).await?;
    let Some(row) = row else {
        return Ok(vec!["Lease was not found for this tenant".into()]);
    };
    let status: String = row.get(0);
    let next: Option<chrono::NaiveDate> = row.get(1);
    let end: Option<chrono::NaiveDate> = row.get(2);
    let today = chrono::Utc::now().date_naive();
    if status != "active"
        || next.is_none_or(|date| date > today || end.is_some_and(|end| date > end))
    {
        return Ok(vec![
            "Only an active lease with a rent date due within its term can be billed".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_lease_termination(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(id) = parse_id(document, "id") else {
        return Ok(vec![
            "Lease termination requires a valid lease record".into(),
        ]);
    };
    let pending = tx.query_opt(
        "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND id = $2 AND next_rent_date IS NOT NULL AND next_rent_date <= end_date AND next_rent_date <= CURRENT_DATE LIMIT 1 FOR UPDATE",
        &[&tenant.id, &id],
    ).await?.is_some();
    if pending {
        return Ok(vec![
            "Bill all rent installments due within the lease term before terminating it".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_property_has_active_lease(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(property) = parse_id(document, "id") else {
        return Ok(vec!["Property transition requires a valid record".into()]);
    };
    let active_lease = tx
        .query_opt(
            "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND property = $2 AND status = 'active' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property],
        )
        .await?
        .is_some();
    if !active_lease {
        return Ok(vec![
            "A property can be marked leased only while an active lease exists".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_property_has_no_active_lease(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(property) = parse_id(document, "id") else {
        return Ok(vec!["Property transition requires a valid record".into()]);
    };
    let active_lease = tx
        .query_opt(
            "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND property = $2 AND status = 'active' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property],
        )
        .await?
        .is_some();
    if active_lease {
        return Ok(vec![
            "A property with an active lease cannot be released".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_lease_activation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let (Some(property), Some(lease_id)) =
        (parse_id(document, "property"), parse_id(document, "id"))
    else {
        return Ok(vec![
            "Lease activation requires a valid property and lease record".into(),
        ]);
    };
    let (Some(start), Some(end)) = (date(document, "start_date"), date(document, "end_date"))
    else {
        return Ok(vec![
            "Lease activation requires valid start and end dates".into(),
        ]);
    };

    let Some(property_row) = tx
        .query_opt(
            "SELECT status FROM real_estate__property WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &property],
        )
        .await?
    else {
        return Ok(vec!["Lease property does not exist in this company".into()]);
    };
    let property_status: String = property_row.get(0);
    let mut errors = Vec::new();
    if !matches!(property_status.as_str(), "available" | "reserved") {
        errors.push("Only an available or reserved property can be leased".into());
    }

    let overlap = tx
        .query_opt(
            "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND property = $2 AND id <> $3 AND status = 'active' AND start_date <= $4::date AND end_date >= $5::date LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property, &lease_id, &end, &start],
        )
        .await?
        .is_some();
    if overlap {
        errors.push("The property already has an active lease overlapping these dates".into());
    }
    Ok(errors)
}

async fn validate_viewing(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(property) = parse_id(document, "property") else {
        return Ok(vec!["A viewing requires a valid property".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT status FROM real_estate__property WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &property],
        )
        .await?
    else {
        return Ok(vec![
            "Viewing property does not exist in this company".into(),
        ]);
    };
    let status: String = row.get(0);
    if status == "sold" {
        return Ok(vec![
            "A sold property cannot be scheduled for viewing".into(),
        ]);
    }
    Ok(Vec::new())
}

pub async fn lock_property_status(
    tx: &Tx<'_>,
    tenant: &Tenant,
    property: Uuid,
) -> R<Option<String>> {
    Ok(tx
        .query_opt(
            "SELECT status FROM real_estate__property WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &property],
        )
        .await?
        .map(|row| row.get(0)))
}

pub async fn has_other_active_lease(
    tx: &Tx<'_>,
    tenant: &Tenant,
    property: Uuid,
    lease_id: Uuid,
) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT id FROM real_estate__lease WHERE tenant_id = $1 AND property = $2 AND id <> $3 AND status = 'active' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property, &lease_id],
        )
        .await?
        .is_some())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn date(document: &Value, field: &str) -> Option<chrono::NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}
