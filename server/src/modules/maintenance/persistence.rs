//! Tenant-scoped maintenance consistency checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;
fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match entity {
        "maintenance_plan" if action == "due" => {
            let Some(plan_id) = id(document, "id") else {
                return Ok(vec!["Không xác định được kế hoạch bảo trì đến hạn".into()]);
            };
            let row = tx
                .query_opt(
                    "SELECT status, next_due, current_date FROM maintenance__maintenance_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &plan_id],
                )
                .await?;
            let Some(row) = row else {
                return Ok(vec![
                    "Không tìm thấy kế hoạch bảo trì trong doanh nghiệp".into(),
                ]);
            };
            let status: String = row.get(0);
            let next_due: Option<chrono::NaiveDate> = row.get(1);
            let today: chrono::NaiveDate = row.get(2);
            if status != "active" || !next_due.is_some_and(|due| due <= today) {
                errors.push("Chỉ chạy kế hoạch bảo trì đang hoạt động và đã đến hạn".into());
            }
        }
        "maintenance_request" if matches!(action, "created" | "updated" | "done" | "started") => {
            let Some(asset_id) = id(document, "asset") else {
                return Ok(vec!["Lệnh bảo trì cần tài sản hợp lệ".into()]);
            };
            let asset = tx
                .query_opt(
                    "SELECT status FROM asset__asset WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &asset_id],
                )
                .await?;
            if !asset.is_some_and(|row| row.get::<_, String>(0) == "active") {
                errors.push("Chỉ tạo hoặc xử lý bảo trì cho tài sản đang hoạt động".into());
            }

            if matches!(action, "done" | "updated") {
                if let Some(parts) = document.get("parts").and_then(Value::as_array) {
                    for part in parts {
                        if let Some(product) = part
                            .get("product")
                            .and_then(Value::as_str)
                            .and_then(|id| Uuid::parse_str(id).ok())
                        {
                            if tx.query_opt("SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &product]).await?.is_none() {
                                errors.push("Vật tư trong lệnh bảo trì không tồn tại trong doanh nghiệp".into());
                                break;
                            }
                        }
                    }
                }
                if let Some(warehouse) = id(document, "warehouse") {
                    if tx.query_opt("SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &warehouse]).await?.is_none() {
                        errors.push("Kho xuất vật tư không tồn tại trong doanh nghiệp".into());
                    }
                }
            }
            if let Some(request_id) = id(document, "id") {
                // Serialize state transitions and edits so two concurrent actions cannot
                // complete the same work order and consume its parts twice.
                tx.query_opt(
                    "SELECT id FROM maintenance__maintenance_request WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &request_id],
                ).await?;
            }
        }
        "maintenance_plan" if matches!(action, "created" | "updated") => {
            let Some(asset_id) = id(document, "asset") else {
                return Ok(vec!["Kế hoạch bảo trì cần tài sản hợp lệ".into()]);
            };
            let asset = tx
                .query_opt(
                    "SELECT status FROM asset__asset WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &asset_id],
                )
                .await?;
            if !asset.is_some_and(|row| row.get::<_, String>(0) == "active") {
                errors.push("Kế hoạch bảo trì chỉ áp dụng cho tài sản đang hoạt động".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
