use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn round_currency(value: Decimal) -> Decimal {
    value.round_dp(2)
}

async fn supplier_invoice_currency_snapshot(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Map<String, Value>,
) -> R<(Uuid, Decimal, chrono::NaiveDate)> {
    let base_code = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let base = tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=$2 FOR SHARE",
            &[&tenant.id, &base_code],
        )
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "purchasing.supplier_invoice.currency",
                vec![format!(
                    "Tenant base currency {base_code} is missing from its currency catalog"
                )],
            )
        })?;
    let base_id: Uuid = base.get(0);
    let currency_id = match document.get("currency") {
        None | Some(Value::Null) => base_id,
        Some(Value::String(value)) => Uuid::parse_str(value).map_err(|_| {
            crate::error::ApiError::validation(
                "purchasing.supplier_invoice.currency",
                vec!["Supplier invoice currency must reference a valid tenant currency".into()],
            )
        })?,
        _ => {
            return Err(crate::error::ApiError::validation(
                "purchasing.supplier_invoice.currency",
                vec!["Supplier invoice currency must reference a valid tenant currency".into()],
            ));
        }
    };
    if tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            &[&tenant.id, &currency_id],
        )
        .await?
        .is_none()
    {
        return Err(crate::error::ApiError::validation(
            "purchasing.supplier_invoice.currency",
            vec!["Supplier invoice currency does not belong to this tenant".into()],
        ));
    }
    let issue_date = document
        .get("issue_date")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "purchasing.supplier_invoice.issue_date",
                vec!["Supplier invoice issue date must be valid before currency conversion".into()],
            )
        })?;
    let existing_snapshot = document
        .get("exchange_rate")
        .and_then(money::decimal)
        .filter(|rate| *rate > Decimal::ZERO)
        .zip(
            document
                .get("exchange_rate_date")
                .and_then(Value::as_str)
                .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()),
        );
    let (rate, rate_date) = if currency_id == base_id {
        (Decimal::ONE, issue_date)
    } else if let Some((rate, rate_date)) = existing_snapshot {
        (rate, rate_date)
    } else {
        let row = tx
            .query_opt(
                "SELECT rate::text, effective_date FROM master_data__currency_rate WHERE tenant_id=$1 AND from_currency=$2 AND to_currency=$3 AND effective_date<=$4 ORDER BY effective_date DESC,created_at DESC LIMIT 1 FOR SHARE",
                &[&tenant.id, &currency_id, &base_id, &issue_date],
            )
            .await?
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "purchasing.supplier_invoice.exchange_rate",
                    vec![format!("No exchange rate exists for this invoice currency on {issue_date}")],
                )
            })?;
        let rate: String = row.get(0);
        let rate = money::decimal_str(&rate).ok_or_else(|| {
            crate::error::ApiError::validation(
                "purchasing.supplier_invoice.exchange_rate",
                vec!["Supplier invoice exchange rate is invalid".into()],
            )
        })?;
        let rate_date: chrono::NaiveDate = row.get(1);
        (rate, rate_date)
    };
    if rate <= Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "purchasing.supplier_invoice.exchange_rate",
            vec!["Supplier invoice exchange rate must be greater than zero".into()],
        ));
    }
    Ok((currency_id, rate, rate_date))
}

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
        "rfq" | "purchase_order" | "purchase_receipt" | "purchase_return" | "supplier_invoice"
    ) {
        return Ok(Vec::new());
    }
    let lock = if lock_rows { " FOR SHARE" } else { "" };
    let (mut source_lines, source_department) = if matches!(
        entity,
        "purchase_return" | "purchase_receipt" | "supplier_invoice"
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
    if entity == "purchase_return"
        && let Some(invoice_id) = document
            .get("supplier_invoice")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    {
        let order_id = document
            .get("purchase_order")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let invoice = tx
            .query_opt(
                &format!("SELECT purchase_order, status, lines FROM purchasing__supplier_invoice WHERE tenant_id = $1 AND id = $2{lock}"),
                &[&tenant.id, &invoice_id],
            )
            .await?;
        let Some(invoice) = invoice else {
            return Ok(vec![
                "Hóa đơn nhà cung cấp không tồn tại trong doanh nghiệp".into(),
            ]);
        };
        let invoice_order: Uuid = invoice.get(0);
        let invoice_status: String = invoice.get(1);
        if Some(invoice_order) != order_id || invoice_status != "approved" {
            return Ok(vec![
                "Hóa đơn được chọn phải đã duyệt và thuộc cùng đơn mua".into(),
            ]);
        }
        let lines: Value = invoice.get(2);
        source_lines = lines.as_array().cloned().unwrap_or_default();
    }
    if matches!(entity, "purchase_return" | "supplier_invoice") {
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
    let mut net_total = Decimal::ZERO;
    let mut matched_net = Decimal::ZERO;
    let mut adjustment_net = Decimal::ZERO;
    let mut adjustment_tax = Decimal::ZERO;
    let mut supplier_invoice_base_net = None;
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
                "supplier_invoice" => {
                    line.get("order_price")
                        .and_then(money::decimal)
                        .or_else(|| line.get("po_price").and_then(money::decimal))
                        .or(unit_price)
                        .is_some_and(|price| {
                            source.get("price").and_then(money::decimal).is_some_and(
                                |source_price| {
                                    money::within_tolerance(source_price, price, Decimal::new(5, 3))
                                },
                            )
                        })
                }
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
                if entity == "purchase_return"
                    && let Some(po_price) = source.get("po_price")
                {
                    line.insert("po_price".into(), po_price.clone());
                }
            }
        }
        if matches!(entity, "purchase_receipt" | "supplier_invoice") {
            if let Some(source) = source_line {
                if entity == "supplier_invoice" {
                    if let Some(order_price) = source.get("price") {
                        line.insert("po_price".into(), order_price.clone());
                    }
                } else {
                    for field in ["tax", "tax_rate", "tax_name"] {
                        if let Some(value) = source.get(field) {
                            line.insert(field.into(), value.clone());
                        } else {
                            line.remove(field);
                        }
                    }
                }
            } else {
                let document_name = if entity == "supplier_invoice" {
                    "Supplier invoice"
                } else {
                    "Purchase receipt"
                };
                errors.push(format!(
                    "{document_name} line {} must identify a product and source-order price",
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
            "purchase_order" | "purchase_return" | "purchase_receipt" | "supplier_invoice"
        ) {
            let tax_rate = if entity == "supplier_invoice"
                && let Some(tax_id) = line.get("tax").and_then(Value::as_str)
            {
                let Some(tax_id) = Uuid::parse_str(tax_id).ok() else {
                    errors.push(format!("Tax on invoice line {} is invalid", index + 1));
                    continue;
                };
                let tax = tx.query_opt(
                    &format!("SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2{lock}"),
                    &[&tenant.id, &tax_id],
                ).await?;
                let Some(tax) = tax else {
                    errors.push(format!(
                        "Tax on invoice line {} does not belong to this tenant",
                        index + 1
                    ));
                    continue;
                };
                line.insert("tax_name".into(), json!(tax.get::<_, String>(0)));
                let Some(rate) = money::decimal_str(&tax.get::<_, String>(1)) else {
                    errors.push(format!("Tax rate on invoice line {} is invalid", index + 1));
                    continue;
                };
                if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate) {
                    errors.push(format!(
                        "Tax rate on invoice line {} must be between 0 and 100",
                        index + 1
                    ));
                    continue;
                }
                rate
            } else if entity == "supplier_invoice" {
                line.remove("tax");
                line.remove("tax_name");
                Decimal::ZERO
            } else if matches!(entity, "purchase_return" | "purchase_receipt") {
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
                net_total = net_total.checked_add(net).ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "purchasing.supplier_invoice.total",
                        vec!["Purchase invoice net amount exceeds the supported range".into()],
                    )
                })?;
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
                if entity == "supplier_invoice"
                    && let (Some(qty), Some(po_price)) = (
                        line.get("qty").and_then(money::decimal),
                        line.get("po_price").and_then(money::decimal),
                    )
                {
                    let line_match = qty.checked_mul(po_price).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "purchasing.supplier_invoice.matched_net",
                            vec!["Matched receipt value exceeds the supported range".into()],
                        )
                    })?;
                    matched_net = matched_net.checked_add(line_match).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "purchasing.supplier_invoice.matched_net",
                            vec!["Matched receipt value exceeds the supported range".into()],
                        )
                    })?;
                }
            }
        }
    }
    if entity == "supplier_invoice" {
        let adjustment_lines = document
            .entry("adjustments")
            .or_insert_with(|| Value::Array(Vec::new()));
        let Some(adjustment_lines) = adjustment_lines.as_array_mut() else {
            return Ok(vec!["Invoice adjustments must be an array".into()]);
        };
        for (index, line) in adjustment_lines.iter_mut().enumerate() {
            let Some(line) = line.as_object_mut() else {
                errors.push(format!(
                    "Invoice adjustment {} must be an object",
                    index + 1
                ));
                continue;
            };
            let kind = line
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let description = line
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let Some(amount) = line.get("amount").and_then(money::decimal) else {
                errors.push(format!(
                    "Invoice adjustment {} amount is invalid",
                    index + 1
                ));
                continue;
            };
            let account_code = line
                .get("account_code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !matches!(kind.as_str(), "charge" | "discount")
                || description.is_none()
                || amount <= Decimal::ZERO
            {
                errors.push(format!(
                    "Invoice adjustment {} needs a description, a positive amount, and charge/discount type",
                    index + 1
                ));
                continue;
            }
            if account_code != "632" {
                errors.push(format!(
                    "Invoice adjustment {} must post to purchase expense (632)",
                    index + 1
                ));
                continue;
            }
            let tax_rate = if let Some(tax_id) = line.get("tax").and_then(Value::as_str) {
                let Some(tax_id) = Uuid::parse_str(tax_id).ok() else {
                    errors.push(format!("Invoice adjustment {} tax is invalid", index + 1));
                    continue;
                };
                let tax = tx.query_opt(
                    &format!("SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2{lock}"),
                    &[&tenant.id, &tax_id],
                ).await?;
                let Some(tax) = tax else {
                    errors.push(format!(
                        "Invoice adjustment {} tax does not belong to this tenant",
                        index + 1
                    ));
                    continue;
                };
                let Some(rate) = money::decimal_str(&tax.get::<_, String>(1)) else {
                    errors.push(format!(
                        "Invoice adjustment {} tax rate is invalid",
                        index + 1
                    ));
                    continue;
                };
                if !(Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&rate) {
                    errors.push(format!(
                        "Invoice adjustment {} tax rate must be between 0 and 100",
                        index + 1
                    ));
                    continue;
                }
                line.insert("tax_name".into(), json!(tax.get::<_, String>(0)));
                rate
            } else {
                line.remove("tax_name");
                Decimal::ZERO
            };
            let Some((_, _, tax_amount, _)) =
                money::line_amounts(Decimal::ONE, amount, Decimal::ZERO, tax_rate)
            else {
                errors.push(format!(
                    "Invoice adjustment {} exceeds the supported amount range",
                    index + 1
                ));
                continue;
            };
            let sign = if kind == "discount" {
                Decimal::NEGATIVE_ONE
            } else {
                Decimal::ONE
            };
            let Some(signed_net) = amount.checked_mul(sign) else {
                errors.push(format!(
                    "Invoice adjustment {} exceeds the supported amount range",
                    index + 1
                ));
                continue;
            };
            let Some(signed_tax) = tax_amount.checked_mul(sign) else {
                errors.push(format!(
                    "Invoice adjustment {} tax exceeds the supported amount range",
                    index + 1
                ));
                continue;
            };
            let Some(next_adjustment_net) = adjustment_net.checked_add(signed_net) else {
                errors.push("Invoice adjustments exceed the supported net amount".into());
                continue;
            };
            let Some(next_adjustment_tax) = adjustment_tax.checked_add(signed_tax) else {
                errors.push("Invoice adjustment tax exceeds the supported amount".into());
                continue;
            };
            adjustment_net = next_adjustment_net;
            adjustment_tax = next_adjustment_tax;
            line.insert("tax_rate".into(), json!(tax_rate));
            if let (Some(amount_value), Some(tax_value)) =
                (money::json_number(amount), money::json_number(tax_amount))
            {
                line.insert("amount".into(), amount_value);
                line.insert("tax_amount".into(), tax_value);
            } else {
                errors.push(format!(
                    "Invoice adjustment {} cannot be serialized",
                    index + 1
                ));
            }
        }
        let Some(next_total) = total
            .checked_add(adjustment_net)
            .and_then(|value| value.checked_add(adjustment_tax))
        else {
            errors.push("Supplier invoice total exceeds the supported amount".into());
            return Ok(errors);
        };
        let (Some(next_tax_total), Some(next_net_total)) = (
            tax_total.checked_add(adjustment_tax),
            net_total.checked_add(adjustment_net),
        ) else {
            errors.push("Supplier invoice tax or net amount exceeds the supported range".into());
            return Ok(errors);
        };
        total = next_total;
        tax_total = next_tax_total;
        net_total = next_net_total;
        if let (Some(net_value), Some(tax_value)) = (
            money::json_number(adjustment_net),
            money::json_number(adjustment_tax),
        ) {
            document.insert("adjustment_net".into(), net_value);
            document.insert("adjustment_tax".into(), tax_value);
        } else {
            errors.push("Supplier invoice adjustments cannot be serialized".into());
        }
    }
    if entity == "supplier_invoice" {
        let (currency_id, exchange_rate, rate_date) =
            supplier_invoice_currency_snapshot(tx, tenant, document).await?;
        let base_total = total
            .checked_mul(exchange_rate)
            .map(round_currency)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "purchasing.supplier_invoice.base_total",
                    vec!["Converted supplier invoice total exceeds the supported range".into()],
                )
            })?;
        let base_tax_total = tax_total
            .checked_mul(exchange_rate)
            .map(round_currency)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "purchasing.supplier_invoice.base_tax_total",
                    vec!["Converted supplier invoice tax exceeds the supported range".into()],
                )
            })?;
        let base_net = base_total.checked_sub(base_tax_total).ok_or_else(|| {
            crate::error::ApiError::validation(
                "purchasing.supplier_invoice.base_total",
                vec!["Converted supplier invoice net exceeds the supported range".into()],
            )
        })?;
        let mut base_adjustment_net = Decimal::ZERO;
        let mut base_adjustment_tax = Decimal::ZERO;
        let (
            Some(exchange_rate_value),
            Some(base_total_value),
            Some(base_tax_value),
            Some(base_adjustment_net_value),
            Some(base_adjustment_tax_value),
        ) = (
            money::json_number(exchange_rate),
            money::json_number(base_total),
            money::json_number(base_tax_total),
            money::json_number(base_adjustment_net),
            money::json_number(base_adjustment_tax),
        )
        else {
            errors.push("Converted supplier invoice amounts cannot be serialized".into());
            return Ok(errors);
        };
        document.insert("currency".into(), json!(currency_id));
        document.insert("exchange_rate".into(), exchange_rate_value);
        document.insert("exchange_rate_date".into(), json!(rate_date.to_string()));
        document.insert("base_total".into(), base_total_value);
        document.insert("base_tax_total".into(), base_tax_value);
        document.insert("base_adjustment_net".into(), base_adjustment_net_value);
        document.insert("base_adjustment_tax".into(), base_adjustment_tax_value);
        if let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) {
            for line in lines.iter_mut().filter_map(Value::as_object_mut) {
                let Some(net) = line.get("net_amount").and_then(money::decimal) else {
                    continue;
                };
                let Some(base_net) = net.checked_mul(exchange_rate).map(round_currency) else {
                    errors
                        .push("Converted supplier invoice line exceeds the supported range".into());
                    continue;
                };
                if let Some(value) = money::json_number(base_net) {
                    line.insert("base_net_amount".into(), value);
                } else {
                    errors.push("Converted supplier invoice line cannot be serialized".into());
                }
            }
        }
        if let Some(adjustments) = document
            .get_mut("adjustments")
            .and_then(Value::as_array_mut)
        {
            for adjustment in adjustments.iter_mut().filter_map(Value::as_object_mut) {
                let kind = adjustment
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let sign = if kind == "discount" {
                    Decimal::NEGATIVE_ONE
                } else {
                    Decimal::ONE
                };
                for (source, target) in
                    [("amount", "base_amount"), ("tax_amount", "base_tax_amount")]
                {
                    let Some(amount) = adjustment.get(source).and_then(money::decimal) else {
                        continue;
                    };
                    let Some(base_amount) = amount.checked_mul(exchange_rate).map(round_currency)
                    else {
                        errors.push(
                            "Converted supplier invoice adjustment exceeds the supported range"
                                .into(),
                        );
                        continue;
                    };
                    if let Some(value) = money::json_number(base_amount) {
                        adjustment.insert(target.into(), value);
                        if source == "amount" {
                            base_adjustment_net = base_adjustment_net
                                .checked_add(base_amount.checked_mul(sign).ok_or_else(|| {
                                    crate::error::ApiError::validation(
                                        "purchasing.supplier_invoice.base_adjustment_net",
                                        vec!["Converted invoice adjustment exceeds the supported range".into()],
                                    )
                                })?)
                                .ok_or_else(|| {
                                    crate::error::ApiError::validation(
                                        "purchasing.supplier_invoice.base_adjustment_net",
                                        vec!["Converted invoice adjustment exceeds the supported range".into()],
                                    )
                                })?;
                        } else {
                            base_adjustment_tax = base_adjustment_tax
                                .checked_add(base_amount.checked_mul(sign).ok_or_else(|| {
                                    crate::error::ApiError::validation(
                                        "purchasing.supplier_invoice.base_adjustment_tax",
                                        vec!["Converted invoice adjustment tax exceeds the supported range".into()],
                                    )
                                })?)
                                .ok_or_else(|| {
                                    crate::error::ApiError::validation(
                                        "purchasing.supplier_invoice.base_adjustment_tax",
                                        vec!["Converted invoice adjustment tax exceeds the supported range".into()],
                                    )
                                })?;
                        }
                    } else {
                        errors.push(
                            "Converted supplier invoice adjustment cannot be serialized".into(),
                        );
                    }
                }
            }
        }
        let (Some(base_adjustment_net), Some(base_adjustment_tax)) = (
            money::json_number(base_adjustment_net),
            money::json_number(base_adjustment_tax),
        ) else {
            errors.push("Converted supplier invoice adjustments cannot be serialized".into());
            return Ok(errors);
        };
        document.insert("base_adjustment_net".into(), base_adjustment_net);
        document.insert("base_adjustment_tax".into(), base_adjustment_tax);
        supplier_invoice_base_net = Some(base_net);
    }
    if matches!(
        entity,
        "purchase_order" | "purchase_return" | "purchase_receipt" | "supplier_invoice"
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
    if entity == "supplier_invoice" {
        let variance = supplier_invoice_base_net
            .unwrap_or(net_total)
            .checked_sub(matched_net)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    "purchasing.supplier_invoice.price_variance",
                    vec!["Purchase price variance exceeds the supported range".into()],
                )
            })?;
        if let (Some(matched), Some(variance)) = (
            money::json_number(matched_net),
            money::json_number(variance),
        ) {
            document.insert("matched_net".into(), matched);
            document.insert("price_variance".into(), variance);
        } else {
            errors.push("Purchase invoice matched value cannot be serialized".into());
        }
    }
    Ok(errors)
}
