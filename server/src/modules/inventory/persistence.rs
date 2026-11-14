use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

async fn validate_location_reference(
    tx: &Tx<'_>,
    tenant: &Tenant,
    location: Uuid,
    warehouse: Uuid,
) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT id FROM inventory__warehouse_location WHERE tenant_id = $1 AND id = $2 AND warehouse = $3 AND COALESCE(active, true) = true FOR SHARE",
            &[&tenant.id, &location, &warehouse],
        )
        .await?
        .is_some())
}

async fn validate_transfer_locations(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let from = document
        .get("from_warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let to = document
        .get("to_warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some((from, to)) = from.zip(to) else {
        return Ok(vec![
            "Transfer requires valid source and destination warehouses".into(),
        ]);
    };
    let mut errors = Vec::new();
    for (index, line) in document
        .get("lines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        for (field, warehouse, label) in [
            ("from_location", from, "source"),
            ("to_location", to, "destination"),
        ] {
            let Some(location) = line
                .get(field)
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            if !validate_location_reference(tx, tenant, location, warehouse).await? {
                errors.push(format!(
                    "Transfer line {} {label} location must be active and belong to its warehouse",
                    index + 1
                ));
            }
        }
    }
    Ok(errors)
}

pub async fn validate_source_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    qname: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(
        qname,
        "field-service.work_order"
            | "restaurant.table_order"
            | "auto-service.repair_order"
            | "maintenance.maintenance_request"
            | "clinic.prescription"
    ) {
        return Ok(Vec::new());
    }
    let has_stock_items = ["lines", "parts", "items", "consumptions"]
        .iter()
        .any(|key| {
            document
                .get(*key)
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items.iter().any(|line| {
                        line.get("tracked") == Some(&Value::Bool(true))
                            && line.get("product").and_then(Value::as_str).is_some()
                    })
                })
        });
    if !has_stock_items {
        return Ok(Vec::new());
    }
    let Some(warehouse) = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(Vec::new());
    };
    Ok(
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            vec!["Kho nghiệp vụ không tồn tại trong doanh nghiệp".into()]
        } else {
            Vec::new()
        },
    )
}

/// Capture stock policy on operational consumption lines before the source
/// document is committed or emits its completion event.

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "warehouse_location" && matches!(action, "created" | "updated") {
        let Some(warehouse) = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Warehouse location requires a valid warehouse".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["Warehouse location must belong to this tenant".into()]);
        }
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        let code = document
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!(
                "inventory.location:{}:{}:{}",
                tenant.id, warehouse, code
            )],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM inventory__warehouse_location WHERE tenant_id = $1 AND warehouse = $2 AND code = $3 AND id <> $4 LIMIT 1",
                &[&tenant.id, &warehouse, &code, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Location code must be unique within its warehouse".into()]);
        }
        if action == "updated" {
            let old = tx
                .query_opt(
                    "SELECT warehouse, COALESCE(active, true) FROM inventory__warehouse_location WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?;
            if let Some(old) = old {
                let old_warehouse: Uuid = old.get(0);
                let old_active: bool = old.get(1);
                if old_warehouse != warehouse
                    && tx
                        .query_opt(
                            "SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND (location = $2 OR transfer_to_location = $2) LIMIT 1",
                            &[&tenant.id, &id],
                        )
                        .await?
                        .is_some()
                {
                    return Ok(vec!["A location referenced by stock movements cannot be moved to another warehouse".into()]);
                }
                if old_active
                    && document.get("active") == Some(&Value::Bool(false))
                    && tx
                        .query_opt(
                            "SELECT 1 FROM inventory__stock_move sm WHERE sm.tenant_id = $1 AND (sm.location = $2 AND EXISTS (SELECT 1 FROM inventory__stock_move on_hand WHERE on_hand.tenant_id = sm.tenant_id AND on_hand.product = sm.product AND on_hand.warehouse = sm.warehouse AND on_hand.location = $2 GROUP BY on_hand.product, on_hand.warehouse HAVING SUM(CASE WHEN on_hand.direction = 'in' THEN on_hand.qty ELSE -on_hand.qty END) > 0) OR (sm.transfer_to_location = $2 AND sm.source = 'stock_transfer_out' AND EXISTS (SELECT 1 FROM inventory__stock_transfer transfer WHERE transfer.tenant_id = sm.tenant_id AND transfer.id::text = sm.source_id AND transfer.status = 'dispatched')) LIMIT 1",
                            &[&tenant.id, &id],
                        )
                        .await?
                        .is_some()
                {
                    return Ok(vec!["A warehouse location with stock cannot be deactivated".into()]);
                }
            }
        }
        return Ok(Vec::new());
    }
    if entity == "warehouse_location" && action == "removed" {
        let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Warehouse location requires a valid id".into()]);
        };
        if tx
            .query_opt(
                "SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND (location = $2 OR transfer_to_location = $2) LIMIT 1",
                &[&tenant.id, &id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["A warehouse location referenced by stock movements cannot be deleted".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "stock_transfer" && matches!(action, "dispatched" | "received") {
        return validate_transfer_locations(tx, tenant, document).await;
    }
    if entity == "stock_move" && action == "created" {
        if let Some(location) = document
            .get("location")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            let Some(warehouse) = document
                .get("warehouse")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec![
                    "A stock movement with a location requires a warehouse".into(),
                ]);
            };
            if !validate_location_reference(tx, tenant, location, warehouse).await? {
                return Ok(vec![
                    "Stock movement location must be active and belong to its warehouse".into(),
                ]);
            }
        }
        if let Some(destination) = document
            .get("transfer_to_location")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let target_warehouse = if document.get("source").and_then(Value::as_str)
                == Some("stock_transfer_out")
            {
                if let Some(source_id) = source_id {
                    tx.query_opt(
                        "SELECT to_warehouse FROM inventory__stock_transfer WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &source_id],
                    )
                    .await?
                    .and_then(|row| row.get::<_, Option<Uuid>>(0))
                } else {
                    None
                }
            } else {
                None
            };
            let Some(target_warehouse) = target_warehouse else {
                return Ok(vec!["Transfer destination location must belong to the transfer's destination warehouse".into()]);
            };
            if !validate_location_reference(tx, tenant, destination, target_warehouse).await? {
                return Ok(vec!["Transfer destination location must belong to the transfer's destination warehouse".into()]);
            }
        }
        return Ok(Vec::new());
    }
    if entity == "reorder_rule" && matches!(action, "created" | "updated") {
        let Some(product) = document
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Reorder rule requires a valid product".into()]);
        };
        let Some(warehouse) = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Reorder rule requires a valid warehouse".into()]);
        };
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!(
                "inventory.reorder_rule:{}:{}:{}",
                tenant.id, product, warehouse
            )],
        )
        .await?;
        if tx.query_opt(
            "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 AND COALESCE(active, true) = true FOR SHARE",
            &[&tenant.id, &product],
        ).await?.is_none() {
            return Ok(vec!["Reorder rule product must be active in this tenant".into()]);
        }
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Reorder rule warehouse must belong to this tenant".into(),
            ]);
        }
        if tx.query_opt(
            "SELECT id FROM inventory__reorder_rule WHERE tenant_id = $1 AND product = $2 AND warehouse = $3 AND id <> $4 LIMIT 1",
            &[&tenant.id, &product, &warehouse, &id],
        ).await?.is_some() {
            return Ok(vec!["Only one reorder rule is allowed per product and warehouse".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "lot" {
        let Some(id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Lot record requires a valid id".into()]);
        };
        let mut errors = Vec::new();
        let referenced = tx
            .query_opt(
                "SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 AND lot = $2 LIMIT 1",
                &[&tenant.id, &id.to_string()],
            )
            .await?
            .is_some();
        match action {
            "created" | "updated" => {
                let product = document
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok());
                let code = document
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if let Some(product) = product {
                    tx.query_opt(
                        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                        &[&format!(
                            "inventory.lot-code:{}:{}:{}",
                            tenant.id, product, code
                        )],
                    )
                    .await?;
                    if tx
                        .query_opt(
                            "SELECT 1 FROM inventory__lot WHERE tenant_id = $1 AND product = $2 AND code = $3 AND id <> $4 LIMIT 1",
                            &[&tenant.id, &product, &code, &id],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Lot code must be unique per product in this tenant".into());
                    }
                }
                if action == "updated" && referenced {
                    let old = tx
                        .query_opt(
                            "SELECT product, expiry::text FROM inventory__lot WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                            &[&tenant.id, &id],
                        )
                        .await?;
                    if let Some(old) = old {
                        let old_product: Uuid = old.get(0);
                        let old_expiry: Option<String> = old.get(1);
                        let new_product = document.get("product").and_then(Value::as_str);
                        let new_expiry = document.get("expiry").and_then(Value::as_str);
                        if new_product != Some(old_product.to_string().as_str())
                            || new_expiry != old_expiry.as_deref()
                        {
                            errors.push(
                                "Product and expiry are immutable after a lot has stock movements"
                                    .into(),
                            );
                        }
                    }
                }
            }
            "removed" if referenced => errors.push(
                "A lot referenced by stock movements cannot be deleted; keep its trace history"
                    .into(),
            ),
            _ => {}
        }
        return Ok(errors);
    }
    if entity != "stock_count" || !tenant.has_module("workflow-approval") {
        return Ok(Vec::new());
    }
    let Some(id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
    else {
        return if action == "approved" {
            Ok(vec!["Không xác định được phiếu kiểm kê cần duyệt".into()])
        } else {
            Ok(Vec::new())
        };
    };
    if action == "cancelled" {
        let pending = tx
            .query_opt(
                "SELECT id FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'inventory.stock_count' AND record_id = $2 AND status = 'pending' LIMIT 1",
                &[&tenant.id, &id.to_string()],
            )
            .await?
            .is_some();
        return if pending {
            Ok(vec![
                "Không thể hủy phiếu kiểm kê khi yêu cầu phê duyệt còn chờ; hãy xử lý yêu cầu trước".into(),
            ])
        } else {
            Ok(Vec::new())
        };
    }
    if action != "approved" {
        return Ok(Vec::new());
    }
    let approved = tx
        .query_opt(
            "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'inventory.stock_count' AND record_id = $2 AND status = 'approved' LIMIT 1",
            &[&tenant.id, &id.to_string()],
        )
        .await?
        .is_some();
    if approved {
        Ok(Vec::new())
    } else {
        Ok(vec![
            "Chỉ có thể ghi nhận kiểm kê sau khi yêu cầu phê duyệt được chấp thuận".into(),
        ])
    }
}
