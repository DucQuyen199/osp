//! Server-side snapshots and totals for quotation, order, and return documents.
use super::pricing;
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    prepare_document_with_lock(tx, tenant, entity, document, true).await
}

pub async fn preview_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    prepare_document_with_lock(tx, tenant, entity, document, false).await
}

async fn prepare_document_with_lock(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
    lock_rows: bool,
) -> R<Vec<String>> {
    if !matches!(entity, "quotation" | "sales_order" | "sales_return") {
        return Ok(Vec::new());
    }
    let lock = if lock_rows { " FOR SHARE" } else { "" };
    let source_lines = if entity == "sales_return" {
        let Some(order_id) = document
            .get("sales_order")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Phiếu trả cần tham chiếu đơn bán hợp lệ".into()]);
        };
        tx.query_opt(
            &format!("SELECT lines FROM sales__sales_order WHERE tenant_id = $1 AND id = $2{lock}"),
            &[&tenant.id, &order_id],
        )
        .await?
        .map(|row| row.get::<_, Value>(0))
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let price_list_items = if matches!(entity, "quotation" | "sales_order") {
        if let Some(price_list_id) = document
            .get("price_list")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            tx.query_opt(
                &format!(
                    "SELECT items FROM sales__price_list WHERE tenant_id = $1 AND id = $2{lock}"
                ),
                &[&tenant.id, &price_list_id],
            )
            .await?
            .map(|row| row.get::<_, Value>(0))
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line_map) = line.as_object_mut() else {
            errors.push(format!("lines[{}] phải là một dòng hàng", index + 1));
            continue;
        };
        // Calculated amounts are rebuilt on every write; never trust JSON from a client.
        for field in [
            "discount_amount",
            "net_amount",
            "tax_rate",
            "tax_name",
            "tax_amount",
            "line_total",
        ] {
            line_map.remove(field);
        }
        let Some(product) = line_map
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let original = source_lines.iter().find(|source| {
            source.get("product").and_then(Value::as_str) == Some(product.to_string().as_str())
                && match (
                    source.get("price").and_then(money::decimal),
                    line_map.get("price").and_then(money::decimal),
                ) {
                    (Some(source_price), Some(price)) => {
                        money::within_tolerance(source_price, price, Decimal::new(5, 3))
                    }
                    _ => true,
                }
        });
        let snapshot = original.and_then(|source| {
            source
                .get("tracked")
                .and_then(Value::as_bool)
                .zip(source.get("kind").and_then(Value::as_str))
                .map(|(tracked, kind)| (tracked, kind.to_string()))
        });
        let (tracked, kind, default_price, default_tax) = if let Some(snapshot) = snapshot {
            (snapshot.0, snapshot.1, None, None)
        } else {
            let row = tx
                .query_opt(
                    &format!("SELECT kind, tracked, active, price::text, tax FROM master_data__product WHERE tenant_id = $1 AND id = $2{lock}"),
                    &[&tenant.id, &product],
                )
                .await?;
            let Some(row) = row else {
                errors.push(format!(
                    "Không tìm thấy sản phẩm ở dòng {} trong doanh nghiệp",
                    index + 1
                ));
                continue;
            };
            let kind: Option<String> = row.get(0);
            let tracked: Option<bool> = row.get(1);
            let active: Option<bool> = row.get(2);
            let default_price: Option<Decimal> = row
                .get::<_, Option<String>>(3)
                .and_then(|price| money::decimal_str(&price));
            let default_tax: Option<Uuid> = row.get(4);
            let kind = kind.unwrap_or_else(|| "goods".into());
            if entity != "sales_return" && active == Some(false) {
                errors.push(format!("Sản phẩm ở dòng {} đã ngừng hoạt động", index + 1));
            }
            let tracked = tracked.unwrap_or(kind == "goods");
            (tracked, kind, default_price, default_tax)
        };
        line_map.insert("kind".into(), json!(kind));
        line_map.insert("tracked".into(), json!(tracked));
        if entity == "sales_return" {
            let discount = original
                .and_then(|source| source.get("discount_pct"))
                .and_then(money::decimal)
                .unwrap_or_default();
            let Some(discount) = money::json_number(discount) else {
                errors.push(format!(
                    "lines[{}].discount_pct cannot be serialized",
                    index + 1
                ));
                continue;
            };
            line_map.insert("discount_pct".into(), discount);
            if let Some(source) = original {
                if let Some(tax) = source.get("tax") {
                    line_map.insert("tax".into(), tax.clone());
                } else {
                    line_map.remove("tax");
                }
                if let Some(rate) = source.get("tax_rate") {
                    line_map.insert("tax_rate".into(), rate.clone());
                }
                if let Some(name) = source.get("tax_name") {
                    line_map.insert("tax_name".into(), name.clone());
                }
            } else {
                line_map.remove("tax");
                line_map.remove("tax_rate");
                line_map.remove("tax_name");
            }
        } else if !line_map.contains_key("discount_pct") {
            line_map.insert("discount_pct".into(), json!(0));
        }
        if entity != "sales_return" && line_map.get("tax").is_none() {
            if let Some(default_tax) = default_tax {
                line_map.insert("tax".into(), json!(default_tax));
            }
        }
        let (tax_rate, tax_name) = if entity == "sales_return" {
            (
                line_map
                    .get("tax_rate")
                    .and_then(money::decimal)
                    .unwrap_or_default(),
                line_map
                    .get("tax_name")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            )
        } else if let Some(tax_id) = line_map.get("tax").and_then(Value::as_str) {
            let Some(tax_id) = Uuid::parse_str(tax_id).ok() else {
                errors.push(format!(
                    "lines[{}].tax must be a valid tax reference",
                    index + 1
                ));
                continue;
            };
            let tax = tx.query_opt(
                &format!("SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2{lock}"),
                &[&tenant.id, &tax_id],
            ).await?;
            let Some(tax) = tax else {
                errors.push(format!(
                    "Tax selected on line {} does not exist in this tenant",
                    index + 1
                ));
                continue;
            };
            let name: String = tax.get(0);
            let rate_text: String = tax.get(1);
            let Some(rate) = money::decimal_str(&rate_text) else {
                errors.push(format!(
                    "Tax rate on line {} is not a valid decimal number",
                    index + 1
                ));
                continue;
            };
            if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate) {
                errors.push(format!(
                    "Tax rate on line {} must be between 0 and 100",
                    index + 1
                ));
                continue;
            }
            (rate, Some(name))
        } else {
            line_map.remove("tax");
            (Decimal::ZERO, None)
        };
        if matches!(entity, "quotation" | "sales_order")
            && line_map.get("price").and_then(money::decimal).is_none()
        {
            let list_price = price_list_items.iter().find_map(|item| {
                (item.get("product").and_then(Value::as_str) == Some(product.to_string().as_str()))
                    .then(|| item.get("price").and_then(money::decimal))
                    .flatten()
            });
            if let Some(price) = list_price.or(default_price) {
                if price >= Decimal::ZERO {
                    if let Some(price) = money::json_number(price) {
                        line_map.insert("price".into(), price);
                    } else {
                        errors.push(format!("Price on line {} cannot be serialized", index + 1));
                    }
                }
            }
        }
        if let Some(value) = money::json_number(tax_rate) {
            line_map.insert("tax_rate".into(), value);
        } else {
            errors.push(format!(
                "Tax rate on line {} cannot be represented",
                index + 1
            ));
        }
        if let Some(name) = tax_name {
            line_map.insert("tax_name".into(), json!(name));
        }
    }
    if errors.is_empty() {
        errors.extend(pricing::recalculate_lines(document));
    }
    Ok(errors)
}
