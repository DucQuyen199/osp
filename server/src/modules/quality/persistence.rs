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
    if entity == "inspection"
        && action == "failed"
        && source == Some("pharmacy_return")
        && !document
            .get("note")
            .and_then(Value::as_str)
            .is_some_and(|note| (5..=500).contains(&note.trim().chars().count()))
    {
        errors.push(
            "Returned medicine failure requires a 5 to 500 character disposition note".into(),
        );
    }
    if matches!(action, "created" | "passed")
        && matches!(
            source,
            Some(
                "production_order"
                    | "production_rework"
                    | "production_concession"
                    | "purchase_order"
                    | "purchase_receipt"
            )
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
        if source == Some("production_concession") {
            let Some(acceptance_id) = id(document, "conditional_acceptance") else {
                errors.push(
                    "Phiếu QC concession cần tham chiếu đề nghị chấp nhận có điều kiện".into(),
                );
                return Ok(errors);
            };
            let acceptance = tx.query_opt(
                "SELECT ca.inspection, ca.qty::text, ca.status, qi.source, qi.rework_order, qi.product, qi.warehouse, qi.lot, po.product, COALESCE(po.good_qty, po.qty)::text, po.warehouse, po.status, po.output_lot_code, COALESCE(product.lot_tracked, false), qi.source_id FROM manufacturing__conditional_acceptance ca JOIN quality__inspection qi ON qi.tenant_id = ca.tenant_id AND qi.id = ca.inspection JOIN manufacturing__production_order po ON po.tenant_id = qi.tenant_id AND po.id::text = qi.source_id JOIN master_data__product product ON product.tenant_id = po.tenant_id AND product.id = po.product WHERE ca.tenant_id = $1 AND ca.id = $2 AND ca.status = 'approved' FOR SHARE OF ca, qi, po",
                &[&tenant.id, &acceptance_id],
            ).await?;
            let Some(acceptance) = acceptance else {
                errors.push("Chỉ đề nghị được phê duyệt mới có thể tạo phiếu QC concession".into());
                return Ok(errors);
            };
            let original_inspection: Uuid = acceptance.get(0);
            let acceptance_qty = decimal_column(&acceptance, 1, "conditional acceptance quantity")?;
            let original_source: String = acceptance.get(3);
            let original_product: Uuid = acceptance.get(5);
            let original_warehouse: Uuid = acceptance.get(6);
            let original_lot: Option<Uuid> = acceptance.get(7);
            let valid = acceptance.get::<_, String>(2) == "approved"
                && matches!(
                    original_source.as_str(),
                    "production_order" | "production_rework"
                )
                && acceptance_qty > Decimal::ZERO
                && money::within_tolerance(qty, acceptance_qty, Decimal::new(1, 6))
                && product == original_product
                && warehouse == original_warehouse
                && id(document, "source_id")
                    .is_some_and(|id| id.to_string() == order_id.to_string())
                && id(document, "lot") == original_lot
                && acceptance.get::<_, Uuid>(8) == product
                && acceptance.get::<_, Uuid>(10) == warehouse
                && acceptance.get::<_, String>(11) == "done";
            if acceptance.get::<_, String>(14) != order_id.to_string() {
                errors.push("Phiếu QC concession phải thuộc đúng lệnh của đề nghị đã duyệt".into());
            }
            if !valid {
                errors.push("Phiếu QC concession phải khớp lệnh, sản phẩm, số lượng, kho và lô của đề nghị đã duyệt".into());
            }
            if original_source == "production_rework" {
                let expected_rework: Option<String> = acceptance.get(4);
                if document.get("rework_order").and_then(Value::as_str)
                    != expected_rework.as_deref()
                {
                    errors.push("QC concession sửa hàng phải giữ liên kết lệnh sửa ban đầu".into());
                }
            }
            if acceptance.get::<_, bool>(13) {
                let expected_code: Option<String> = acceptance.get(12);
                let lot_matches = if let (Some(lot), Some(expected_code)) =
                    (id(document, "lot"), expected_code)
                {
                    tx.query_opt(
                        "SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 AND code = $4 FOR SHARE",
                        &[&tenant.id, &lot, &product, &expected_code],
                    ).await?.is_some()
                } else {
                    false
                };
                if !lot_matches {
                    errors.push("QC concession phải giữ đúng lô đầu ra của lệnh sản xuất".into());
                }
            }
            if action == "passed" {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let received = tx.query_one_row(
                    "SELECT COALESCE(SUM(sm.qty::numeric), 0)::text FROM inventory__stock_move sm LEFT JOIN manufacturing__rework_order ro ON ro.tenant_id = sm.tenant_id AND ro.id::text = sm.source_id WHERE sm.tenant_id = $1 AND sm.direction = 'in' AND ((sm.source = 'production_order' AND sm.source_id = $2) OR (sm.source = 'production_concession' AND sm.source_id = $2) OR (sm.source = 'production_rework' AND ro.production_order::text = $2))",
                    &[&tenant.id, &order_id.to_string()],
                ).await?;
                let received_qty =
                    decimal_column(&received, 0, "already received production quantity")?;
                let accepted_qty = decimal_column(&acceptance, 9, "accepted production quantity")?;
                if received_qty
                    .checked_add(qty)
                    .is_none_or(|total| total > accepted_qty + Decimal::new(1, 6))
                {
                    errors.push(
                        "QC concession vượt quá tổng số lượng thành phẩm đạt còn có thể nhập kho"
                            .into(),
                    );
                }
                if original_inspection == id(document, "id").unwrap_or_default() {
                    errors.push("Phiếu QC concession không thể trùng phiếu QC lỗi gốc".into());
                }
            }
        } else if source == Some("production_rework") {
            let rework_id = document
                .get("rework_order")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let Some(rework_id) = rework_id else {
                errors.push("Phiếu QC sửa hàng cần mã lệnh sửa hợp lệ".into());
                return Ok(errors);
            };
            let Some(order) = tx.query_opt(
                    "SELECT ro.qty::text, ro.status, ro.production_order, po.product, po.warehouse, COALESCE(po.good_qty, po.qty)::text, po.output_lot_code, COALESCE(product.lot_tracked, false) FROM manufacturing__rework_order ro JOIN manufacturing__production_order po ON po.tenant_id = ro.tenant_id AND po.id = ro.production_order JOIN master_data__product product ON product.tenant_id = po.tenant_id AND product.id = po.product WHERE ro.tenant_id = $1 AND ro.id = $2 AND po.id = $3 FOR UPDATE OF ro, po",
                    &[&tenant.id, &rework_id, &order_id],
                ).await? else {
                errors.push("Phiếu QC sửa hàng cần liên kết lệnh sửa và lệnh sản xuất hợp lệ".into());
                return Ok(errors);
            };
            let rework_qty = decimal_column(&order, 0, "rework quantity")?;
            let valid = order.get::<_, String>(1) == "done"
                && order.get::<_, Uuid>(2) == order_id
                && order.get::<_, Uuid>(3) == product
                && order.get::<_, Uuid>(4) == warehouse
                && money::within_tolerance(rework_qty, qty, Decimal::new(1, 6));
            if !valid {
                errors.push(
                    "Phiếu QC sửa hàng phải khớp số lượng, sản phẩm, kho và lệnh sửa đã hoàn tất"
                        .into(),
                );
            }
            if order.get::<_, bool>(7) {
                let expected_code: Option<String> = order.get(6);
                let lot = id(document, "lot");
                let lot_matches = if let (Some(lot), Some(expected_code)) = (lot, expected_code) {
                    tx.query_opt(
                        "SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 AND code = $4 FOR SHARE",
                        &[&tenant.id, &lot, &product, &expected_code],
                    ).await?.is_some()
                } else {
                    false
                };
                if !lot_matches {
                    errors.push("QC sửa hàng phải giữ đúng lô đầu ra của lệnh sản xuất".into());
                }
            }
            if action == "passed" {
                let lock_key = format!("inventory.stock:{}:{}:{}", tenant.id, product, warehouse);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                let received = tx.query_one_row(
                    "SELECT COALESCE(SUM(sm.qty::numeric), 0)::text FROM inventory__stock_move sm LEFT JOIN manufacturing__rework_order ro ON ro.tenant_id = sm.tenant_id AND ro.id::text = sm.source_id WHERE sm.tenant_id = $1 AND sm.direction = 'in' AND ((sm.source IN ('production_order', 'production_concession') AND sm.source_id = $2) OR (sm.source = 'production_rework' AND ro.production_order::text = $2))",
                    &[&tenant.id, &order_id.to_string()],
                ).await?;
                let received_qty =
                    decimal_column(&received, 0, "already received production quantity")?;
                let accepted_qty = decimal_column(&order, 5, "accepted production quantity")?;
                if received_qty.checked_add(qty).is_none_or(|total| {
                    total
                        > accepted_qty
                            .checked_add(Decimal::new(1, 6))
                            .unwrap_or(accepted_qty)
                }) {
                    errors.push(
                        "QC duyệt vượt quá tổng số lượng thành phẩm đạt của lệnh sản xuất".into(),
                    );
                }
            }
        } else if source == Some("production_order") {
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
                let inspection_id = id(document, "id").unwrap_or_default();
                let returned = tx
                    .query_opt(
                        "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'quality_return' AND source_id = $2 AND direction = 'out'",
                        &[&tenant.id, &inspection_id.to_string()],
                    )
                    .await?;
                let returned = returned
                    .map(|row| decimal_column(&row, 0, "returned quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                let remaining_qty = qty
                    .checked_sub(released)
                    .and_then(|remaining| remaining.checked_sub(returned))
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
                        .is_none_or(|available| available < remaining_qty)
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
                let inspection_id = id(document, "id").unwrap_or_default();
                let returned = tx
                    .query_opt(
                        "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'quality_return' AND source_id = $2 AND direction = 'out'",
                        &[&tenant.id, &inspection_id.to_string()],
                    )
                    .await?;
                let returned = returned
                    .map(|row| decimal_column(&row, 0, "returned quantity"))
                    .transpose()?
                    .unwrap_or(Decimal::ZERO);
                let remaining_qty = qty
                    .checked_sub(released)
                    .and_then(|remaining| remaining.checked_sub(returned))
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
                        .is_none_or(|available| available < remaining_qty)
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
                "SELECT id FROM purchasing__purchase_return WHERE tenant_id = $1 AND inspection = $2 AND status IN ('submitted', 'approved') LIMIT 1",
                &[&tenant.id, &inspection_id],
            ).await?.is_some() {
                errors.push("Không thể kiểm định lại khi phiếu trả nhà cung cấp còn chờ xử lý hoặc duyệt".into());
            }
            let returned = tx.query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'quality_return' AND source_id = $2 AND direction = 'out'",
                &[&tenant.id, &inspection_id.to_string()],
            ).await?;
            let returned = returned
                .map(|row| decimal_column(&row, 0, "returned quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let released = tx.query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM quality__inspection_disposition WHERE tenant_id = $1 AND inspection = $2 AND status = 'posted'",
                &[&tenant.id, &inspection_id],
            ).await?;
            let released = released
                .map(|row| decimal_column(&row, 0, "released quantity"))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let inspected_qty = number(document, "qty").unwrap_or(Decimal::ZERO);
            let accounted = returned.checked_add(released);
            if inspected_qty
                .checked_sub(Decimal::new(1, 6))
                .zip(accounted)
                .is_none_or(|(minimum_remaining, used)| used >= minimum_remaining)
            {
                errors.push("Không còn số lượng hàng mua đang giữ để kiểm định lại".into());
            }
        }
    }
    Ok(errors)
}
