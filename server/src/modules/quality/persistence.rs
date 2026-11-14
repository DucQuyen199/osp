//! Tenant-scoped quality release, hold, and traceability checks.
mod inspection_disposition;

use super::domain::{id, number};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "quality.persistence",
            vec![format!(
                "Stored quality {field} is not a valid decimal amount"
            )],
        )
    })
}

fn optional_decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "quality.persistence",
                    vec![format!(
                        "Stored quality {field} is not a valid decimal amount"
                    )],
                )
            })
        })
        .transpose()
        .map(|value| value.unwrap_or(Decimal::ZERO))
}

fn matches_purchase_line(
    line: &Value,
    product: Uuid,
    qty: Decimal,
    unit_cost: Decimal,
    lot: Option<Uuid>,
) -> bool {
    line.get("product").and_then(Value::as_str) == Some(product.to_string().as_str())
        && line
            .get("qty")
            .and_then(money::decimal)
            .is_some_and(|line_qty| money::within_tolerance(line_qty, qty, Decimal::new(1, 6)))
        && line
            .get("price")
            .and_then(money::decimal)
            .is_some_and(|price| money::within_tolerance(price, unit_cost, Decimal::new(5, 3)))
        && line.get("lot").and_then(Value::as_str) == lot.map(|id| id.to_string()).as_deref()
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    if entity == "inspection_disposition" {
        return inspection_disposition::validate(tx, tenant, action, document).await;
    }
    if entity != "inspection" {
        return Ok(errors);
    }
    let source = document.get("source").and_then(Value::as_str);
    let source_id = id(document, "source_id");
    let product = id(document, "product");
    if matches!(action, "created" | "passed")
        && matches!(
            source,
            Some("production_order" | "purchase_order" | "purchase_receipt")
        )
    {
        let (Some(order_id), Some(product)) = (source_id, product) else {
            return Ok(vec![
                "Phiếu QC cần chứng từ nguồn và sản phẩm hợp lệ".into(),
            ]);
        };
        let (Some(qty), Some(warehouse)) = (number(document, "qty"), id(document, "warehouse"))
        else {
            return Ok(vec!["Phiếu QC cần số lượng và kho hợp lệ".into()]);
        };
        if source == Some("production_order") {
            let order = tx.query_opt(
                "SELECT po.product, COALESCE(po.good_qty, po.qty)::text, po.warehouse, po.status, COALESCE(product.lot_tracked, false), po.output_lot_code FROM manufacturing__production_order po JOIN master_data__product product ON product.tenant_id = po.tenant_id AND product.id = po.product WHERE po.tenant_id = $1 AND po.id = $2 FOR UPDATE OF po",
                &[&tenant.id, &order_id],
            ).await?;
            if action == "passed" {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
            }
            let valid = if let Some(row) = &order {
                row.get::<_, Uuid>(0) == product
                    && money::within_tolerance(
                        decimal_column(&row, 1, "production quantity")?,
                        qty,
                        Decimal::new(1, 6),
                    )
                    && row.get::<_, Uuid>(2) == warehouse
                    && row.get::<_, String>(3) == "done"
            } else {
                false
            };
            if !valid {
                errors.push(
                    "Phiếu QC phải khớp thành phẩm, số lượng, kho và lệnh sản xuất đã hoàn tất"
                        .into(),
                );
            }
            if let Some(order) = &order
                && order.get::<_, bool>(4)
            {
                let expected_code: Option<String> = order.get(5);
                let lot = id(document, "lot");
                let lot_matches = if let (Some(lot), Some(expected_code)) = (lot, expected_code) {
                    tx.query_opt(
                        "SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 AND code = $4 FOR SHARE",
                        &[&tenant.id, &lot, &product, &expected_code],
                    )
                    .await?
                    .is_some()
                } else {
                    false
                };
                if !lot_matches {
                    errors.push("QC thành phẩm phải giữ đúng lô đầu ra của lệnh sản xuất".into());
                }
            }
            if action == "created" && tx.query_opt(
                "SELECT id FROM quality__inspection WHERE tenant_id = $1 AND source = 'production_order' AND source_id = $2 LIMIT 1",
                &[&tenant.id, &order_id.to_string()],
            ).await?.is_some() {
                errors.push("Lệnh sản xuất đã có phiếu QC thành phẩm".into());
            }
            if action == "passed" && tx.query_opt(
                "SELECT id FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'production_order' AND source_id = $2 AND direction = 'in' LIMIT 1",
                &[&tenant.id, &order_id.to_string()],
            ).await?.is_some() {
                errors.push("Thành phẩm của lệnh này đã được QC duyệt và nhập kho".into());
            }
        } else if source == Some("purchase_order") {
            let Some(unit_cost) = number(document, "unit_cost") else {
                return Ok(vec!["Phiếu QC hàng mua cần đơn giá hợp lệ".into()]);
            };
            let lot = id(document, "lot");
            let order = tx.query_opt(
                "SELECT warehouse, lines, status FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &order_id],
            ).await?;
            let Some(order) = order else {
                errors.push("Không tìm thấy đơn mua hàng trong doanh nghiệp".into());
                return Ok(errors);
            };
            if action == "passed" {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
            }
            if let Some(lot_id) = lot {
                if tx.query_opt(
                    "SELECT id FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 FOR SHARE",
                    &[&tenant.id, &lot_id, &product],
                ).await?.is_none() {
                    errors.push("Lô hàng QC phải thuộc sản phẩm trong đơn mua và tenant".into());
                }
            }
            let order_warehouse: Option<Uuid> = order.get(0);
            let lines: Value = order.get(1);
            let status: String = order.get(2);
            let matching_line_count = lines
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter(|line| matches_purchase_line(line, product, qty, unit_cost, lot))
                        .count()
                })
                .unwrap_or_default();
            let matching_line = lines.as_array().is_some_and(|rows| {
                rows.iter()
                    .any(|line| matches_purchase_line(line, product, qty, unit_cost, lot))
            });
            if status != "received" || order_warehouse != Some(warehouse) || !matching_line {
                errors.push("Phiếu QC phải khớp một dòng của đơn mua đã nhận, gồm sản phẩm, số lượng, kho và giá".into());
            }
            if action == "created" {
                let qty_text = qty.normalize().to_string();
                let unit_cost_text = unit_cost.normalize().to_string();
                let already_inspected: i64 = tx.query_opt(
                    "SELECT COUNT(*)::bigint FROM quality__inspection WHERE tenant_id = $1 AND source = 'purchase_order' AND source_id = $2 AND product = $3 AND abs(qty::numeric - $4::text::numeric) <= 0.000001 AND abs(COALESCE(unit_cost, 0)::numeric - $5::text::numeric) <= 0.005 AND lot IS NOT DISTINCT FROM $6",
                    &[&tenant.id, &order_id.to_string(), &product, &qty_text, &unit_cost_text, &lot],
                ).await?.map(|row| row.get(0)).unwrap_or_default();
                if already_inspected as usize >= matching_line_count {
                    errors.push("Dòng mua này đã có đủ phiếu QC; không thể tạo phiếu trùng".into());
                }
            }
            if action == "passed" {
                let released = tx.query_opt(
                    "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                    &[&tenant.id, &Uuid::parse_str(document.get("id").and_then(Value::as_str).unwrap_or_default()).unwrap_or_default()],
                ).await?;
                let released = released
                    .map(|row| decimal_column(&row, 0, "released quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                let remaining_qty = qty
                    .checked_sub(released)
                    .unwrap_or(Decimal::ZERO)
                    .max(Decimal::ZERO);
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let held = tx.query_opt(
                    "SELECT held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
                    &[&tenant.id, &product, &warehouse],
                ).await?;
                let held = held
                    .map(|row| optional_decimal_column(&row, 0, "held quantity"))
                    .transpose()?;
                if !held.is_some_and(|held| {
                    held.checked_add(Decimal::new(1, 6))
                        .is_some_and(|available| available >= remaining_qty)
                }) {
                    errors
                        .push("Không còn đủ số lượng hàng đang bị giữ để giải phóng sau QC".into());
                }
                if let Some(lot) = lot {
                    let lot_held = tx
                        .query_opt(
                            "SELECT COALESCE(SUM(GREATEST(qi.qty::numeric - COALESCE(d.released_qty, 0) - COALESCE(r.returned_qty, 0), 0::numeric)), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS released_qty FROM quality__inspection_disposition WHERE tenant_id = qi.tenant_id AND inspection = qi.id AND status = 'posted') d ON TRUE LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS returned_qty FROM inventory__stock_move WHERE tenant_id = qi.tenant_id AND source = 'quality_return' AND source_id = qi.id::text AND direction = 'out') r ON TRUE WHERE qi.tenant_id = $1 AND qi.source = 'purchase_order' AND qi.source_id = $2 AND qi.product = $3 AND qi.warehouse = $4 AND qi.lot = $5 AND qi.status IN ('pending', 'failed')",
                            &[&tenant.id, &order_id.to_string(), &product, &warehouse, &lot],
                        )
                        .await?;
                    let lot_held = lot_held
                        .map(|row| decimal_column(&row, 0, "lot held quantity"))
                        .transpose()?
                        .unwrap_or(Decimal::ZERO);
                    if lot_held
                        .checked_add(Decimal::new(1, 6))
                        .is_none_or(|available| available < qty)
                    {
                        errors.push("Không còn đủ số lượng lô đang chờ QC để giải phóng".into());
                    }
                }
            }
        } else {
            let Some(unit_cost) = number(document, "unit_cost") else {
                return Ok(vec!["Phiếu QC hàng mua cần đơn giá hợp lệ".into()]);
            };
            let lot = id(document, "lot");
            let Some(receipt_id) = source_id else {
                return Ok(vec!["Phiếu QC cần mã phiếu nhận hàng hợp lệ".into()]);
            };
            let receipt = tx.query_opt(
                "SELECT warehouse, lines, status FROM purchasing__purchase_receipt WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &receipt_id],
            ).await?;
            let Some(receipt) = receipt else {
                errors.push("Không tìm thấy phiếu nhận hàng trong doanh nghiệp".into());
                return Ok(errors);
            };
            if action == "passed" {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
            }
            if let Some(lot_id) = lot {
                if tx.query_opt(
                    "SELECT id FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 FOR SHARE",
                    &[&tenant.id, &lot_id, &product],
                ).await?.is_none() {
                    errors.push("Lô hàng QC phải thuộc sản phẩm trong tenant".into());
                }
            }
            let receipt_warehouse: Option<Uuid> = receipt.get(0);
            let lines: Value = receipt.get(1);
            let status: String = receipt.get(2);
            let matching_line_count = lines
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter(|line| matches_purchase_line(line, product, qty, unit_cost, lot))
                        .count()
                })
                .unwrap_or_default();
            let matching_line = lines.as_array().is_some_and(|rows| {
                rows.iter()
                    .any(|line| matches_purchase_line(line, product, qty, unit_cost, lot))
            });
            if status != "received" || receipt_warehouse != Some(warehouse) || !matching_line {
                errors.push("Phiếu QC phải khớp dòng của phiếu nhận đã ghi sổ, gồm sản phẩm, số lượng, kho và giá".into());
            }
            if action == "created" {
                let qty_text = qty.normalize().to_string();
                let unit_cost_text = unit_cost.normalize().to_string();
                let already_inspected: i64 = tx.query_opt(
                    "SELECT COUNT(*)::bigint FROM quality__inspection WHERE tenant_id = $1 AND source = 'purchase_receipt' AND source_id = $2 AND product = $3 AND abs(qty::numeric - $4::text::numeric) <= 0.000001 AND abs(COALESCE(unit_cost, 0)::numeric - $5::text::numeric) <= 0.005 AND lot IS NOT DISTINCT FROM $6",
                    &[&tenant.id, &receipt_id.to_string(), &product, &qty_text, &unit_cost_text, &lot],
                ).await?.map(|row| row.get(0)).unwrap_or_default();
                if already_inspected as usize >= matching_line_count {
                    errors
                        .push("Dòng nhận này đã có đủ phiếu QC; không thể tạo phiếu trùng".into());
                }
            }
            if action == "passed" {
                let released = tx.query_opt(
                    "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                    &[&tenant.id, &Uuid::parse_str(document.get("id").and_then(Value::as_str).unwrap_or_default()).unwrap_or_default()],
                ).await?;
                let released = released
                    .map(|row| decimal_column(&row, 0, "released quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                let remaining_qty = qty
                    .checked_sub(released)
                    .unwrap_or(Decimal::ZERO)
                    .max(Decimal::ZERO);
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let held = tx.query_opt(
                    "SELECT held_qty::text FROM inventory__stock_level WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 FOR UPDATE",
                    &[&tenant.id, &product, &warehouse],
                ).await?;
                let held = held
                    .map(|row| optional_decimal_column(&row, 0, "held quantity"))
                    .transpose()?;
                if !held.is_some_and(|held| {
                    held.checked_add(Decimal::new(1, 6))
                        .is_some_and(|available| available >= remaining_qty)
                }) {
                    errors.push("Không còn đủ hàng đang giữ để giải phóng sau QC".into());
                }
                if let Some(lot) = lot {
                    let lot_held = tx.query_opt(
                        "SELECT COALESCE(SUM(GREATEST(qi.qty::numeric - COALESCE(d.released_qty, 0) - COALESCE(r.returned_qty, 0), 0::numeric)), 0)::text FROM quality__inspection qi LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS released_qty FROM quality__inspection_disposition WHERE tenant_id = qi.tenant_id AND inspection = qi.id AND status = 'posted') d ON TRUE LEFT JOIN LATERAL (SELECT SUM(qty::numeric) AS returned_qty FROM inventory__stock_move WHERE tenant_id = qi.tenant_id AND source = 'quality_return' AND source_id = qi.id::text AND direction = 'out') r ON TRUE WHERE qi.tenant_id = $1 AND qi.source = 'purchase_receipt' AND qi.source_id = $2 AND qi.product = $3 AND qi.warehouse = $4 AND qi.lot = $5 AND qi.status IN ('pending', 'failed')",
                        &[&tenant.id, &receipt_id.to_string(), &product, &warehouse, &lot],
                    ).await?;
                    let lot_held = lot_held
                        .map(|row| decimal_column(&row, 0, "lot held quantity"))
                        .transpose()?
                        .unwrap_or(Decimal::ZERO);
                    if lot_held
                        .checked_add(Decimal::new(1, 6))
                        .is_none_or(|available| available < qty)
                    {
                        errors.push("Không còn đủ số lượng lô đang chờ QC để giải phóng".into());
                    }
                }
            }
        }
    }
    if action == "retest" && matches!(source, Some("purchase_order" | "purchase_receipt")) {
        if let Some(inspection_id) = id(document, "id") {
            if tx.query_opt(
                "SELECT id FROM purchasing__purchase_return WHERE tenant_id = $1 AND inspection = $2 AND status IN ('submitted', 'approved', 'dispatched') LIMIT 1",
                &[&tenant.id, &inspection_id],
            ).await?.is_some() {
                errors.push("Không gửi kiểm tra lại khi hàng đã có phiếu trả nhà cung cấp".into());
            }
        }
    }
    Ok(errors)
}
