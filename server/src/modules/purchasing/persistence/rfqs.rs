use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

fn line_totals(lines: Option<&Value>) -> Option<BTreeMap<Uuid, Decimal>> {
    let mut totals = BTreeMap::new();
    for line in lines?.as_array()? {
        let product = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())?;
        let qty = line.get("qty").and_then(money::decimal)?;
        let total = totals.entry(product).or_insert(Decimal::ZERO);
        *total = total.checked_add(qty)?;
    }
    Some(totals)
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if !matches!(action, "sent" | "quoted" | "accepted") {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    let Some(supplier_id) = document
        .get("supplier")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["RFQ requires a valid supplier".into()]);
    };
    let Some(lines) = line_totals(document.get("lines")) else {
        return Ok(vec![
            "RFQ needs valid requested product and quantity lines".into(),
        ]);
    };
    if lines.is_empty() {
        errors.push("RFQ requires at least one requested line".into());
    }
    if matches!(action, "quoted" | "accepted") {
        let Some(quote_lines) = document.get("quote_lines").and_then(Value::as_array) else {
            return Ok(vec![
                "Supplier must provide prices for every requested line".into(),
            ]);
        };
        if quote_lines.is_empty() {
            errors.push("Supplier must provide prices for every requested line".into());
        }
        if let Some(valid_until) = document.get("valid_until").and_then(Value::as_str) {
            let Ok(valid_until) = chrono::NaiveDate::parse_from_str(valid_until, "%Y-%m-%d") else {
                return Ok(vec!["Quote validity date is invalid".into()]);
            };
            if valid_until < tenant.business_today() {
                errors.push("Expired supplier quotes cannot be submitted or awarded".into());
            }
        }
        for (index, line) in quote_lines.iter().enumerate() {
            let Some(tax_id) = line.get("tax").and_then(Value::as_str) else {
                continue;
            };
            let Ok(tax_id) = Uuid::parse_str(tax_id) else {
                errors.push(format!(
                    "Quote line {} has an invalid tax reference",
                    index + 1
                ));
                continue;
            };
            if tx
                .query_opt(
                    "SELECT id FROM master_data__tax WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &tax_id],
                )
                .await?
                .is_none()
            {
                errors.push(format!(
                    "Tax on quote line {} was not found in this tenant",
                    index + 1
                ));
            }
        }
    }

    let requisition_id = document
        .get("purchase_requisition")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(requisition_id) = requisition_id else {
        return Ok(errors);
    };
    let requisition = tx
        .query_opt(
            "SELECT status, COALESCE(sourcing_method, 'direct'), warehouse, lines FROM purchasing__purchase_requisition WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &requisition_id],
        )
        .await?;
    let Some(requisition) = requisition else {
        errors.push("RFQ purchase requisition was not found in this tenant".into());
        return Ok(errors);
    };
    let status: String = requisition.get(0);
    let sourcing_method: String = requisition.get(1);
    let warehouse: Option<Uuid> = requisition.get(2);
    let requested_lines: Value = requisition.get(3);
    if status != "approved" {
        errors.push("Competitive RFQs can only be sent for an approved requisition".into());
    }
    if sourcing_method != "competitive" {
        errors.push("RFQ must be linked to a competitive purchase requisition".into());
    }
    let rfq_warehouse = document
        .get("warehouse")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if rfq_warehouse != warehouse {
        errors.push("RFQ receiving warehouse must match its purchase requisition".into());
    }
    if line_totals(Some(&requested_lines)).as_ref() != Some(&lines) {
        errors.push("RFQ product quantities must match the approved purchase requisition".into());
    }
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if let Some(id) = id {
        let duplicate_supplier = tx
            .query_opt(
                "SELECT 1 FROM purchasing__rfq WHERE tenant_id = $1 AND purchase_requisition = $2 AND supplier = $3 AND id <> $4 AND status NOT IN ('cancelled', 'rejected') LIMIT 1",
                &[&tenant.id, &requisition_id, &supplier_id, &id],
            )
            .await?
            .is_some();
        if duplicate_supplier {
            errors.push("A supplier can only submit one active quote for this requisition".into());
        }
        if action == "accepted" {
            let another_winner = tx
                .query_opt(
                    "SELECT 1 FROM purchasing__rfq WHERE tenant_id = $1 AND purchase_requisition = $2 AND id <> $3 AND status = 'accepted' LIMIT 1",
                    &[&tenant.id, &requisition_id, &id],
                )
                .await?
                .is_some();
            if another_winner {
                errors.push(
                    "Only one supplier quote may be awarded for a purchase requisition".into(),
                );
            }
        }
    }
    Ok(errors)
}
