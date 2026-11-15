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
            "SELECT capacity_per_day::text FROM manufacturing__work_center WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &center_id],
        )
        .await?;
    let Some(center) = center else {
        return Ok(vec!["Work center does not belong to this tenant".into()]);
    };
    let capacity = optional_decimal_column(&center, 0, "work-center capacity")?;
    if matches!(action, "created" | "updated" | "started") {
        let requested = document
            .get("qty")
            .and_then(money::decimal)
            .filter(|quantity| *quantity > Decimal::ZERO)
            .unwrap_or_default();
        if let Some(capacity) = capacity {
            let order_id = id(document, "id");
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

async fn validate_work_center_update(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(center_id) = id(document, "id") else {
        return Ok(vec!["Work center id is required".into()]);
    };
    let Some(capacity) = document.get("capacity_per_day").and_then(money::decimal) else {
        return Ok(Vec::new());
    };
    let scheduled = tx
        .query_one_row(
            "SELECT COALESCE(MAX(daily_load), 0)::text FROM (SELECT SUM(qty::numeric) AS daily_load FROM manufacturing__production_order WHERE tenant_id = $1 AND work_center = $2 AND status IN ('planned', 'in_progress') GROUP BY planned_start) schedule",
            &[&tenant.id, &center_id],
        )
        .await?
        ;
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
    match (entity, action) {
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
            let committed = tx.query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM manufacturing__rework_order WHERE tenant_id = $1 AND inspection = $2 AND status <> 'cancelled' AND id <> $3",
                &[&tenant.id, &inspection_id, &rework_id],
            ).await?;
            if let Some(committed) = committed {
                let committed_qty = decimal_column(&committed, 0, "reserved rework quantity")?;
                if committed_qty.checked_add(qty).is_none_or(|total| total > inspection_qty.checked_add(Decimal::new(1, 6)).unwrap_or(inspection_qty)) {
                    errors.push(format!("Rework quantity exceeds the remaining failed quantity ({})", (inspection_qty - committed_qty).max(Decimal::ZERO)));
                }
            }
        }
        ("work_center", "updated") => {
            if let Some(center_id) = id(document, "id") {
                tx.query_opt(
                    "SELECT id FROM manufacturing__work_center WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &center_id],
                )
                .await?;
                errors.extend(validate_work_center_update(tx, tenant, document).await?);
            }
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
                    "KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c lá»‡nh sáº£n xuáº¥t cáº§n há»§y".into(),
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
                    "KhÃ´ng thá»ƒ há»§y lá»‡nh sáº£n xuáº¥t Ä‘Ã£ phÃ¡t sinh phiáº¿u kho; hÃ£y dÃ¹ng nghiá»‡p vá»¥ Ä‘iá»u chá»‰nh".into(),
                );
            }
        }
        _ => {}
    }
    Ok(errors)
}
