//! Transactional guards for partial release of inventory held by inspection.
use super::super::domain::{id, number};
use super::{decimal_column, optional_decimal_column};
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if action != "posted" {
        return Ok(Vec::new());
    }
    let (Some(inspection_id), Some(qty)) = (id(document, "inspection"), number(document, "qty"))
    else {
        return Ok(vec!["Phiếu xử lý cần phiếu QC và số lượng hợp lệ".into()]);
    };
    let inspection = tx
        .query_opt(
            "SELECT product, source, qty::text, warehouse, status FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &inspection_id],
        )
        .await?;
    let Some(inspection) = inspection else {
        return Ok(vec!["Không tìm thấy phiếu QC trong doanh nghiệp".into()]);
    };
    let product: uuid::Uuid = inspection.get(0);
    let source: String = inspection.get(1);
    let inspected_qty = decimal_column(&inspection, 2, "inspected quantity")?;
    let warehouse: uuid::Uuid = inspection.get(3);
    let mut errors = Vec::new();
    if !matches!(source.as_str(), "purchase_order" | "purchase_receipt") {
        errors.push("Xử lý từng phần chỉ áp dụng cho hàng mua đang được giữ QC".into());
        return Ok(errors);
    }
    let status: String = inspection.get(4);
    if status != "pending" {
        errors.push("Chỉ có thể giải phóng một phần phiếu QC đang chờ quyết định".into());
    }
    let already_released = tx
        .query_opt(
            "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
            &[&tenant.id, &inspection_id],
        )
        .await?;
    let already_released = already_released
        .map(|row| decimal_column(&row, 0, "released quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let already_returned = tx
        .query_opt(
            "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'quality_return' AND source_id = $2 AND direction = 'out'",
            &[&tenant.id, &inspection_id.to_string()],
        )
        .await?;
    let already_returned = already_returned
        .map(|row| decimal_column(&row, 0, "returned quantity"))
        .transpose()?
        .unwrap_or(Decimal::ZERO);
    let accounted = already_released
        .checked_add(already_returned)
        .and_then(|value| value.checked_add(qty));
    if qty <= Decimal::ZERO
        || accounted.is_none_or(|value| value > inspected_qty + Decimal::new(1, 6))
    {
        errors.push("Tổng lượng giải phóng và đã trả không được vượt lượng kiểm tra".into());
    }
    let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    let held = tx
        .query_opt(
            "SELECT held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
            &[&tenant.id, &product, &warehouse],
        )
        .await?;
    let held = held
        .map(|row| optional_decimal_column(&row, 0, "held quantity"))
        .transpose()?;
    if !held.is_some_and(|held| {
        held.checked_add(Decimal::new(1, 6))
            .is_some_and(|available| available >= qty)
    }) {
        errors.push("Tồn đang giữ QC không đủ để giải phóng số lượng yêu cầu".into());
    }
    Ok(errors)
}
