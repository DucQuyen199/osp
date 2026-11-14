use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    doc: &Value,
) -> R<Vec<String>> {
    if entity != "prescription" {
        return Ok(Vec::new());
    }
    let party = id(doc, "party");
    let mut errors = Vec::new();
    if let Some(party) = party {
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            errors.push("Khách hàng không tồn tại trong doanh nghiệp".into());
        }
    } else {
        errors.push("Đơn thuốc cần khách hàng hợp lệ".into());
    }
    let mut items_by_id = Vec::new();
    if let Some(items) = doc.get("items").and_then(Value::as_array) {
        for item in items {
            let Some(pid) = item
                .get("product")
                .and_then(Value::as_str)
                .and_then(|v| Uuid::parse_str(v).ok())
            else {
                errors.push("Mã sản phẩm trong đơn thuốc không hợp lệ".into());
                continue;
            };
            let row = tx.query_opt("SELECT custom, active FROM master_data__product WHERE tenant_id=$1 AND id=$2 FOR SHARE", &[&tenant.id, &pid]).await?;
            if let Some(row) = row {
                let custom: Value = row.get(0);
                let active: bool = row.get(1);
                let requires_prescription = custom
                    .get("requires_prescription")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if requires_prescription {
                    items_by_id.push(pid);
                } else if action == "verified" {
                    errors.push("Mọi thuốc trong đơn cần được đánh dấu là thuốc kê đơn".into());
                }
                if action == "verified" && !active {
                    errors.push("Không thể xác minh đơn có sản phẩm đã ngừng kinh doanh".into());
                }
            } else {
                errors.push("Sản phẩm trong đơn thuốc không tồn tại".into());
            }
        }
    }
    if action == "verified" && items_by_id.is_empty() {
        errors.push("Đơn thuốc phải có ít nhất một thuốc được đánh dấu cần đơn".into());
    }
    if action == "verified" {
        let no = doc
            .get("prescription_no")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended('pharmacy:prescription_no:' || $1::text || ':' || lower(btrim($2)), 0))",
            &[&tenant.id, &no],
        ).await?;
        let current = id(doc, "id");
        if tx.query_opt("SELECT id FROM pharmacy__prescription WHERE tenant_id=$1 AND lower(prescription_no)=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1 FOR UPDATE", &[&tenant.id, &no, &current]).await?.is_some() { errors.push("Số đơn thuốc đã được ghi nhận".into()); }
        if doc
            .get("valid_until")
            .and_then(Value::as_str)
            .is_some_and(|date| date < chrono::Utc::now().date_naive().to_string().as_str())
        {
            errors.push("Không thể xác minh đơn thuốc đã hết hạn".into());
        }
    }
    errors.extend(super::application::validate_dispense(tx, tenant, action, doc).await?);
    Ok(errors)
}
fn id(doc: &Value, field: &str) -> Option<Uuid> {
    doc.get(field)
        .and_then(Value::as_str)
        .and_then(|v| Uuid::parse_str(v).ok())
}
