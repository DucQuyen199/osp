mod receipts;
mod returns;
mod rfqs;
mod supplier_invoices;

use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
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
    if entity == "purchase_requisition"
        && matches!(action, "created" | "updated" | "submitted" | "approved")
        && document.get("source").and_then(Value::as_str) == Some("construction_material_request")
    {
        let errors = validate_construction_requisition_lines(tx, tenant, action, document).await?;
        if !errors.is_empty() {
            return Ok(errors);
        }
    }
    if entity == "purchase_requisition" && action == "created" {
        let source = document.get("source").and_then(Value::as_str);
        let source_id = document.get("source_id").and_then(Value::as_str);
        match (source, source_id) {
            (None, None) => {}
            (Some("construction_material_request"), Some(source_id)) => {
                let Some(source_id) = Uuid::parse_str(source_id).ok() else {
                    return Ok(vec!["Mã yêu cầu vật tư xây dựng không hợp lệ".into()]);
                };
                let source_request = tx
                    .query_opt(
                        "SELECT warehouse FROM construction__material_request WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                        &[&tenant.id, &source_id],
                    )
                    .await?;
                let Some(source_request) = source_request else {
                    return Ok(vec![
                        "Yêu cầu vật tư xây dựng không tồn tại trong doanh nghiệp".into(),
                    ]);
                };
                let source_warehouse: Option<Uuid> = source_request.get(0);
                let request_warehouse = document
                    .get("warehouse")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok());
                if source_warehouse != request_warehouse {
                    return Ok(vec![
                        "Kho đề nghị mua phải khớp với yêu cầu vật tư xây dựng".into(),
                    ]);
                }
            }
            _ => return Ok(vec!["Nguồn liên kết đề nghị mua không hợp lệ".into()]),
        }
    }
    if entity == "rfq" {
        return rfqs::validate(tx, tenant, action, document).await;
    }
    if entity == "supplier_invoice" {
        return supplier_invoices::validate(tx, tenant, action, document).await;
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

async fn validate_construction_requisition_lines(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(source_id) = document
        .get("source_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Yêu cầu mua vật tư xây dựng không hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT mr.warehouse, boq.items, boq.status FROM construction__material_request mr JOIN construction__boq boq ON boq.tenant_id=mr.tenant_id AND boq.id=mr.boq WHERE mr.tenant_id=$1 AND mr.id=$2 FOR SHARE OF mr, boq",
            &[&tenant.id, &source_id],
        )
        .await?
    else {
        return Ok(vec!["Không tìm thấy BOQ nguồn của đề nghị mua vật tư".into()]);
    };
    let source_warehouse: Option<Uuid> = row.get(0);
    let source_boq_status: String = row.get(2);
    if matches!(action, "submitted" | "approved") && source_boq_status != "approved" {
        return Ok(vec![
            "Chỉ gửi duyệt đề nghị mua vật tư từ baseline BOQ hiện hành".into(),
        ]);
    }
    let request_warehouse = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if source_warehouse != request_warehouse {
        return Ok(vec![
            "Kho nhận phải khớp với yêu cầu vật tư xây dựng".into(),
        ]);
    }
    let source_items: Value = row.get(1);
    let mut allowed: HashMap<(Uuid, Uuid), Decimal> = HashMap::new();
    for item in source_items.as_array().into_iter().flatten() {
        let (Some(product), Some(uom), Some(qty)) = (
            item.get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            item.get("uom")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            item.get("qty").and_then(money::decimal),
        ) else {
            continue;
        };
        let Some(next) = allowed
            .get(&(product, uom))
            .copied()
            .unwrap_or_default()
            .checked_add(qty)
        else {
            return Ok(vec![
                "Tổng khối lượng BOQ vượt phạm vi số được hỗ trợ".into(),
            ]);
        };
        allowed.insert((product, uom), next);
    }
    let lines = document.get("lines").and_then(Value::as_array);
    let Some(lines) = lines.filter(|lines| !lines.is_empty()) else {
        return Ok(vec!["Đề nghị mua vật tư cần ít nhất một dòng hàng".into()]);
    };
    let mut requested: HashMap<(Uuid, Uuid), Decimal> = HashMap::new();
    for line in lines {
        let (Some(product), Some(uom), Some(qty)) = (
            line.get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            line.get("uom")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            line.get("qty").and_then(money::decimal),
        ) else {
            return Ok(vec![
                "Dòng đề nghị mua cần sản phẩm, đơn vị và số lượng hợp lệ".into(),
            ]);
        };
        if qty <= Decimal::ZERO {
            return Ok(vec!["Dòng đề nghị mua cần số lượng lớn hơn 0".into()]);
        }
        let key = (product, uom);
        let Some(limit) = allowed.get(&key) else {
            return Ok(vec!["Dòng đề nghị mua không thuộc BOQ đã duyệt".into()]);
        };
        let Some(next) = requested
            .get(&key)
            .copied()
            .unwrap_or_default()
            .checked_add(qty)
        else {
            return Ok(vec![
                "Tổng số lượng đề nghị mua vượt phạm vi số được hỗ trợ".into(),
            ]);
        };
        if next <= *limit {
            requested.insert(key, next);
        } else {
            return Ok(vec![
                "Số lượng đề nghị mua vượt khối lượng BOQ đã duyệt".into(),
            ]);
        }
    }
    Ok(Vec::new())
}
