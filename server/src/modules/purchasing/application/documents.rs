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
    if entity == "supplier_invoice"
        && let Some(invoice_number) = document
            .get("invoice_number")
            .and_then(Value::as_str)
            .map(str::trim)
    {
        document.insert(
            "invoice_number".into(),
            Value::String(invoice_number.to_owned()),
        );
    }
    if !matches!(
        entity,
        "rfq" | "purchase_order" | "purchase_receipt" | "purchase_return"
    ) {
        return Ok(Vec::new());
    }
    let lock = if lock_rows { " FOR SHARE" } else { "" };
    let (source_lines, source_department) = if matches!(
        entity,
        "purchase_return" | "purchase_receipt"
    ) {
        let Some(order_id) = document
            .get("purchase_order")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Phiếu trả cần tham chiếu đơn mua hợp lệ".into()]);
        };
        let source = tx.query_opt(
            &format!("SELECT lines, department FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2{lock}"),
            &[&tenant.id, &order_id],
        )
        .await?;
        source.map_or_else(
            || (Vec::new(), None),
            |row| {
                let lines: Value = row.get(0);
                let department: Option<Uuid> = row.get(1);
                (lines.as_array().cloned().unwrap_or_default(), department)
            },
        )
    } else {
        (Vec::new(), None)
    };
    if entity == "purchase_return" {
        if let Some(department) = source_department {
            document.insert("department".into(), json!(department));
        } else {
            document.remove("department");
        }
    }
    let inspection_lot = if entity == "purchase_return" {
        document
            .get("inspection")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    } else {
        None
    };
    let inspection_lot = if let Some(inspection_id) = inspection_lot {
        tx.query_opt(
            &format!("SELECT product, lot FROM quality__inspection WHERE tenant_id = $1 AND id = $2{lock}"),
            &[&tenant.id, &inspection_id],
        )
        .await?
        .map(|row| (row.get::<_, Uuid>(0), row.get::<_, Option<Uuid>>(1)))
    } else {
        None
    };
    let editable = matches!(
        document.get("status").and_then(Value::as_str),
        Some("draft" | "rejected")
    );
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    let mut total = Decimal::ZERO;
    let mut tax_total = Decimal::ZERO;
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("lines[{}] phải là một dòng hàng", index + 1));
            continue;
        };
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        if editable {
            if let Some(lot_id) = line
                .get("lot")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            {
                if tx
                    .query_opt(
                        &format!("SELECT id FROM inventory__lot WHERE tenant_id = $1 AND id = $2 AND product = $3{lock}"),
                        &[&tenant.id, &lot_id, &product_id],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!(
                        "Lot on purchase line {} must belong to the selected product and tenant",
                        index + 1
                    ));
                }
            }
        }
        if let Some((inspected_product, inspected_lot)) = inspection_lot {
            if product_id == inspected_product {
                if let Some(lot) = inspected_lot {
                    line.insert("lot".into(), json!(lot));
                } else {
                    line.remove("lot");
                }
            }
        }
        let unit_price = line.get("price").and_then(money::decimal);
        let source_line = source_lines.iter().find(|source| {
            let matches_price = match entity {
                "purchase_return" => unit_price.is_none_or(|price| {
                    source
                        .get("price")
                        .and_then(money::decimal)
                        .is_some_and(|source_price| {
                            money::within_tolerance(source_price, price, Decimal::new(5, 3))
                        })
                }),
                "purchase_receipt" => unit_price.is_some_and(|price| {
                    source
                        .get("price")
                        .and_then(money::decimal)
                        .is_some_and(|source_price| {
                            money::within_tolerance(source_price, price, Decimal::new(5, 3))
                        })
                }),
                _ => true,
            };
            source.get("product").and_then(Value::as_str) == Some(product_id.to_string().as_str())
                && matches_price
        });
        if entity == "purchase_return" {
            if unit_price.is_some() && source_line.is_none() {
                errors.push(format!(
                    "Purchase return line {} must match a product and unit price from its source order",
                    index + 1
                ));
                continue;
            }
            if let Some(source) = source_line {
                for field in ["tax", "tax_rate", "tax_name"] {
                    if let Some(value) = source.get(field) {
                        line.insert(field.into(), value.clone());
                    } else {
                        line.remove(field);
                    }
                }
            }
        }
        if entity == "purchase_receipt" {
            if let Some(source) = source_line {
                for field in ["tax", "tax_rate", "tax_name"] {
                    if let Some(value) = source.get(field) {
                        line.insert(field.into(), value.clone());
                    } else {
                        line.remove(field);
                    }
                }
            } else {
                errors.push(format!(
                    "Purchase receipt line {} must match a product from its source order",
                    index + 1
                ));
                continue;
            }
        }
        let snapshot = source_line.and_then(|source| {
            source
                .get("tracked")
                .and_then(Value::as_bool)
                .zip(source.get("kind").and_then(Value::as_str))
                .map(|(tracked, kind)| (tracked, kind.to_string()))
        });
        let (tracked, kind) = if let Some(snapshot) = snapshot {
            snapshot
        } else {
            let product = tx.query_opt(
                &format!("SELECT kind, tracked, active FROM master_data__product WHERE tenant_id = $1 AND id = $2{lock}"),
                &[&tenant.id, &product_id],
            ).await?;
            let Some(product) = product else {
                errors.push(format!(
                    "Không tìm thấy sản phẩm ở dòng {} trong doanh nghiệp",
                    index + 1
                ));
                continue;
            };
            let kind: Option<String> = product.get(0);
            let tracked: Option<bool> = product.get(1);
            let active: Option<bool> = product.get(2);
            if editable && active == Some(false) {
                errors.push(format!("Sản phẩm ở dòng {} đã ngừng hoạt động", index + 1));
            }
            let kind = kind.unwrap_or_else(|| "goods".into());
            (tracked.unwrap_or(kind == "goods"), kind)
        };
        line.insert("tracked".into(), json!(tracked));
        line.insert("kind".into(), json!(kind));

        if matches!(
            entity,
            "purchase_order" | "purchase_return" | "purchase_receipt"
        ) {
            let tax_rate = if matches!(entity, "purchase_return" | "purchase_receipt") {
                let rate = line
                    .get("tax_rate")
                    .and_then(money::decimal)
                    .unwrap_or_default();
                if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate) {
                    errors.push(format!(
                        "Tax rate on purchase line {} must be between 0 and 100",
                        index + 1
                    ));
                    continue;
                }
                rate
            } else if let Some(tax_id) = line.get("tax").and_then(Value::as_str) {
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
                        "Tax selected on purchase line {} does not exist in this tenant",
                        index + 1
                    ));
                    continue;
                };
                line.insert("tax_name".into(), json!(tax.get::<_, String>(0)));
                let rate_text: String = tax.get(1);
                let Some(rate) = money::decimal_str(&rate_text) else {
                    errors.push(format!(
                        "Tax rate on purchase line {} is invalid",
                        index + 1
                    ));
                    continue;
                };
                if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate) {
                    errors.push(format!(
                        "Tax rate on purchase line {} must be between 0 and 100",
                        index + 1
                    ));
                    continue;
                }
                rate
            } else {
                line.remove("tax");
                line.remove("tax_name");
                Decimal::ZERO
            };
            if let (Some(qty), Some(price)) = (
                line.get("qty").and_then(money::decimal),
                line.get("price").and_then(money::decimal),
            ) {
                let Some((_, net, tax, line_total)) =
                    money::line_amounts(qty, price, Decimal::ZERO, tax_rate)
                else {
                    errors.push(format!(
                        "Purchase line {} has values outside supported financial limits",
                        index + 1
                    ));
                    continue;
                };
                let (Some(next_total), Some(next_tax_total)) =
                    (total.checked_add(line_total), tax_total.checked_add(tax))
                else {
                    errors
                        .push("Purchase document totals exceed supported financial limits".into());
                    continue;
                };
                let (Some(net), Some(tax), Some(line_total), Some(rate)) = (
                    money::json_number(net),
                    money::json_number(tax),
                    money::json_number(line_total),
                    money::json_number(tax_rate),
                ) else {
                    errors.push(format!(
                        "Purchase line {} values cannot be serialized",
                        index + 1
                    ));
                    continue;
                };
                line.insert("net_amount".into(), net);
                line.insert("tax_rate".into(), rate);
                line.insert("tax_amount".into(), tax);
                line.insert("line_total".into(), line_total);
                total = next_total;
                tax_total = next_tax_total;
            }
        }
    }
    if matches!(
        entity,
        "purchase_order" | "purchase_return" | "purchase_receipt"
    ) {
        if let (Some(total), Some(tax_total)) =
            (money::json_number(total), money::json_number(tax_total))
        {
            document.insert("total".into(), total);
            document.insert("tax_total".into(), tax_total);
        } else {
            errors.push("Purchase document totals cannot be serialized".into());
        }
    }
    Ok(errors)
}
