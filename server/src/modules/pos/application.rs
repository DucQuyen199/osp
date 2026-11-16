//! POS product snapshot preparation.
use crate::money;
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// Snapshot the cash expected at close from the session opening float and its
/// completed/refunded cash orders. Called while the kernel holds the session row lock.
pub async fn prepare_action(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "pos_return" && action == "received" {
        let Some(order_id) = document
            .get("pos_order")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Phiếu trả hàng cần giao dịch POS gốc hợp lệ".into()]);
        };
        let Some(method) = document.get("method").and_then(Value::as_str) else {
            let method_row = tx
                .query_opt(
                    "SELECT method FROM pos__pos_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &order_id],
                )
                .await?;
            let method = method_row.and_then(|row| row.get::<_, Option<String>>(0));
            if method.as_deref() != Some("cash") {
                return Ok(Vec::new());
            }
            return prepare_refund_session(tx, tenant, document, order_id).await;
        };
        if method == "cash" {
            return prepare_refund_session(tx, tenant, document, order_id).await;
        }
        return Ok(Vec::new());
    }
    if entity == "pos_order" && action == "refunded" {
        if document.get("method").and_then(Value::as_str) != Some("cash") {
            return Ok(Vec::new());
        }
        let Some(original_session) = document
            .get("session")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Hoàn tiền mặt cần ca bán gốc hợp lệ".into()]);
        };
        let session = tx
            .query_opt(
                "SELECT current.id FROM pos__pos_session original JOIN pos__pos_session current ON current.tenant_id = original.tenant_id AND current.status = 'open' AND current.branch IS NOT DISTINCT FROM original.branch AND current.cashier IS NOT DISTINCT FROM original.cashier WHERE original.tenant_id = $1 AND original.id = $2 ORDER BY current.created_at DESC, current.id LIMIT 1 FOR UPDATE OF current",
                &[&tenant.id, &original_session],
            )
            .await?;
        let Some(session) = session else {
            return Ok(vec![
                "Hoàn tiền mặt cần một ca đang mở cùng chi nhánh và thu ngân với giao dịch bán gốc"
                    .into(),
            ]);
        };
        document.insert("refund_session".into(), json!(session.get::<_, Uuid>(0)));
        return Ok(Vec::new());
    }
    if entity != "pos_session" || action != "closed" {
        return Ok(Vec::new());
    }
    let Some(session_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Không xác định được ca POS cần đóng".into()]);
    };
    let opening_cash = document
        .get("opening_cash")
        .and_then(money::decimal)
        .unwrap_or_default();
    let row = tx
        .query_one_row(
            "SELECT (COALESCE((SELECT SUM(CASE WHEN status = 'completed' AND session = $2 THEN total::numeric WHEN status = 'refunded' AND refund_session = $2 THEN -total::numeric ELSE 0::numeric END) FROM pos__pos_order WHERE tenant_id = $1 AND method = 'cash' AND (session = $2 OR refund_session = $2)), 0::numeric) - COALESCE((SELECT SUM(total::numeric) FROM pos__pos_return WHERE tenant_id = $1 AND refund_session = $2 AND status = 'received'), 0::numeric) + COALESCE((SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'cash_in'), 0::numeric) - COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'cash_out'), 0::numeric) FROM pos__cash_movement WHERE tenant_id = $1 AND session = $2 AND status = 'posted'), 0::numeric))::text",
            &[
                &tenant.id as &(dyn tokio_postgres::types::ToSql + Sync),
                &session_id,
            ],
        )
        .await?;
    let cash_net_text: String = row.get(0);
    let Some(cash_net) = money::decimal_str(&cash_net_text) else {
        return Ok(vec!["POS cash movement total is invalid".into()]);
    };
    let Some(expected_cash) = opening_cash.checked_add(cash_net) else {
        return Ok(vec![
            "Expected POS cash exceeds the supported amount".into(),
        ]);
    };
    let counted_cash = document
        .get("closing_cash")
        .and_then(money::decimal)
        .unwrap_or_default();
    let Some(cash_difference) = counted_cash.checked_sub(expected_cash) else {
        return Ok(vec![
            "POS cash difference exceeds the supported amount".into(),
        ]);
    };
    let (Some(expected_cash), Some(cash_difference)) = (
        money::json_number(money::round_money(expected_cash)),
        money::json_number(money::round_money(cash_difference)),
    ) else {
        return Ok(vec!["POS cash total cannot be serialized".into()]);
    };
    document.insert("expected_cash".into(), expected_cash);
    document.insert("cash_difference".into(), cash_difference);
    Ok(Vec::new())
}

async fn prepare_refund_session(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
    order_id: Uuid,
) -> R<Vec<String>> {
    let row = tx
        .query_opt(
            "SELECT session FROM pos__pos_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        )
        .await?;
    let original_session = row.and_then(|row| row.get::<_, Option<Uuid>>(0));
    let Some(original_session) = original_session else {
        return Ok(vec!["Hoàn tiền mặt cần ca bán gốc hợp lệ".into()]);
    };
    let session = tx.query_opt(
        "SELECT current.id FROM pos__pos_session original JOIN pos__pos_session current ON current.tenant_id = original.tenant_id AND current.status = 'open' AND current.branch IS NOT DISTINCT FROM original.branch AND current.cashier IS NOT DISTINCT FROM original.cashier WHERE original.tenant_id = $1 AND original.id = $2 ORDER BY current.created_at DESC, current.id LIMIT 1 FOR UPDATE OF current",
        &[&tenant.id, &original_session],
    ).await?;
    let Some(session) = session else {
        return Ok(vec![
            "Hoàn tiền mặt cần ca đang mở cùng chi nhánh và thu ngân với giao dịch bán gốc".into(),
        ]);
    };
    document.insert("refund_session".into(), json!(session.get::<_, Uuid>(0)));
    Ok(Vec::new())
}

/// Replace return selections with immutable snapshots taken from the completed POS order.
pub async fn prepare_return_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(order_id) = document
        .get("pos_order")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Phiếu trả hàng cần giao dịch POS gốc hợp lệ".into()]);
    };
    let Some(order) = tx.query_opt(
        "SELECT lines, warehouse FROM pos__pos_order WHERE tenant_id = $1 AND id = $2 AND status = 'completed' FOR UPDATE",
        &[&tenant.id, &order_id],
    ).await? else {
        return Ok(vec!["Chỉ được trả hàng từ giao dịch POS đã hoàn tất".into()]);
    };
    let source_lines: Value = order.get(0);
    let warehouse: Option<Uuid> = order.get(1);
    if let Some(warehouse) = warehouse {
        document.insert("warehouse".into(), json!(warehouse));
    }
    let Some(source_lines) = source_lines.as_array() else {
        return Ok(vec!["Giao dịch POS gốc không có dòng hàng hợp lệ".into()]);
    };
    let Some(selected) = document.get("lines").and_then(Value::as_array) else {
        return Ok(vec!["Phiếu trả hàng cần chọn ít nhất một dòng hàng".into()]);
    };
    if selected.is_empty() {
        return Ok(vec!["Phiếu trả hàng cần chọn ít nhất một dòng hàng".into()]);
    }
    let return_id = document
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut errors = Vec::new();
    let mut returned = Vec::new();
    let mut total = Decimal::ZERO;
    let mut tax_total = Decimal::ZERO;
    let mut selected_quantities = std::collections::HashMap::<usize, Decimal>::new();
    for (index, selection) in selected.iter().enumerate() {
        let line_index = selection
            .get("line_index")
            .and_then(Value::as_u64)
            .map(|value| value as usize);
        let qty = selection
            .get("qty")
            .and_then(money::decimal)
            .filter(|value| *value > Decimal::ZERO);
        let (Some(line_index), Some(qty), Some(source)) = (
            line_index,
            qty,
            line_index.and_then(|value| source_lines.get(value)),
        ) else {
            errors.push(format!("Dòng trả hàng {} không hợp lệ", index + 1));
            continue;
        };
        let sold_qty = source
            .get("qty")
            .and_then(money::decimal)
            .unwrap_or_default();
        if sold_qty <= Decimal::ZERO || qty > sold_qty {
            errors.push(format!("Số lượng trả ở dòng {} vượt số đã bán", index + 1));
            continue;
        }
        if selected_quantities.contains_key(&line_index) {
            errors.push(format!("Dòng trả hàng {} bị lặp", index + 1));
            continue;
        }
        let prior = tx.query_opt(
            "SELECT COALESCE(SUM((item.line->>'qty')::numeric), 0)::text, COALESCE(SUM(COALESCE((item.line->>'discount_amount')::numeric, 0)), 0)::text, COALESCE(SUM(COALESCE((item.line->>'net_amount')::numeric, 0)), 0)::text, COALESCE(SUM(COALESCE((item.line->>'tax_amount')::numeric, 0)), 0)::text, COALESCE(SUM(COALESCE((item.line->>'line_total')::numeric, 0)), 0)::text, COALESCE(SUM(COALESCE((item.line->>'voucher_discount_amount')::numeric, 0)), 0)::text FROM pos__pos_return r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) AS item(line) WHERE r.tenant_id = $1 AND r.pos_order = $2 AND r.id <> NULLIF($3, '')::uuid AND r.status = 'received' AND (item.line->>'source_line_index')::int = $4",
            &[&tenant.id, &order_id, &return_id, &(line_index as i32)],
        ).await?;
        let prior = prior.as_ref();
        let prior_qty = prior
            .and_then(|row| row.get::<_, String>(0).parse::<Decimal>().ok())
            .unwrap_or_default();
        let cumulative_qty = prior_qty.checked_add(qty);
        if cumulative_qty.is_none_or(|amount| amount > sold_qty) {
            errors.push(format!(
                "Số lượng trả ở dòng {} vượt số lượng còn được trả",
                index + 1
            ));
            continue;
        }
        selected_quantities.insert(line_index, qty);
        let cumulative_qty = cumulative_qty.unwrap_or_default();
        let ratio = qty.checked_div(sold_qty).unwrap_or_default();
        let cumulative_ratio = cumulative_qty.checked_div(sold_qty).unwrap_or_default();
        let mut line = source.as_object().cloned().unwrap_or_default();
        let Some(base_qty) = source
            .get("base_qty")
            .and_then(money::decimal)
            .unwrap_or(sold_qty)
            .checked_mul(ratio)
        else {
            errors.push(format!(
                "Số lượng quy đổi ở dòng {} vượt giới hạn",
                index + 1
            ));
            continue;
        };
        line.insert("qty".into(), json!(qty));
        line.insert("base_qty".into(), json!(base_qty));
        line.insert("source_line_index".into(), json!(line_index));
        for (field, prior_index) in [
            ("discount_amount", 1),
            ("net_amount", 2),
            ("tax_amount", 3),
            ("line_total", 4),
            ("voucher_discount_amount", 5),
        ] {
            let Some(source_amount) = source.get(field).and_then(money::decimal) else {
                continue;
            };
            let target_amount = source_amount
                .checked_mul(cumulative_ratio)
                .map(money::round_money);
            let prior_amount = prior
                .and_then(|row| row.get::<_, String>(prior_index).parse::<Decimal>().ok())
                .unwrap_or_default();
            let amount = target_amount
                .and_then(|target| target.checked_sub(prior_amount))
                .filter(|value| *value >= Decimal::ZERO);
            let Some(amount) = amount else {
                errors.push(format!("Giá trị dòng {} vượt giới hạn", index + 1));
                continue;
            };
            line.insert(field.into(), json!(amount));
        }
        let line_total = line
            .get("line_total")
            .and_then(money::decimal)
            .unwrap_or_default();
        let line_tax = line
            .get("tax_amount")
            .and_then(money::decimal)
            .unwrap_or_default();
        let (Some(next_total), Some(next_tax)) = (
            total.checked_add(line_total),
            tax_total.checked_add(line_tax),
        ) else {
            errors.push("Tổng tiền phiếu trả vượt giới hạn".into());
            continue;
        };
        total = next_total;
        tax_total = next_tax;
        returned.push(Value::Object(line));
    }
    if !errors.is_empty() {
        return Ok(errors);
    }
    let (Some(total), Some(tax_total)) = (
        money::json_number(money::round_money(total)),
        money::json_number(money::round_money(tax_total)),
    ) else {
        return Ok(vec!["Tổng phiếu trả hàng vượt giới hạn".into()]);
    };
    document.insert("lines".into(), Value::Array(returned));
    document.insert("total".into(), total);
    document.insert("tax_total".into(), tax_total);
    Ok(Vec::new())
}

/// Capture product kind and stock tracking on POS lines before they become
/// immutable transaction records.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let is_open = document.get("status").and_then(Value::as_str) == Some("open");
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    let mut total = Decimal::ZERO;
    let mut tax_total = Decimal::ZERO;
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("POS line {} must be an object", index + 1));
            continue;
        };
        for field in ["base_qty", "uom_name", "uom_ratio", "base_uom"] {
            line.remove(field);
        }
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let product = tx
            .query_opt(
                "SELECT kind, tracked, active, price::text, tax, uom FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product_id],
            )
            .await?;
        let Some(product) = product else {
            errors.push(format!(
                "POS product on line {} was not found in this tenant",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let tracked: Option<bool> = product.get(1);
        let active: Option<bool> = product.get(2);
        let price_text: Option<String> = product.get(3);
        let tax_id: Option<Uuid> = product.get(4);
        let base_unit_id: Option<Uuid> = product.get(5);
        if active == Some(false) && is_open {
            errors.push(format!("POS product on line {} is inactive", index + 1));
        }
        let Some(price) = price_text
            .as_deref()
            .and_then(money::decimal_str)
            .filter(|price| *price >= Decimal::ZERO)
        else {
            errors.push(format!(
                "POS product on line {} needs a valid catalog selling price",
                index + 1
            ));
            continue;
        };
        let Some(qty) = line
            .get("qty")
            .and_then(money::decimal)
            .filter(|qty| *qty > Decimal::ZERO)
        else {
            errors.push(format!("POS line {} needs a positive quantity", index + 1));
            continue;
        };
        let selected_unit = match line.get("uom") {
            Some(Value::String(value)) => match Uuid::parse_str(value) {
                Ok(unit) => Some(unit),
                Err(_) => {
                    errors.push(format!(
                        "POS unit on line {} must be a valid reference",
                        index + 1
                    ));
                    continue;
                }
            },
            Some(value) if !value.is_null() => {
                errors.push(format!(
                    "POS unit on line {} must be a valid reference",
                    index + 1
                ));
                continue;
            }
            _ => None,
        };
        let unit = match crate::modules::master_data::unit_conversion::resolve(
            tx,
            tenant,
            product_id,
            selected_unit,
        )
        .await?
        {
            Ok(unit) => unit,
            Err(message) => {
                errors.push(format!("POS unit on line {}: {message}", index + 1));
                continue;
            }
        };
        let Some(base_qty) = unit.base_quantity(qty).and_then(money::json_number) else {
            errors.push(format!(
                "POS base quantity on line {} exceeds the supported range",
                index + 1
            ));
            continue;
        };
        let Some(unit_price) = price.checked_mul(unit.ratio) else {
            errors.push(format!(
                "POS price on line {} exceeds the supported range",
                index + 1
            ));
            continue;
        };
        let (tax_rate, tax_name) = if let Some(tax_id) = tax_id {
            let Some(tax) = tx
                .query_opt(
                    "SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &tax_id],
                )
                .await?
            else {
                errors.push(format!("POS tax on line {} was not found in this tenant", index + 1));
                continue;
            };
            let name: String = tax.get(0);
            let rate_text: String = tax.get(1);
            let Some(rate) = money::decimal_str(&rate_text)
                .filter(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(rate))
            else {
                errors.push(format!("POS tax rate on line {} is invalid", index + 1));
                continue;
            };
            (rate, Some(name))
        } else {
            (Decimal::ZERO, None)
        };
        let Some((discount, net, line_tax, line_total)) =
            money::line_amounts(qty, unit_price, Decimal::ZERO, tax_rate)
        else {
            errors.push(format!(
                "POS line {} exceeds supported amount limits",
                index + 1
            ));
            continue;
        };
        let (
            Some(price_value),
            Some(rate_value),
            Some(discount_value),
            Some(net_value),
            Some(tax_value),
            Some(total_value),
        ) = (
            money::json_number(unit_price),
            money::json_number(tax_rate),
            money::json_number(discount),
            money::json_number(net),
            money::json_number(line_tax),
            money::json_number(line_total),
        )
        else {
            errors.push(format!(
                "POS line {} amounts cannot be represented",
                index + 1
            ));
            continue;
        };
        for field in [
            "discount_amount",
            "net_amount",
            "tax_rate",
            "tax_name",
            "tax_amount",
            "line_total",
        ] {
            line.remove(field);
        }
        line.insert("price".into(), price_value);
        line.insert("base_qty".into(), base_qty);
        line.insert("uom_ratio".into(), json!(unit.ratio));
        if let Some(unit_id) = unit.unit_id {
            line.insert("uom".into(), json!(unit_id));
        }
        if let Some(unit_name) = unit.unit_name {
            line.insert("uom_name".into(), json!(unit_name));
        }
        if let Some(base_unit_id) = unit.base_unit_id.or(base_unit_id) {
            line.insert("base_uom".into(), json!(base_unit_id));
        }
        line.insert("discount_pct".into(), json!(0));
        line.insert("discount_amount".into(), discount_value);
        line.insert("net_amount".into(), net_value);
        line.insert("tax_rate".into(), rate_value);
        line.insert("tax_amount".into(), tax_value);
        line.insert("line_total".into(), total_value);
        if let Some(tax_id) = tax_id {
            line.insert("tax".into(), json!(tax_id));
        } else {
            line.remove("tax");
        }
        if let Some(tax_name) = tax_name {
            line.insert("tax_name".into(), json!(tax_name));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        line.insert("kind".into(), json!(kind));
        line.insert("tracked".into(), json!(tracked.unwrap_or(kind == "goods")));
        let Some(next_total) = total.checked_add(line_total) else {
            errors.push("POS order total exceeds the supported amount range".into());
            continue;
        };
        let Some(next_tax_total) = tax_total.checked_add(line_tax) else {
            errors.push("POS tax total exceeds the supported amount range".into());
            continue;
        };
        total = next_total;
        tax_total = next_tax_total;
    }
    let (Some(total), Some(tax_total)) = (money::json_number(total), money::json_number(tax_total))
    else {
        errors.push("POS order totals cannot be represented".into());
        return Ok(errors);
    };
    document.insert("total".into(), total.clone());
    document.insert("tax_total".into(), tax_total);
    if document.get("method").and_then(Value::as_str) == Some("cash") {
        if let Some(received) = document.get("cash_received").and_then(money::decimal) {
            let received = money::round_money(received);
            if let Some(received_json) = money::json_number(received) {
                document.insert("cash_received".into(), received_json);
            } else {
                errors.push("POS cash received cannot be serialized".into());
            }
            match received.checked_sub(money::decimal(&total).unwrap_or_default()) {
                Some(change) if change >= Decimal::ZERO => {
                    if let Some(change) = money::json_number(money::round_money(change)) {
                        document.insert("change_due".into(), change);
                    } else {
                        errors.push("POS change due cannot be serialized".into());
                    }
                }
                Some(_) => {
                    document.remove("change_due");
                }
                None => errors.push("POS change due exceeds the supported amount".into()),
            }
        } else {
            document.remove("change_due");
        }
    } else {
        document.remove("cash_received");
        document.insert("change_due".into(), json!(0));
    }
    Ok(errors)
}
