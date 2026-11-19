//! Tenant-scoped BOM and production-order consistency checks.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn optional_decimal_column(
    row: &tokio_postgres::Row,
    column: usize,
    field: &str,
) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "manufacturing.persistence",
                    vec![format!(
                        "Stored manufacturing {field} is not a valid decimal"
                    )],
                )
            })
        })
        .transpose()
}

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "manufacturing.persistence",
            vec![format!(
                "Stored manufacturing {field} is not a valid decimal"
            )],
        )
    })
}
fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

async fn validate_work_center_schedule(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    action: &str,
) -> R<Vec<String>> {
    let Some(raw_center) = document.get("work_center") else {
        return Ok(Vec::new());
    };
    if raw_center.is_null() {
        return Ok(Vec::new());
    }
    let Some(center_id) = raw_center
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec![
            "Production order work center must be a valid tenant record".into(),
        ]);
    };
    let Some(planned_start) = document
        .get("planned_start")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Ok(vec![
            "A valid planned start date is required for work-center scheduling".into(),
        ]);
    };
    let center = tx
        .query_opt(
            "SELECT capacity_per_day::text, capacity_uom FROM manufacturing__work_center WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &center_id],
        )
        .await?;
    let Some(center) = center else {
        return Ok(vec!["Work center does not belong to this tenant".into()]);
    };
    let capacity = optional_decimal_column(&center, 0, "work-center capacity")?;
    let capacity_uom: Option<Uuid> = center.get(1);
    if matches!(action, "created" | "updated" | "started") {
        let requested = document
            .get("qty")
            .and_then(money::decimal)
            .filter(|quantity| *quantity > Decimal::ZERO)
            .unwrap_or_default();
        if let Some(capacity) = capacity {
            let Some(capacity_uom) = capacity_uom else {
                return Ok(vec![
                    "Trung tâm sản xuất cần có đơn vị gốc khi khai báo công suất/ngày".into(),
                ]);
            };
            if tx.query_opt(
                "SELECT id FROM master_data__uom WHERE tenant_id = $1 AND id = $2 AND base_uom IS NULL FOR SHARE",
                &[&tenant.id, &capacity_uom],
            ).await?.is_none() {
                return Ok(vec!["Đơn vị công suất phải là đơn vị gốc thuộc doanh nghiệp".into()]);
            }
            let Some(product_id) = id(document, "product") else {
                return Ok(vec![
                    "Trung tâm sản xuất cần thành phẩm có đơn vị gốc hợp lệ để lập lịch công suất"
                        .into(),
                ]);
            };
            let Some(product) = tx
                .query_opt(
                    "SELECT product.uom, EXISTS (SELECT 1 FROM master_data__uom unit WHERE unit.tenant_id = product.tenant_id AND unit.id = product.uom AND unit.base_uom IS NULL) FROM master_data__product product WHERE product.tenant_id = $1 AND product.id = $2 FOR SHARE OF product",
                    &[&tenant.id, &product_id],
                )
                .await?
            else {
                return Ok(vec!["Finished product does not belong to this tenant".into()]);
            };
            let product_uom: Option<Uuid> = product.get(0);
            let has_tenant_base_unit: bool = product.get(1);
            if product_uom.is_none() || !has_tenant_base_unit || product_uom != Some(capacity_uom) {
                return Ok(vec![
                    "Thành phẩm phải dùng đúng đơn vị công suất của trung tâm sản xuất".into(),
                ]);
            }
            let order_id = id(document, "id");
            if tx
                .query_opt(
                    "SELECT 1 FROM manufacturing__production_order scheduled JOIN master_data__product scheduled_product ON scheduled_product.tenant_id = scheduled.tenant_id AND scheduled_product.id = scheduled.product WHERE scheduled.tenant_id = $1 AND scheduled.work_center = $2 AND scheduled.planned_start = $3 AND scheduled.status IN ('planned', 'in_progress') AND ($4::uuid IS NULL OR scheduled.id <> $4) AND scheduled_product.uom IS DISTINCT FROM $5 LIMIT 1",
                    &[&tenant.id, &center_id, &planned_start, &order_id, &capacity_uom],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Các lệnh trên trung tâm phải dùng đúng đơn vị công suất đã chọn".into()]);
            }
            let scheduled = tx
                .query_one_row(
                    "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM manufacturing__production_order WHERE tenant_id = $1 AND work_center = $2 AND planned_start = $3 AND status IN ('planned', 'in_progress') AND ($4::uuid IS NULL OR id <> $4)",
                    &[&tenant.id, &center_id, &planned_start, &order_id],
                )
                .await?
                ;
            let scheduled = decimal_column(&scheduled, 0, "scheduled daily load")?;
            let exceeds_capacity = scheduled.checked_add(requested).is_none_or(|total| {
                total > capacity.checked_add(Decimal::new(1, 6)).unwrap_or(capacity)
            });
            if exceeds_capacity {
                return Ok(vec![format!(
                    "Work center daily capacity exceeded: {scheduled} already scheduled, {requested} requested, {capacity} available"
                )]);
            }
        }
    }
    Ok(Vec::new())
}

async fn validate_conditional_acceptance(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(
        action,
        "created" | "updated" | "submitted" | "approved" | "rejected"
    ) {
        return Ok(Vec::new());
    }
    let (Some(acceptance_id), Some(inspection_id), Some(qty)) = (
        id(document, "id"),
        id(document, "inspection"),
        document.get("qty").and_then(money::decimal),
    ) else {
        return Ok(vec![
            "Đề nghị chấp nhận có điều kiện cần phiếu QC và số lượng hợp lệ".into(),
        ]);
    };
    if qty <= Decimal::ZERO {
        return Ok(vec![
            "Số lượng chấp nhận có điều kiện phải lớn hơn 0".into(),
        ]);
    }
    let inspection = tx.query_opt(
        "SELECT qty::text, status, source, source_id, product, warehouse, rework_order FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &inspection_id],
    ).await?;
    let Some(inspection) = inspection else {
        return Ok(vec!["Không tìm thấy phiếu QC trong doanh nghiệp".into()]);
    };
    let inspection_qty = decimal_column(&inspection, 0, "failed inspection quantity")?;
    let source: String = inspection.get(2);
    let order_id = inspection.get::<_, String>(3).parse::<Uuid>().ok();
    let Some(order_id) = order_id else {
        return Ok(vec!["Phiếu QC không liên kết lệnh sản xuất hợp lệ".into()]);
    };
    let order = tx.query_opt(
        "SELECT product, warehouse, status, COALESCE(good_qty, qty)::text FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &order_id],
    ).await?;
    let Some(order) = order else {
        return Ok(vec![
            "Không tìm thấy lệnh sản xuất trong doanh nghiệp".into(),
        ]);
    };
    let mut errors = Vec::new();
    if !matches!(source.as_str(), "production_order" | "production_rework")
        || inspection.get::<_, String>(1) != "failed"
        || inspection.get::<_, Uuid>(4) != order.get::<_, Uuid>(0)
        || inspection.get::<_, Uuid>(5) != order.get::<_, Uuid>(1)
        || order.get::<_, String>(2) != "done"
        || decimal_column(&order, 3, "accepted production quantity")? <= Decimal::ZERO
    {
        errors.push("Chỉ phiếu QC không đạt của lệnh sản xuất đã hoàn tất mới được đề nghị chấp nhận có điều kiện".into());
    }
    if source == "production_rework" {
        let rework_id = inspection
            .get::<_, Option<String>>(6)
            .and_then(|value| Uuid::parse_str(&value).ok());
        let linked = if let Some(rework_id) = rework_id {
            tx.query_opt(
                "SELECT id FROM manufacturing__rework_order WHERE tenant_id = $1 AND id = $2 AND production_order = $3 AND status = 'done' FOR SHARE",
                &[&tenant.id, &rework_id, &order_id],
            ).await?.is_some()
        } else {
            false
        };
        if !linked {
            errors.push("Phiếu QC sửa hàng phải liên kết một lệnh sửa đã hoàn tất".into());
        }
    }
    if action == "submitted" && !tenant.has_module("workflow-approval") {
        errors.push("Cần bật module Phê duyệt để gửi đề nghị chấp nhận có điều kiện".into());
    }
    if matches!(action, "approved" | "rejected") {
        let expected = if action == "approved" {
            "approved"
        } else {
            "rejected"
        };
        let decision = tx.query_opt(
            "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'manufacturing.conditional_acceptance' AND record_id = $2 AND status = $3 LIMIT 1",
            &[&tenant.id, &acceptance_id.to_string(), &expected],
        ).await?.is_some();
        if !decision {
            errors.push(
                "Đề nghị chỉ được chấp thuận hoặc từ chối qua yêu cầu phê duyệt chung".into(),
            );
        }
    }
    let accounted = tx.query_one_row(
        "SELECT (COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__rework_order WHERE tenant_id = $1 AND inspection = $2 AND status <> 'cancelled'), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__production_disposition WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'posted')), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__conditional_acceptance WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'submitted', 'approved') AND id <> $3), 0))::text",
        &[&tenant.id, &inspection_id, &acceptance_id],
    ).await?;
    let accounted_qty = decimal_column(
        &accounted,
        0,
        "already reworked, discarded, or conditionally accepted quantity",
    )?;
    if accounted_qty
        .checked_add(qty)
        .is_none_or(|total| total > inspection_qty + Decimal::new(1, 6))
    {
        errors.push(format!(
            "Tổng lượng sửa, loại bỏ và chấp nhận có điều kiện vượt lượng QC lỗi còn lại ({})",
            (inspection_qty - accounted_qty).max(Decimal::ZERO)
        ));
    }
    Ok(errors)
}

async fn validate_work_center_update(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    action: &str,
) -> R<Vec<String>> {
    let capacity = document
        .get("capacity_per_day")
        .filter(|value| !value.is_null())
        .and_then(money::decimal);
    let capacity_uom = id(document, "capacity_uom");
    if capacity.is_some() && capacity_uom.is_none() {
        return Ok(vec![
            "Trung tâm sản xuất cần có đơn vị gốc khi khai báo công suất/ngày".into(),
        ]);
    }
    if capacity.is_none() && capacity_uom.is_some() {
        return Ok(vec![
            "Chỉ chọn đơn vị công suất khi đã khai báo công suất mỗi ngày".into(),
        ]);
    }
    if let Some(capacity_uom) = capacity_uom {
        if tx
            .query_opt(
                "SELECT id FROM master_data__uom WHERE tenant_id = $1 AND id = $2 AND base_uom IS NULL FOR SHARE",
                &[&tenant.id, &capacity_uom],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Đơn vị công suất phải là đơn vị gốc thuộc doanh nghiệp".into(),
            ]);
        }
    }
    if action == "created" {
        return Ok(Vec::new());
    }
    let Some(center_id) = id(document, "id") else {
        return Ok(vec!["Work center id is required".into()]);
    };
    let Some(current_center) = tx
        .query_opt(
            "SELECT capacity_per_day::text, capacity_uom FROM manufacturing__work_center WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &center_id],
        )
        .await?
    else {
        return Ok(vec!["Work center does not belong to this tenant".into()]);
    };
    let current_capacity = optional_decimal_column(&current_center, 0, "work-center capacity")?;
    let current_capacity_uom: Option<Uuid> = current_center.get(1);
    if current_capacity != capacity || current_capacity_uom != capacity_uom {
        if let Some(capacity_uom) = capacity_uom {
            let schedule_units = tx
                .query_one_row(
                    "SELECT COUNT(*) FILTER (WHERE unit.id IS NULL)::bigint, COUNT(*) FILTER (WHERE product.uom IS DISTINCT FROM $3)::bigint FROM manufacturing__production_order scheduled JOIN master_data__product product ON product.tenant_id = scheduled.tenant_id AND product.id = scheduled.product LEFT JOIN master_data__uom unit ON unit.tenant_id = product.tenant_id AND unit.id = product.uom AND unit.base_uom IS NULL WHERE scheduled.tenant_id = $1 AND scheduled.work_center = $2 AND scheduled.status IN ('planned', 'in_progress')",
                    &[&tenant.id, &center_id, &capacity_uom],
                )
                .await?;
            let missing_units: i64 = schedule_units.get(0);
            let mismatched_units: i64 = schedule_units.get(1);
            if missing_units > 0 {
                return Ok(vec![
                    "Không thể đặt công suất khi các lệnh đang chạy chưa có đơn vị gốc hợp lệ"
                        .into(),
                ]);
            }
            if mismatched_units > 0 {
                return Ok(vec![
                    "Các lệnh đang chạy phải dùng đơn vị công suất trước khi thay đổi công suất"
                        .into(),
                ]);
            }
        }
    }
    let Some(capacity) = capacity else {
        return Ok(Vec::new());
    };
    let scheduled = tx
        .query_one_row(
            "SELECT COALESCE(MAX(daily_load), 0)::text FROM (SELECT SUM(qty::numeric) AS daily_load FROM manufacturing__production_order WHERE tenant_id = $1 AND work_center = $2 AND status IN ('planned', 'in_progress') GROUP BY planned_start) schedule",
            &[&tenant.id, &center_id],
        )
        .await?;
    let scheduled = decimal_column(&scheduled, 0, "scheduled daily load")?;
    if scheduled > capacity.checked_add(Decimal::new(1, 6)).unwrap_or(capacity) {
        return Ok(vec![format!(
            "Work-center capacity cannot be reduced below its scheduled load of {scheduled}"
        )]);
    }
    Ok(Vec::new())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    if entity == "conditional_acceptance" {
        return validate_conditional_acceptance(tx, tenant, action, document).await;
    }
    match (entity, action) {
        ("production_disposition", "created" | "posted") => {
            let (Some(disposition_id), Some(inspection_id), Some(qty), Some(account_id)) = (
                id(document, "id"),
                id(document, "inspection"),
                document.get("qty").and_then(money::decimal),
                id(document, "expense_account"),
            ) else {
                return Ok(vec!["Loại bỏ thành phẩm cần phiếu QC, số lượng và tài khoản chi phí hợp lệ".into()]);
            };
            let inspection = tx.query_opt(
                "SELECT qty::text, status, source, source_id, product, warehouse, rework_order FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &inspection_id],
            ).await?;
            let Some(inspection) = inspection else {
                return Ok(vec!["Không tìm thấy phiếu QC thành phẩm trong doanh nghiệp".into()]);
            };
            let inspection_qty = decimal_column(&inspection, 0, "inspection quantity")?;
            let source = inspection.get::<_, String>(2);
            let Some(order_id) = inspection
                .get::<_, String>(3)
                .parse::<Uuid>()
                .ok()
            else {
                return Ok(vec!["Phiếu QC không liên kết lệnh sản xuất hợp lệ".into()]);
            };
            let order = tx.query_opt(
                "SELECT product, warehouse, status, COALESCE(good_qty, qty)::text FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &order_id],
            ).await?;
            let Some(order) = order else {
                return Ok(vec!["Không tìm thấy lệnh sản xuất của phiếu QC".into()]);
            };
            let mut source_valid = source == "production_order";
            if source == "production_rework" {
                source_valid = false;
                let linked_rework: Option<String> = inspection.get(6);
                if let Some(rework_id) = linked_rework.and_then(|value| Uuid::parse_str(&value).ok()) {
                    source_valid = tx.query_opt(
                        "SELECT id FROM manufacturing__rework_order WHERE tenant_id = $1 AND id = $2 AND production_order = $3 AND status = 'done' FOR SHARE",
                        &[&tenant.id, &rework_id, &order_id],
                    ).await?.is_some();
                }
            }
            let valid = source_valid
                && inspection.get::<_, String>(1) == "failed"
                && inspection.get::<_, Uuid>(4) == order.get::<_, Uuid>(0)
                && inspection.get::<_, Uuid>(5) == order.get::<_, Uuid>(1)
                && order.get::<_, String>(2) == "done"
                && decimal_column(&order, 3, "accepted production quantity")? > Decimal::ZERO;
            if !valid {
                errors.push("Chỉ được loại bỏ lượng lỗi trên phiếu QC của lệnh sản xuất đã hoàn tất".into());
            }
            let accounted = tx.query_one_row(
                "SELECT (COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__rework_order WHERE tenant_id = $1 AND inspection = $2 AND status <> 'cancelled'), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__production_disposition WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'posted') AND id <> $3), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__conditional_acceptance WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'submitted', 'approved')), 0))::text",
                &[&tenant.id, &inspection_id, &disposition_id],
            ).await?;
            let accounted_qty = decimal_column(&accounted, 0, "previously reworked or discarded quantity")?;
            if accounted_qty.checked_add(qty).is_none_or(|total| total > inspection_qty.checked_add(Decimal::new(1, 6)).unwrap_or(inspection_qty)) {
                errors.push(format!("Số lượng sửa và loại bỏ vượt lượng QC trượt còn lại ({})", (inspection_qty - accounted_qty).max(Decimal::ZERO)));
            }
            if action == "posted" || document.get("expense_account").is_some() {
                if tx.query_opt(
                    "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
                    &[&tenant.id, &account_id],
                ).await?.is_none() {
                    errors.push("Tài khoản loại bỏ phải là tài khoản chi phí thuộc doanh nghiệp".into());
                }
            }
        }
        ("rework_order", "created" | "started" | "done") => {
            let (Some(rework_id), Some(order_id), Some(inspection_id)) = (
                id(document, "id"),
                id(document, "production_order"),
                id(document, "inspection"),
            ) else {
                return Ok(vec!["Rework requires valid production-order and inspection links".into()]);
            };
            let Some(qty) = document.get("qty").and_then(money::decimal) else {
                return Ok(vec!["Rework requires a positive quantity".into()]);
            };
            let inspection = tx.query_opt(
                "SELECT qi.qty::text, qi.status, qi.source, qi.source_id, po.status, po.product, qi.product, po.warehouse, qi.warehouse, COALESCE(po.good_qty, po.qty)::text, qi.rework_order, qi.lot, po.output_lot_code FROM quality__inspection qi JOIN manufacturing__production_order po ON po.tenant_id = qi.tenant_id AND po.id = $3 WHERE qi.tenant_id = $1 AND qi.id = $2 FOR UPDATE OF qi, po",
                &[&tenant.id, &inspection_id, &order_id],
            ).await?;
            let Some(inspection) = inspection else {
                return Ok(vec!["Rework inspection and production order must belong to this tenant".into()]);
            };
            let inspection_qty = decimal_column(&inspection, 0, "inspection quantity")?;
            let accepted_qty = decimal_column(&inspection, 9, "accepted production quantity")?;
            let source = inspection.get::<_, String>(2);
            let prior_rework_id: Option<String> = inspection.get(10);
            let rework_source_valid = if source == "production_rework" {
                inspection.get::<_, String>(3) == order_id.to_string()
                    && prior_rework_id
                        .as_deref()
                        .is_some_and(|prior_id| Uuid::parse_str(prior_id).is_ok())
                    && tx.query_opt(
                    "SELECT id FROM manufacturing__rework_order WHERE tenant_id = $1 AND id = $2 AND production_order = $3 AND status = 'done' FOR SHARE",
                    &[&tenant.id, &prior_rework_id.and_then(|value| Uuid::parse_str(&value).ok()).unwrap_or_default(), &order_id],
                ).await?.is_some()
            } else {
                source == "production_order"
                    && inspection.get::<_, String>(3) == order_id.to_string()
            };
            let lot_matches = if let Some(expected_code) = inspection.get::<_, Option<String>>(12) {
                let lot_id: Option<Uuid> = inspection.get(11);
                if let Some(lot_id) = lot_id {
                    tx.query_opt(
                        "SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3 AND code = $4 FOR SHARE",
                        &[&tenant.id, &lot_id, &inspection.get::<_, Uuid>(5), &expected_code],
                    ).await?.is_some()
                } else {
                    false
                }
            } else {
                true
            };
            let valid = inspection.get::<_, String>(1) == "failed"
                && rework_source_valid
                && inspection.get::<_, String>(4) == "done"
                && inspection.get::<_, Uuid>(5) == inspection.get::<_, Uuid>(6)
                && inspection.get::<_, Uuid>(7) == inspection.get::<_, Uuid>(8)
                && lot_matches
                && qty <= inspection_qty.checked_add(Decimal::new(1, 6)).unwrap_or(inspection_qty)
                && accepted_qty > Decimal::ZERO;
            if !valid {
                errors.push("Rework must reference a failed inspection for an eligible quantity of its completed production order".into());
            }
            let committed = tx.query_one_row(
                "SELECT (COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__rework_order WHERE tenant_id = $1 AND inspection = $2 AND status <> 'cancelled' AND id <> $3), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__production_disposition WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'posted')), 0) + COALESCE((SELECT SUM(qty::numeric) FROM manufacturing__conditional_acceptance WHERE tenant_id = $1 AND inspection = $2 AND status IN ('draft', 'submitted', 'approved')), 0))::text",
                &[&tenant.id, &inspection_id, &rework_id],
            ).await?;
            let committed_qty = decimal_column(&committed, 0, "reserved rework and discarded quantity")?;
            if committed_qty.checked_add(qty).is_none_or(|total| total > inspection_qty.checked_add(Decimal::new(1, 6)).unwrap_or(inspection_qty)) {
                errors.push(format!("Rework quantity exceeds the remaining failed quantity ({})", (inspection_qty - committed_qty).max(Decimal::ZERO)));
            }
        }
        ("work_center", "created" | "updated") => {
            errors.extend(validate_work_center_update(tx, tenant, document, action).await?);
        }
        ("work_center", "removed") => {
            if let Some(center_id) = id(document, "id")
                && tx
                    .query_opt(
                        "SELECT id FROM manufacturing__production_order WHERE tenant_id = $1 AND work_center = $2 LIMIT 1",
                        &[&tenant.id, &center_id],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Work center is referenced by production-order history and cannot be removed".into());
            }
        }
        ("bom", "created" | "updated") => {
            let Some(product) = id(document, "product") else {
                return Ok(vec!["BOM cần sản phẩm thành phẩm hợp lệ".into()]);
            };
            if tx.query_opt("SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &product]).await?.is_none() {
                errors.push("Sản phẩm thành phẩm của BOM không tồn tại trong doanh nghiệp".into());
            }
            if let Some(components) = document.get("components").and_then(Value::as_array) {
                for component in components {
                    let Some(component_id) = component
                        .get("product")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok())
                    else {
                        continue;
                    };
                    if component_id == product {
                        errors.push("Thành phẩm không thể là nguyên liệu của chính BOM đó".into());
                        continue;
                    }
                    if tx.query_opt("SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &component_id]).await?.is_none() {
                        errors.push("Nguyên liệu trong BOM không tồn tại trong doanh nghiệp".into());
                    }
                }
            }
            if let Some(bom_id) = id(document, "id") {
                tx.query_opt(
                    "SELECT id FROM manufacturing__bom WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &bom_id],
                )
                .await?;
                if tx.query_opt("SELECT id FROM manufacturing__production_order WHERE tenant_id = $1 AND bom = $2 AND status <> 'cancelled' LIMIT 1", &[&tenant.id, &bom_id]).await?.is_some() {
                    errors.push("Không sửa BOM đã được tham chiếu bởi lệnh sản xuất; hãy tạo phiên bản BOM mới".into());
                }
            }
        }
        ("bom", "removed") => {
            if let Some(bom_id) = id(document, "id") {
                tx.query_opt(
                    "SELECT id FROM manufacturing__bom WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &bom_id],
                )
                .await?;
                if tx.query_opt("SELECT id FROM manufacturing__production_order WHERE tenant_id = $1 AND bom = $2 LIMIT 1", &[&tenant.id, &bom_id]).await?.is_some() {
                    errors.push("Không xóa BOM đã được tham chiếu bởi lệnh sản xuất".into());
                }
            }
        }
        ("production_order", "created" | "updated" | "started" | "done") => {
            errors.extend(validate_work_center_schedule(tx, tenant, document, action).await?);
            let (Some(product), Some(bom_id), Some(warehouse)) = (
                id(document, "product"),
                id(document, "bom"),
                id(document, "warehouse"),
            ) else {
                return Ok(vec![
                    "Lệnh sản xuất cần thành phẩm, BOM và kho hợp lệ".into(),
                ]);
            };
            if tx.query_opt("SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &warehouse]).await?.is_none() {
                errors.push("Kho sản xuất không tồn tại trong doanh nghiệp".into());
            }
            if let Some(row) = tx.query_opt(
                "SELECT COALESCE(tracked, kind = 'goods', true), COALESCE(lot_tracked, false) FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product],
            ).await? {
                if !row.get::<_, bool>(0) {
                    errors.push("Thành phẩm sản xuất phải được theo dõi tồn kho".into());
                }
                if row.get::<_, bool>(1)
                    && document
                        .get("output_lot_code")
                        .and_then(Value::as_str)
                        .is_none_or(|code| code.trim().is_empty())
                {
                    errors.push("Thành phẩm theo dõi lô cần mã lô đầu ra trước khi lập lệnh".into());
                }
            } else {
                errors.push("Không tìm thấy thành phẩm trong doanh nghiệp".into());
            }
            let bom = tx.query_opt("SELECT product, components FROM manufacturing__bom WHERE tenant_id = $1 AND id = $2 FOR SHARE", &[&tenant.id, &bom_id]).await?;
            let Some(bom) = bom else {
                errors.push("Không tìm thấy BOM trong doanh nghiệp".into());
                return Ok(errors);
            };
            let bom_product: Uuid = bom.get(0);
            let components: Value = bom.get(1);
            if bom_product != product {
                errors.push("BOM phải thuộc đúng thành phẩm của lệnh sản xuất".into());
            }
            if components.as_array().is_none_or(Vec::is_empty) {
                errors.push("BOM cần có ít nhất một nguyên liệu trước khi sản xuất".into());
            }
            if let Some(order_id) = id(document, "id") {
                tx.query_opt("SELECT id FROM manufacturing__production_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE", &[&tenant.id, &order_id]).await?;
            }
            if action == "done"
                && document.get("scrap_cost_method").and_then(Value::as_str) == Some("expense")
            {
                let expense_account = id(document, "scrap_expense_account");
                let valid_expense_account = if let Some(account_id) = expense_account {
                    tx.query_opt(
                        "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
                        &[&tenant.id, &account_id],
                    )
                    .await?
                    .is_some()
                } else {
                    false
                };
                if !valid_expense_account {
                    errors.push("Abnormal scrap must use an expense account in this tenant".into());
                }
            }
        }
        ("production_order", "cancelled") => {
            let Some(order_id) = id(document, "id") else {
                return Ok(vec![
                    "Không xác định được lệnh sản xuất cần hủy".into(),
                ]);
            };
            if tx
                .query_opt(
                    "SELECT id FROM inventory__stock_move WHERE tenant_id = $1 AND source_id = $2 AND source IN ('production_order_bom', 'production_order') LIMIT 1",
                    &[&tenant.id, &order_id.to_string()],
                )
                .await?
                .is_some()
            {
                errors.push(
                    "Không thể hủy lệnh sản xuất đã phát sinh phiếu kho; hãy dùng nghiệp vụ điều chỉnh".into(),
                );
            }
        }
        _ => {}
    }
    Ok(errors)
}
