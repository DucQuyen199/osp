//! Tenant-scoped ecommerce reference checks.
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
        "storefront" => validate_storefront(tx, tenant, action, document).await,
        "web_order" => validate_web_order(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_storefront(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    for (field, table, label) in [
        ("warehouse", "inventory__warehouse", "Kho xử lý"),
        ("price_list", "sales__price_list", "Bảng giá"),
        ("tax", "master_data__tax", "Thuế bán hàng"),
    ] {
        let Some(value) = document.get(field).filter(|value| !value.is_null()) else {
            continue;
        };
        let Some(id) = value.as_str().and_then(|value| Uuid::parse_str(value).ok()) else {
            errors.push(format!("{label} phải là mã hợp lệ"));
            continue;
        };
        let sql = format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR SHARE");
        if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_none() {
            errors.push(format!("{label} không tồn tại trong doanh nghiệp"));
        }
    }
    if let Some(domain) = document
        .get("domain")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|domain| !domain.is_empty())
    {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if tx
            .query_opt(
                "SELECT id FROM ecommerce__storefront WHERE tenant_id = $1 AND lower(btrim(domain)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &domain, &id],
            )
            .await?
            .is_some()
        {
            errors.push("Tên miền đã được gán cho gian hàng khác trong doanh nghiệp".into());
        }
    }
    if action == "removed" {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if let Some(id) = id {
            if tx
                .query_opt(
                    "SELECT id FROM ecommerce__web_order WHERE tenant_id = $1 AND storefront = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                errors.push("Gian hàng có đơn online liên kết nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_web_order(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    for (field, table, label) in [
        ("party", "master_data__party", "Khách hàng"),
        ("storefront", "ecommerce__storefront", "Gian hàng"),
    ] {
        let Some(id) = document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            errors.push(format!("{label} phải là mã hợp lệ"));
            continue;
        };
        let sql = format!("SELECT id FROM {table} WHERE tenant_id = $1 AND id = $2 FOR SHARE");
        if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_none() {
            errors.push(format!("{label} không tồn tại trong doanh nghiệp"));
        }
    }
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        for (index, line) in lines.iter().enumerate() {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let active = tx
                .query_opt(
                    "SELECT active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product],
                )
                .await?;
            match active {
                Some(row) if row.get::<_, Option<bool>>(0) != Some(false) => {}
                Some(_) => errors.push(format!("Sản phẩm dòng {} đã ngừng hoạt động", index + 1)),
                None => errors.push(format!(
                    "Sản phẩm dòng {} không tồn tại trong doanh nghiệp",
                    index + 1
                )),
            }
        }
    }
    Ok(errors)
}
