//! Tenant ownership, crop-cycle locks, and stock destination validation.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::{Map, Value};
use uuid::Uuid;

/// Snapshot the selected product unit and convert operational quantities to
/// the product's base inventory unit before source-stock events are emitted.
pub async fn prepare_stock_quantity(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if !matches!(entity, "harvest" | "input_application") {
        return Ok(Vec::new());
    }
    for field in ["base_qty", "uom_name", "uom_ratio", "base_uom"] {
        document.remove(field);
    }
    let Some(product_id) = document
        .get("product")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(Vec::new());
    };
    let selected_unit = match document.get("uom") {
        Some(Value::String(value)) => match Uuid::parse_str(value) {
            Ok(unit) => Some(unit),
            Err(_) => return Ok(vec!["Selected agricultural unit is invalid".into()]),
        },
        Some(value) if !value.is_null() => {
            return Ok(vec!["Selected agricultural unit is invalid".into()]);
        }
        _ => None,
    };
    let unit = match crate::modules::master_data::unit_conversion::resolve(
        tx,
        tenant,
        product_id,
        selected_unit,
    )
    .await?
    {
        Ok(unit) => unit,
        Err(message) => return Ok(vec![format!("Agricultural unit: {message}")]),
    };
    if let Some(quantity) = document.get("qty").and_then(crate::money::decimal) {
        let Some(base_quantity) = unit
            .base_quantity(quantity)
            .and_then(crate::money::json_number)
        else {
            return Ok(vec![
                "Agricultural quantity exceeds the supported range".into(),
            ]);
        };
        document.insert("base_qty".into(), base_quantity);
    }
    if let Some(unit_id) = unit.unit_id {
        document.insert("uom".into(), serde_json::json!(unit_id));
    }
    if let Some(name) = unit.unit_name {
        document.insert("uom_name".into(), serde_json::json!(name));
    }
    if let Some(base_unit) = unit.base_unit_id {
        document.insert("base_uom".into(), serde_json::json!(base_unit));
    }
    let Some(ratio) = crate::money::json_number(unit.ratio) else {
        return Ok(vec![
            "Agricultural unit ratio exceeds the supported range".into(),
        ]);
    };
    document.insert("uom_ratio".into(), ratio);
    Ok(Vec::new())
}

pub async fn prepare_input_application(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if document.get("kind").and_then(Value::as_str) != Some("pesticide") {
        return Ok(Vec::new());
    }
    let Some(product) = parse_id(&Value::Object(document.clone()), "product") else {
        return Ok(Vec::new());
    };
    let Some(row) = tx
        .query_opt(
            "SELECT COALESCE(preharvest_interval_days, 0)::text FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product],
        )
        .await?
    else {
        return Ok(Vec::new());
    };
    let interval: String = row.get(0);
    let Some(snapshot) = serde_json::from_str::<Value>(&interval)
        .ok()
        .filter(|value| value.is_number())
    else {
        return Ok(vec![
            "Бүтээгдэхүүний ургацын өмнөх хүлээлгийн хугацаа буруу байна".into(),
        ]);
    };
    document.insert("preharvest_interval_days".into(), snapshot);
    Ok(Vec::new())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "farm" => validate_farm(tx, tenant, action, document).await,
        "crop_cycle" => validate_cycle(tx, tenant, action, document).await,
        "harvest" => validate_harvest(tx, tenant, document).await,
        "input_application" => validate_input(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_farm(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if let Some(owner) = parse_id(document, "owner") {
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &owner],
            )
            .await?
            .is_none()
        {
            errors.push("Chủ trang trại không tồn tại trong doanh nghiệp".into());
        }
    }
    let name = document
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if tx.query_opt(
        "SELECT id FROM agriculture__farm WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &name, &id],
    ).await?.is_some() {
        errors.push("Tên trang trại đã tồn tại trong doanh nghiệp".into());
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM agriculture__crop_cycle WHERE tenant_id = $1 AND farm = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Trang trại đã có vụ mùa nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_cycle(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(farm) = parse_id(document, "farm") else {
        return Ok(vec!["Vụ mùa cần trang trại hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    if tx
        .query_opt(
            "SELECT id FROM agriculture__farm WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &farm],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Trang trại không tồn tại trong doanh nghiệp".into()]);
    }
    let mut errors = Vec::new();
    let today: String = tx
        .query("SELECT current_date::text", &[])
        .await?
        .first()
        .map(|row| row.get(0))
        .ok_or_else(|| crate::error::ApiError::internal("Database did not return current date"))?;
    if document
        .get("planted_on")
        .and_then(Value::as_str)
        .is_some_and(|planted_on| planted_on > today.as_str())
    {
        errors.push(
            "Vụ mùa chỉ được ghi ngày gieo trồng thực tế, không thể ghi ngày tương lai".into(),
        );
    }
    if action == "updated" || action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM agriculture__harvest WHERE tenant_id = $1 AND cycle = $2 UNION ALL SELECT id FROM agriculture__input_application WHERE tenant_id = $1 AND cycle = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Vụ mùa đã có nhật ký canh tác nên không thể thay đổi hoặc xóa".into());
            }
        }
    }
    if action == "harvested" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM agriculture__harvest WHERE tenant_id = $1 AND cycle = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &id],
            ).await?.is_none() {
                errors.push("Chỉ kết thúc vụ mùa sau khi ghi nhận ít nhất một lần thu hoạch".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_harvest(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(cycle) = parse_id(document, "cycle") else {
        return Ok(vec!["Phiếu thu hoạch cần vụ mùa hợp lệ".into()]);
    };
    let Some(product) = parse_id(document, "product") else {
        return Ok(vec!["Phiếu thu hoạch cần sản phẩm nhập kho hợp lệ".into()]);
    };
    let Some(warehouse) = parse_id(document, "warehouse") else {
        return Ok(vec!["Phiếu thu hoạch cần kho nhận hàng hợp lệ".into()]);
    };
    let Some(date) = document.get("date").and_then(Value::as_str) else {
        return Ok(vec!["Phiếu thu hoạch cần ngày thu hoạch hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT status, planted_on::text, current_date::text FROM agriculture__crop_cycle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &cycle],
    ).await? else {
        return Ok(vec!["Vụ mùa không tồn tại trong doanh nghiệp".into()]);
    };
    let status: String = row.get(0);
    let planted: Option<String> = row.get(1);
    let today: String = row.get(2);
    let mut errors = Vec::new();
    if status != "growing" {
        errors.push("Chỉ vụ mùa đang canh tác mới nhận thu hoạch".into());
    }
    if planted.as_deref().is_some_and(|planted| date < planted) {
        errors.push("Ngày thu hoạch không thể trước ngày gieo trồng".into());
    }
    if date > today.as_str() {
        errors.push("Không thể ghi nhận nhập kho thu hoạch trước ngày thu hoạch thực tế".into());
    }
    if let Some(row) = tx
        .query_opt(
            "SELECT ia.date + ceil(COALESCE(ia.preharvest_interval_days, p.preharvest_interval_days, 0))::int AS harvest_allowed_on, p.name FROM agriculture__input_application ia JOIN master_data__product p ON p.tenant_id = ia.tenant_id AND p.id = ia.product WHERE ia.tenant_id = $1 AND ia.cycle = $2 AND ia.kind = 'pesticide' AND ia.date + ceil(COALESCE(ia.preharvest_interval_days, p.preharvest_interval_days, 0))::int > $3::date ORDER BY harvest_allowed_on DESC LIMIT 1",
            &[&tenant.id, &cycle, &date],
        )
        .await?
    {
        let allowed_on: String = row.get(0);
        let product_name: String = row.get(1);
        errors.push(format!(
            "Chưa thể thu hoạch: thời gian cách ly sau khi phun {product_name} kết thúc vào ngày {allowed_on}"
        ));
    }
    if tx
        .query_opt(
            "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product],
        )
        .await?
        .is_none()
    {
        errors.push("Sản phẩm thu hoạch không tồn tại trong doanh nghiệp".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &warehouse],
        )
        .await?
        .is_none()
    {
        errors.push("Kho nhận thu hoạch không tồn tại trong doanh nghiệp".into());
    }
    if let Some(code) = document
        .get("lot_code")
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
    {
        let id = parse_id(document, "id");
        if tx.query_opt(
            "SELECT id FROM agriculture__harvest WHERE tenant_id = $1 AND lower(btrim(lot_code)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &code, &id],
        ).await?.is_some() {
            errors.push("Mã lô thu hoạch đã tồn tại trong doanh nghiệp".into());
        }
    }
    Ok(errors)
}

async fn validate_input(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(cycle) = parse_id(document, "cycle") else {
        return Ok(vec!["Phiếu vật tư cần vụ mùa hợp lệ".into()]);
    };
    let Some(date) = document.get("date").and_then(Value::as_str) else {
        return Ok(vec!["Phiếu vật tư cần ngày sử dụng hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT status, planted_on::text, current_date::text FROM agriculture__crop_cycle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &cycle],
    ).await? else {
        return Ok(vec!["Vụ mùa không tồn tại trong doanh nghiệp".into()]);
    };
    let status: String = row.get(0);
    let planted: Option<String> = row.get(1);
    let today: String = row.get(2);
    let mut errors = Vec::new();
    if status != "growing" {
        errors.push("Chỉ vụ mùa đang canh tác mới ghi nhận sử dụng vật tư".into());
    }
    if planted.as_deref().is_some_and(|planted| date < planted) {
        errors.push("Ngày sử dụng vật tư không thể trước ngày gieo trồng".into());
    }
    if date > today.as_str() {
        errors.push("Không thể ghi nhận sử dụng vật tư trước ngày thực tế phát sinh".into());
    }
    if let Some(product) = parse_id(document, "product") {
        if tx
            .query_opt(
                "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product],
            )
            .await?
            .is_none()
        {
            errors.push("Sản phẩm vật tư không tồn tại trong doanh nghiệp".into());
        }
        let Some(warehouse) = parse_id(document, "warehouse") else {
            return Ok(vec!["Vật tư xuất kho cần kho sử dụng hợp lệ".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            errors.push("Kho sử dụng vật tư không tồn tại trong doanh nghiệp".into());
        }
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
