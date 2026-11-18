use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    doc: &Value,
) -> R<Vec<String>> {
    if entity == "return_disposition" && action == "posted" {
        let Some(inspection_id) = id(doc, "inspection") else {
            return Ok(vec![
                "Return disposition requires a valid inspection".into(),
            ]);
        };
        let Some(qty) = doc.get("qty").and_then(crate::money::decimal) else {
            return Ok(vec!["Return disposition requires a valid quantity".into()]);
        };
        let inspection = tx
            .query_opt(
                "SELECT product, source, qty::text, warehouse, status FROM quality__inspection WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &inspection_id],
            )
            .await?;
        let Some(inspection) = inspection else {
            return Ok(vec!["Returned medicine inspection was not found".into()]);
        };
        let product: Uuid = inspection.get(0);
        let source: String = inspection.get(1);
        let inspected_qty = inspection
            .get::<_, String>(2)
            .parse::<Decimal>()
            .unwrap_or_default();
        let warehouse: Uuid = inspection.get(3);
        let status: String = inspection.get(4);
        if source != "pharmacy_return" || status != "failed" {
            return Ok(vec![
                "Returned medicine must be marked failed before it can be disposed".into(),
            ]);
        }
        let disposed = tx
            .query_opt(
                "SELECT COALESCE(SUM(qty::numeric), 0)::text FROM inventory__stock_move WHERE tenant_id = $1 AND source = 'pharmacy_disposal' AND source_id = $2 AND direction = 'out'",
                &[&tenant.id, &inspection_id.to_string()],
            )
            .await?;
        let disposed = disposed
            .map(|row| {
                row.get::<_, String>(0)
                    .parse::<Decimal>()
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        if qty <= Decimal::ZERO
            || disposed
                .checked_add(qty)
                .is_none_or(|value| value > inspected_qty + Decimal::new(1, 6))
        {
            return Ok(vec![
                "Disposal quantity exceeds the quarantined quantity remaining".into(),
            ]);
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
        if !held.is_some_and(|row| {
            row.get::<_, Option<String>>(0)
                .and_then(|value| value.parse::<Decimal>().ok())
                .is_some_and(|available| available + Decimal::new(1, 6) >= qty)
        }) {
            return Ok(vec![
                "Insufficient quarantined stock to post disposal".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if tenant.has_module("pharmacy") && entity == "pos_order" && action == "completed" {
        let Some(prescription_id) = doc
            .get("prescription")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return if doc
                .get("prescription")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
            {
                Ok(vec![
                    "POS order requires a valid linked prescription".into(),
                ])
            } else {
                Ok(Vec::new())
            };
        };
        let Some(prescription) = tx
            .query_opt(
                "SELECT party, status, valid_until::text, items FROM pharmacy__prescription WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &prescription_id],
            )
            .await?
        else {
            return Ok(vec!["Linked prescription was not found for this tenant".into()]);
        };
        let prescription_party: Option<Uuid> = prescription.get(0);
        let prescription_status: String = prescription.get(1);
        let valid_until: String = prescription.get(2);
        let items: Value = prescription.get(3);
        let order_party = id(doc, "party");
        let mut errors = Vec::new();
        if !matches!(
            prescription_status.as_str(),
            "verified" | "partially_dispensed"
        ) {
            errors.push(
                "Only a verified prescription with remaining quantity can be dispensed".into(),
            );
        }
        if prescription_party.is_none() || prescription_party != order_party {
            errors.push("POS customer must match the customer on the linked prescription".into());
        }
        if valid_until < tenant.business_today().to_string() {
            errors.push("An expired prescription cannot be dispensed".into());
        }
        let mut prescribed = BTreeMap::<Uuid, Decimal>::new();
        let Some(items) = items.as_array() else {
            return Err(crate::error::ApiError::validation(
                "pharmacy.prescription",
                vec![
                    "Prescription items are invalid; dispense quantities cannot be verified".into(),
                ],
            ));
        };
        for item in items {
            let Some(product) = item
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Err(crate::error::ApiError::validation(
                    "pharmacy.prescription",
                    vec!["Prescription item has an invalid product; dispense quantities cannot be verified".into()],
                ));
            };
            let Some(quantity) = item
                .get("base_qty")
                .or_else(|| item.get("qty"))
                .and_then(crate::money::decimal)
                .filter(|quantity| *quantity > Decimal::ZERO)
            else {
                return Err(crate::error::ApiError::validation(
                    "pharmacy.prescription",
                    vec!["Prescription item has an invalid quantity; dispense quantities cannot be verified".into()],
                ));
            };
            let current = prescribed.get(&product).copied().unwrap_or_default();
            let Some(total) = current.checked_add(quantity) else {
                return Err(crate::error::ApiError::validation(
                    "pharmacy.prescription",
                    vec!["Prescribed quantity exceeds the supported range".into()],
                ));
            };
            prescribed.insert(product, total);
        }
        let dispensed =
            super::application::dispensed_quantities(tx, tenant, prescription_id).await?;
        let mut requested = BTreeMap::<Uuid, Decimal>::new();
        let mut matching_product_found = false;
        for line in doc
            .get("lines")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            if !prescribed.contains_key(&product) {
                continue;
            }
            let Some(quantity) = line
                .get("base_qty")
                .or_else(|| line.get("qty"))
                .and_then(crate::money::decimal)
                .filter(|quantity| *quantity > Decimal::ZERO)
            else {
                errors.push(format!(
                    "Prescription product {product} has an invalid POS quantity"
                ));
                continue;
            };
            matching_product_found = true;
            let current = requested.get(&product).copied().unwrap_or_default();
            let Some(total) = current.checked_add(quantity) else {
                return Err(crate::error::ApiError::validation(
                    "pharmacy.prescription",
                    vec!["POS dispense quantity exceeds the supported range".into()],
                ));
            };
            requested.insert(product, total);
        }
        if !matching_product_found {
            errors.push(
                "A POS order linked to a prescription must include at least one prescribed product"
                    .into(),
            );
        }
        for (product, requested_quantity) in requested {
            let remaining = prescribed
                .get(&product)
                .copied()
                .unwrap_or_default()
                .checked_sub(dispensed.get(&product).copied().unwrap_or_default())
                .unwrap_or(Decimal::ZERO)
                .max(Decimal::ZERO);
            if requested_quantity > remaining {
                errors.push(format!(
                    "POS quantity for prescription product {product} exceeds the remaining prescribed quantity ({remaining})"
                ));
            }
        }
        if !errors.is_empty() {
            return Ok(errors);
        }
    }
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
            let row = tx.query_opt("SELECT custom, COALESCE(active, true) FROM master_data__product WHERE tenant_id=$1 AND id=$2 FOR SHARE", &[&tenant.id, &pid]).await?;
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
        if tx.query_opt("SELECT id FROM pharmacy__prescription WHERE tenant_id=$1 AND lower(btrim(prescription_no))=lower(btrim($2)) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1 FOR UPDATE", &[&tenant.id, &no, &current]).await?.is_some() { errors.push("Số đơn thuốc đã được ghi nhận".into()); }
        if doc
            .get("valid_until")
            .and_then(Value::as_str)
            .is_some_and(|date| date < tenant.business_today().to_string().as_str())
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
