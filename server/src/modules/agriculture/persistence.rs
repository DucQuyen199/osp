//! Tenant ownership, crop-cycle locks, and stock destination validation.
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
        "SELECT status, planted_on::text, expected_harvest::text FROM agriculture__crop_cycle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &cycle],
    ).await? else {
        return Ok(vec!["Vụ mùa không tồn tại trong doanh nghiệp".into()]);
    };
    let status: String = row.get(0);
    let planted: Option<String> = row.get(1);
    let expected: Option<String> = row.get(2);
    let mut errors = Vec::new();
    if status != "growing" {
        errors.push("Chỉ vụ mùa đang canh tác mới nhận thu hoạch".into());
    }
    if planted.as_deref().is_some_and(|planted| date < planted)
        || expected.as_deref().is_some_and(|expected| date > expected)
    {
        errors.push("Ngày thu hoạch nằm ngoài khoảng thời gian của vụ mùa".into());
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
        "SELECT status, planted_on::text, expected_harvest::text FROM agriculture__crop_cycle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &cycle],
    ).await? else {
        return Ok(vec!["Vụ mùa không tồn tại trong doanh nghiệp".into()]);
    };
    let status: String = row.get(0);
    let planted: Option<String> = row.get(1);
    let expected: Option<String> = row.get(2);
    let mut errors = Vec::new();
    if status != "growing" {
        errors.push("Chỉ vụ mùa đang canh tác mới ghi nhận sử dụng vật tư".into());
    }
    if planted.as_deref().is_some_and(|planted| date < planted)
        || expected.as_deref().is_some_and(|expected| date > expected)
    {
        errors.push("Ngày sử dụng vật tư nằm ngoài thời gian của vụ mùa".into());
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
