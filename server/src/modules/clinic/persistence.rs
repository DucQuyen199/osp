//! Tenant-scoped patient links, encounter integrity, and dispensing guards.
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
        "patient" => validate_patient(tx, tenant, action, document).await,
        "encounter" => validate_encounter(tx, tenant, action, document).await,
        "prescription" => validate_prescription(tx, tenant, action, document).await,
        "lab_order" => validate_lab_order(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_patient(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(party) = parse_id(document, "party") else {
        return Ok(vec!["Hồ sơ bệnh nhân cần đối tác hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Đối tác bệnh nhân không tồn tại trong doanh nghiệp".into());
    }
    if tx.query_opt(
        "SELECT id FROM clinic__patient WHERE tenant_id = $1 AND party = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &party, &id],
    ).await?.is_some() {
        errors.push("Đối tác đã có hồ sơ bệnh nhân trong phòng khám này".into());
    }
    if action == "updated" {
        if let Some(id) = id {
            let has_encounters = tx.query_opt(
                "SELECT id FROM clinic__encounter WHERE tenant_id = $1 AND patient = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some();
            if has_encounters {
                if let Some(old) = tx.query_opt(
                    "SELECT party FROM clinic__patient WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                ).await? {
                    let old_party: Uuid = old.get(0);
                    if party != old_party {
                        errors.push("Không thể đổi danh tính đối tác của bệnh nhân sau khi đã có lượt khám".into());
                    }
                }
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM clinic__encounter WHERE tenant_id = $1 AND patient = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Bệnh nhân đã có lượt khám nên không thể xóa hồ sơ".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_encounter(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(patient) = parse_id(document, "patient") else {
        return Ok(vec!["Lượt khám cần hồ sơ bệnh nhân hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT party FROM clinic__patient WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &patient],
        )
        .await?
    else {
        return Ok(vec!["Bệnh nhân không tồn tại trong doanh nghiệp".into()]);
    };
    let patient_party: Uuid = row.get(0);
    let mut errors = Vec::new();
    if parse_id(document, "party") != Some(patient_party) {
        errors.push("Khách hàng trên lượt khám phải trùng với bệnh nhân".into());
    }
    if action == "removed" {
        if let Some(id) = parse_id(document, "id") {
            let has_orders = tx.query_opt(
                "SELECT id FROM clinic__prescription WHERE tenant_id = $1 AND encounter = $2 UNION ALL SELECT id FROM clinic__lab_order WHERE tenant_id = $1 AND encounter = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some();
            if has_orders {
                errors.push("Lượt khám có đơn thuốc hoặc xét nghiệm nên không thể xóa".into());
            }
        }
    }
    if action == "updated" {
        if let Some(id) = parse_id(document, "id") {
            let has_orders = tx.query_opt(
                "SELECT id FROM clinic__prescription WHERE tenant_id = $1 AND encounter = $2 UNION ALL SELECT id FROM clinic__lab_order WHERE tenant_id = $1 AND encounter = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some();
            if has_orders {
                if let Some(old) = tx.query_opt(
                    "SELECT patient FROM clinic__encounter WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                ).await? {
                    let old_patient: Uuid = old.get(0);
                    if patient != old_patient {
                        errors.push("Không thể đổi bệnh nhân của lượt khám đã có chỉ định thuốc hoặc xét nghiệm".into());
                    }
                }
            }
        }
    }
    Ok(errors)
}

async fn validate_prescription(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(encounter) = parse_id(document, "encounter") else {
        return Ok(vec!["Đơn thuốc cần lượt khám hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT status FROM clinic__encounter WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &encounter],
        )
        .await?
    else {
        return Ok(vec![
            "Lượt khám của đơn thuốc không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    let status: String = row.get(0);
    let mut errors = Vec::new();
    if matches!(action, "created" | "updated") && status != "open" {
        errors.push("Chỉ có thể tạo hoặc sửa đơn thuốc khi lượt khám còn mở".into());
    }
    if action == "dispensed" && status != "completed" {
        errors.push("Chỉ phát thuốc sau khi lượt khám đã hoàn tất".into());
    }
    if let Some(warehouse) = parse_id(document, "warehouse") {
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            errors.push("Kho phát thuốc không tồn tại trong doanh nghiệp".into());
        }
    }
    Ok(errors)
}

async fn validate_lab_order(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(encounter) = parse_id(document, "encounter") else {
        return Ok(vec!["Chỉ định xét nghiệm cần lượt khám hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT status FROM clinic__encounter WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &encounter],
        )
        .await?
    else {
        return Ok(vec![
            "Lượt khám của chỉ định không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    let encounter_status: String = row.get(0);
    if action == "created" && encounter_status != "open" {
        return Ok(vec!["Chỉ thêm xét nghiệm cho lượt khám đang mở".into()]);
    }
    Ok(Vec::new())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
