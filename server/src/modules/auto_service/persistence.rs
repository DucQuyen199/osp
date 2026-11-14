//! Tenant-safe vehicle, customer, warehouse, and repair-order checks.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
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
        "vehicle" => validate_vehicle(tx, tenant, action, document).await,
        "repair_order" => validate_repair_order(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_vehicle(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let id = parse_id(document, "id");
    let party = parse_id(document, "party");
    if let Some(party) = party {
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            errors.push("Chủ xe không tồn tại trong doanh nghiệp".into());
        }
    } else {
        errors.push("Chủ xe phải là mã hợp lệ".into());
    }

    let plate = document
        .get("plate")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if tx
        .query_opt(
            "SELECT id FROM auto_service__vehicle WHERE tenant_id = $1 AND upper(btrim(plate)) = upper($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &plate, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Biển số xe đã được đăng ký trong doanh nghiệp".into());
    }
    if let Some(vin) = document
        .get("vin")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|vin| !vin.is_empty())
    {
        if tx
            .query_opt(
                "SELECT id FROM auto_service__vehicle WHERE tenant_id = $1 AND upper(btrim(vin)) = upper($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &vin, &id],
            )
            .await?
            .is_some()
        {
            errors.push("Số VIN đã được đăng ký trong doanh nghiệp".into());
        }
    }

    if action == "updated" {
        if let Some(id) = id {
            if let Some(row) = tx
                .query_opt(
                    "SELECT party, plate, vin, odometer::text FROM auto_service__vehicle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
            {
                let previous_party: Uuid = row.get(0);
                let previous_plate: String = row.get(1);
                let previous_vin: Option<String> = row.get(2);
                let previous_odometer_text: Option<String> = row.get(3);
                let previous_odometer = previous_odometer_text
                    .map(|value| {
                        money::decimal_str(&value).ok_or_else(|| {
                            ApiError::validation(
                                "auto_service.vehicle.odometer",
                                vec!["Stored odometer reading is not a valid decimal".into()],
                            )
                        })
                    })
                    .transpose()?;
                let referenced = tx
                    .query_opt(
                        "SELECT id FROM auto_service__repair_order WHERE tenant_id = $1 AND vehicle = $2 LIMIT 1 FOR UPDATE",
                        &[&tenant.id, &id],
                    )
                    .await?
                    .is_some();
                if referenced
                    && (party != Some(previous_party)
                        || !plate.eq_ignore_ascii_case(&previous_plate)
                        || document.get("vin").and_then(Value::as_str).map(str::trim)
                            != previous_vin.as_deref())
                {
                    errors.push("Chủ xe, biển số và VIN không thể đổi sau khi đã có lịch sử sửa chữa".into());
                }
                let next_odometer = document.get("odometer").and_then(money::decimal);
                if previous_odometer.zip(next_odometer).is_some_and(|(old, new)| new < old) {
                    errors.push("Số công-tơ-mét không thể giảm so với lần cập nhật trước".into());
                }
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx
                .query_opt(
                    "SELECT id FROM auto_service__repair_order WHERE tenant_id = $1 AND vehicle = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                errors.push("Xe có lịch sử sửa chữa nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_repair_order(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let vehicle = parse_id(document, "vehicle");
    let party = parse_id(document, "party");
    let warehouse = parse_id(document, "warehouse");
    match vehicle {
        Some(vehicle) => {
            if let Some(row) = tx
                .query_opt(
                    "SELECT party FROM auto_service__vehicle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &vehicle],
                )
                .await?
            {
                let vehicle_party: Uuid = row.get(0);
                if party != Some(vehicle_party) {
                    errors.push("Khách hàng trên lệnh sửa chữa phải trùng chủ sở hữu của xe".into());
                }
            } else {
                errors.push("Xe không tồn tại trong doanh nghiệp".into());
            }
        }
        None => errors.push("Xe phải là mã hợp lệ".into()),
    }
    if let Some(warehouse) = warehouse {
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            errors.push("Kho phụ tùng không tồn tại trong doanh nghiệp".into());
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
