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
        (
            "reservation",
            "created" | "updated" | "reserved" | "converted" | "cancelled" | "expired",
        ) => validate_reservation(tx, tenant, action, document).await,
        ("lease", "activated") => validate_lease_activation(tx, tenant, document).await,
        ("lease", "updated") if document.get("amendment_in_progress").is_some() => {
            validate_lease_amendment(tx, tenant, document).await
        }
        ("lease", "rent_due") => validate_rent_due(tx, tenant, document).await,
        ("lease", "terminated") => validate_lease_termination(tx, tenant, document).await,
        ("property", "leased") => validate_property_has_active_lease(tx, tenant, document).await,
        ("property", "reserved") => validate_property_has_reservation(tx, tenant, document).await,
        ("property", "sold") => validate_property_sale(tx, tenant, document).await,
        ("property", "released") => {
            validate_property_has_no_active_lease(tx, tenant, document).await
        }
        ("viewing", "created" | "updated") => validate_viewing(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_lease_amendment(tx: &Tx<'_>, tenant: &Tenant, lease: &Value) -> R<Vec<String>> {
    let (Some(lease_id), Some(amendment_id)) = (
        parse_id(lease, "id"),
        parse_id(lease, "amendment_in_progress"),
    ) else {
        return Ok(vec![
            "Điều chỉnh lease phải tham chiếu phụ lục hợp đồng hợp lệ".into(),
        ]);
    };
    if lease.get("last_amendment").and_then(Value::as_str)
        != lease.get("amendment_in_progress").and_then(Value::as_str)
    {
        return Ok(vec![
            "Phụ lục lease đang áp dụng không khớp dấu vết gần nhất".into(),
        ]);
    }
    if lease.get("status").and_then(Value::as_str) != Some("active") {
        return Ok(vec![
            "Chỉ lease đang hoạt động mới được thay đổi điều khoản".into(),
        ]);
    }
    let Some(row) = tx
        .query_opt(
            "SELECT a.changes FROM contract__amendment a JOIN contract__contract c ON c.tenant_id = a.tenant_id AND c.id = a.contract WHERE a.tenant_id = $1 AND a.id = $2 AND a.status = 'effective' AND c.source = 'real_estate_lease' AND c.source_id = $3 AND a.effective_date <= CURRENT_DATE",
            &[&tenant.id, &amendment_id, &lease_id.to_string()],
        )
        .await?
    else {
        return Ok(vec!["Lease chỉ được cập nhật từ phụ lục đã có hiệu lực của đúng hợp đồng nguồn".into()]);
    };
    let changes: Value = row.get(0);
    if let Some(value) = changes.get("value") {
        if crate::money::decimal(value) != lease.get("rent").and_then(crate::money::decimal) {
            return Ok(vec![
                "Giá thuê phải khớp giá trị đã duyệt trong phụ lục".into(),
            ]);
        }
    }
    if let Some(end_date) = changes.get("end_date")
        && lease.get("end_date") != Some(end_date)
    {
        return Ok(vec![
            "Ngày kết thúc lease phải khớp phụ lục đã duyệt".into(),
        ]);
    }
    Ok(Vec::new())
}

async fn validate_reservation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let (Some(property), Some(party)) =
        (parse_id(document, "property"), parse_id(document, "party"))
    else {
        return Ok(vec![
            "Reservation requires a property and a tenant-owned customer".into(),
        ]);
    };
    let Some(property_row) = tx
        .query_opt(
            "SELECT status FROM real_estate__property WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            &[&tenant.id, &property],
        )
        .await?
    else {
        return Ok(vec![
            "Reservation property was not found in this company".into(),
        ]);
    };
    let property_status: String = property_row.get(0);
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Reservation customer was not found in this company".into());
    }
    let number = document
        .get("number")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended('real-estate:reservation:' || $1::text || ':' || lower(btrim($2)), 0))",
        &[&tenant.id, &number],
    ).await?;
    let current_id = parse_id(document, "id");
    if tx.query_opt(
        "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND lower(btrim(number))=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &number, &current_id],
    ).await?.is_some() {
        errors.push("Reservation number already exists in this company".into());
    }
    if matches!(action, "created" | "updated") && property_status != "available" {
        errors.push("A new reservation draft can only be created for an available property".into());
    }
    if matches!(action, "reserved" | "converted") {
        if !matches!(property_status.as_str(), "available" | "reserved") {
            errors.push("Only an available or held property can be reserved or converted".into());
        }
        if tx.query_opt(
            "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND property=$2 AND status='reserved' AND ($3::uuid IS NULL OR id<>$3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property, &current_id],
        ).await?.is_some() {
            errors.push("The property already has an active reservation".into());
        }
    }
    if action == "converted" && property_status != "reserved" {
        errors.push("A reservation can be converted only while its property is held".into());
    }
    if action == "expired" {
        let expires_on = document.get("expires_on").and_then(Value::as_str);
        if expires_on
            .is_none_or(|date| date >= chrono::Utc::now().date_naive().to_string().as_str())
        {
            errors.push("A reservation expires only after its expiry date has passed".into());
        }
    }
    if action == "converted" {
        let expires_on = document.get("expires_on").and_then(Value::as_str);
        if expires_on.is_none_or(|date| date < chrono::Utc::now().date_naive().to_string().as_str())
        {
            errors.push("An expired reservation cannot be converted to a sale".into());
        }
    }
    Ok(errors)
}

async fn validate_property_has_reservation(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(property) = parse_id(document, "id") else {
        return Ok(vec!["Property hold requires a valid record".into()]);
    };
    let has_reservation = tx.query_opt(
        "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND property=$2 AND status='reserved' LIMIT 1 FOR UPDATE",
        &[&tenant.id, &property],
    ).await?.is_some();
    Ok(if has_reservation {
        Vec::new()
    } else {
        vec!["A property can be marked reserved only through an active reservation record".into()]
    })
}

async fn validate_property_sale(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(property) = parse_id(document, "id") else {
        return Ok(vec!["Property sale requires a valid record".into()]);
    };
    let held = tx.query_opt(
        "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND property=$2 AND status='reserved' LIMIT 1 FOR UPDATE",
        &[&tenant.id, &property],
    ).await?.is_some();
    Ok(if held {
        vec!["Convert or cancel the active reservation before selling the property".into()]
    } else {
        Vec::new()
    })
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
    if document.get("status").and_then(Value::as_str) == Some("reserved") {
        let Some(property) = parse_id(document, "id") else {
            return Ok(vec!["Property release requires a valid record".into()]);
        };
        if tx.query_opt(
            "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND property=$2 AND status='reserved' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &property],
        ).await?.is_some() {
            return Ok(vec!["Cancel or expire the reservation before releasing its property".into()]);
        }
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
    if tx.query_opt(
        "SELECT id FROM real_estate__reservation WHERE tenant_id=$1 AND property=$2 AND status='reserved' LIMIT 1 FOR UPDATE",
        &[&tenant.id, &property],
    ).await?.is_some() {
        errors.push("Cancel or expire the active reservation before activating a lease".into());
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
