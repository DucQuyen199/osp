mod receipts;
mod returns;
mod rfqs;

use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) fn purchasing_quantity_error() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "purchasing.quantity",
        vec!["Purchase quantity exceeds the supported decimal range".into()],
    )
}

pub(super) fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "purchasing.persistence",
            vec![format!(
                "Stored purchasing {field} is not a valid decimal amount"
            )],
        )
    })
}

/// When the shared approval module is enabled, verify that the linked request
/// has reached approved before allowing the purchasing document to advance.
pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "rfq" {
        return rfqs::validate(tx, tenant, action, document).await;
    }
    if entity == "purchase_receipt" && action == "received" {
        return receipts::validate_receipt_received(tx, tenant, document).await;
    }
    if entity == "purchase_order" && matches!(action, "partially_received" | "received") {
        let errors = receipts::validate_receipt_progress(tx, tenant, action, document).await?;
        if !errors.is_empty() {
            return Ok(errors);
        }
    }
    if entity == "purchase_order"
        && action == "cancelled"
        && tenant.has_module("workflow-approval")
        && let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    {
        let pending = tx
            .query_opt(
                "SELECT id FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'purchasing.purchase_order' AND record_id = $2 AND status = 'pending' LIMIT 1",
                &[&tenant.id, &id.to_string()],
            )
            .await?
            .is_some();
        if pending {
            return Ok(vec![
                "Purchase order cannot be cancelled while its shared approval request is pending; resolve the request first".into(),
            ]);
        }
    }
    if tenant.has_module("workflow-approval")
        && matches!(entity, "purchase_order" | "purchase_requisition")
        && action == "rejected"
    {
        let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Cannot identify the purchasing document being rejected".into(),
            ]);
        };
        let qname = format!("purchasing.{entity}");
        let rejected = tx
            .query_opt(
                "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = $2 AND record_id = $3 AND status = 'rejected' LIMIT 1",
                &[&tenant.id, &qname, &id.to_string()],
            )
            .await?
            .is_some();
        if !rejected {
            return Ok(vec![
                "Reject purchasing documents through their shared approval request".into(),
            ]);
        }
    }
    if (entity == "purchase_order" && matches!(action, "submitted" | "approved" | "received"))
        || (entity == "purchase_requisition"
            && matches!(action, "submitted" | "approved")
            && document.get("sourcing_method").and_then(Value::as_str) != Some("competitive"))
        || (entity == "rfq" && matches!(action, "sent" | "quoted" | "accepted"))
    {
        let Some(supplier_id) = document
            .get("supplier")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Chứng từ mua hàng cần nhà cung cấp hợp lệ".into()]);
        };
        let supplier = tx
            .query_opt(
                "SELECT is_supplier FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &supplier_id],
            )
            .await?;
        let Some(supplier) = supplier else {
            return Ok(vec![
                "Không tìm thấy nhà cung cấp trong doanh nghiệp".into(),
            ]);
        };
        if supplier.get::<_, Option<bool>>(0) == Some(false) {
            return Ok(vec!["Đối tác chưa được đánh dấu là nhà cung cấp".into()]);
        }
    }
    if entity == "purchase_requisition" && matches!(action, "submitted" | "approved") {
        let warehouse_id = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(warehouse_id) = warehouse_id else {
            return Ok(vec![
                "C\u{1ea7}n kho h\u{1ee3}p l\u{1ec7} tr\u{01b0}\u{1edb}c khi duy\u{1ec7}t \u{0111}\u{1ec1} ngh\u{1ecb} mua".into(),
            ]);
        };
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &warehouse_id],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Kho kh\u{00f4}ng t\u{1ed3}n t\u{1ea1}i trong doanh nghi\u{1ec7}p".into(),
            ]);
        }
    }
    if entity == "purchase_requisition" && matches!(action, "submitted" | "approved") {
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            let mut errors = Vec::new();
            for (index, line) in lines.iter().enumerate() {
                let product_id = line
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok());
                let Some(product_id) = product_id else {
                    errors.push(format!(
                        "lines[{}].product must be a valid product reference",
                        index + 1
                    ));
                    continue;
                };
                let product = tx.query_opt(
                    "SELECT active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &product_id],
                ).await?;
                match product {
                    None => errors.push(format!(
                        "Product on line {} does not exist in this tenant",
                        index + 1
                    )),
                    Some(row) if row.get::<_, Option<bool>>(0) == Some(false) => {
                        errors.push(format!("Product on line {} is inactive", index + 1));
                    }
                    Some(_) => {}
                }
            }
            if !errors.is_empty() {
                return Ok(errors);
            }
        }
    }
    if entity == "purchase_return" && matches!(action, "submitted" | "approved" | "dispatched") {
        return returns::validate_return_persistence(tx, tenant, action, document).await;
    }
    if !tenant.has_module("workflow-approval")
        || !matches!(
            (entity, action),
            ("purchase_order" | "purchase_requisition", "approved")
        )
    {
        return Ok(Vec::new());
    }
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| uuid::Uuid::parse_str(value).ok());
    let Some(id) = id else {
        return Ok(vec!["Không xác định được chứng từ mua cần duyệt".into()]);
    };
    let qname = format!("purchasing.{entity}");
    let approved = tx
        .query_opt(
            "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = $2 AND record_id = $3 AND status = 'approved' LIMIT 1",
            &[&tenant.id, &qname, &id.to_string()],
        )
        .await?
        .is_some();
    if approved {
        Ok(Vec::new())
    } else {
        Ok(vec![
            "Chứng từ chỉ có thể được duyệt sau khi yêu cầu phê duyệt chung đã được chấp thuận"
                .into(),
        ])
    }
}
