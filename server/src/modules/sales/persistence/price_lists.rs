//! Tenant-local product references and safe price-list removal.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "price_list" && action == "removed" {
        let Some(price_list_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Không xác định được bảng giá cần xóa".into()]);
        };
        let referenced = tx.query_opt(
            "SELECT 1 FROM sales__quotation WHERE tenant_id = $1 AND price_list = $2 UNION ALL SELECT 1 FROM sales__sales_order WHERE tenant_id = $1 AND price_list = $2 LIMIT 1",
            &[&tenant.id, &price_list_id],
        ).await?.is_some();
        if referenced {
            return Ok(vec![
                "Không thể xóa bảng giá đã được báo giá/đơn bán tham chiếu".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "price_list" && matches!(action, "created" | "updated") {
        let mut errors = Vec::new();
        if let Some(items) = document.get("items").and_then(Value::as_array) {
            for (index, item) in items.iter().enumerate() {
                let Some(product) = item
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    continue;
                };
                if tx.query_opt(
                    "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product],
                ).await?.is_none() {
                    errors.push(format!("Sản phẩm ở dòng {} không tồn tại trong doanh nghiệp", index + 1));
                }
            }
        }
        return Ok(errors);
    }
    Ok(Vec::new())
}
