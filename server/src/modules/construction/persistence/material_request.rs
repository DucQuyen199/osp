//! Tenant-scoped checks for converting an approved BOQ into a purchase request.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate_material_request(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if action != "created" {
        return Ok(Vec::new());
    }
    let Some(boq_id) = document
        .get("boq")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Yêu cầu vật tư cần BOQ hợp lệ".into()]);
    };
    let Some(boq) = tx
        .query_opt(
            "SELECT status, items FROM construction__boq WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            &[&tenant.id, &boq_id],
        )
        .await?
    else {
        return Ok(vec!["BOQ không tồn tại trong doanh nghiệp".into()]);
    };
    let status: String = boq.get(0);
    if status != "approved" {
        return Ok(vec!["Chỉ được yêu cầu vật tư từ BOQ đang duyệt".into()]);
    }
    let items: Value = boq.get(1);
    let material_lines = items
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item.get("product").and_then(Value::as_str).is_some())
        .count();
    if material_lines == 0 {
        return Ok(vec!["BOQ chưa có dòng vật tư liên kết với sản phẩm".into()]);
    }

    let warehouse_id = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(warehouse_id) = warehouse_id else {
        return Ok(vec!["Chọn kho nhận hợp lệ".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM inventory__warehouse WHERE tenant_id=$1 AND id=$2 AND active IS DISTINCT FROM false FOR SHARE",
            &[&tenant.id, &warehouse_id],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Kho nhận không tồn tại trong doanh nghiệp".into()]);
    }

    let sourcing_method = document
        .get("sourcing_method")
        .and_then(Value::as_str)
        .unwrap_or("competitive");
    let supplier_id = document
        .get("supplier")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if sourcing_method == "direct" && supplier_id.is_none() {
        return Ok(vec!["Mua trực tiếp cần chọn nhà cung cấp".into()]);
    }
    if let Some(supplier_id) = supplier_id {
        let supplier = tx
            .query_opt(
                "SELECT is_supplier FROM master_data__party WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                &[&tenant.id, &supplier_id],
            )
            .await?;
        if supplier
            .as_ref()
            .is_none_or(|row| row.get::<_, Option<bool>>(0) == Some(false))
        {
            return Ok(vec![
                "Nhà cung cấp không tồn tại hoặc chưa được đánh dấu là nhà cung cấp".into(),
            ]);
        }
    }

    // Every request locks its BOQ first. This serializes concurrent submissions for
    // the same baseline, while a cancelled requisition can be replaced deliberately.
    if tx
        .query_opt(
            "SELECT pr.id FROM purchasing__purchase_requisition pr JOIN construction__material_request mr ON pr.tenant_id=mr.tenant_id AND pr.source_id=mr.id::text WHERE pr.tenant_id=$1 AND pr.source='construction_material_request' AND mr.boq=$2 AND pr.status <> 'cancelled' LIMIT 1 FOR UPDATE OF pr",
            &[&tenant.id, &boq_id],
        )
        .await?
        .is_some()
    {
        return Ok(vec!["BOQ đã có đề nghị mua vật tư đang hoạt động".into()]);
    }
    Ok(Vec::new())
}
