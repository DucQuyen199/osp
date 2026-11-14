//! Restaurant order intake and recipe-based consumption preparation.
use crate::money;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type == "restaurant.table_order.cancelled" {
        let order_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Cancelled order requires a valid id".into()],
                )
            })?;
        let tickets = tx.query(
            "SELECT id FROM restaurant__kitchen_ticket WHERE tenant_id = $1 AND \"order\" = $2 AND status = 'queued' FOR UPDATE",
            &[&tenant.id, &order_id],
        ).await?;
        let ticket_entity = kernel.ent(tenant, "restaurant.kitchen_ticket")?;
        let opts = Opts {
            depth: Some(depth + 1),
            causation: Some(event_id),
            silent: false,
        };
        for ticket in tickets {
            let ticket_id: Uuid = ticket.get(0);
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &ticket_entity,
                    &ticket_id.to_string(),
                    "cancelled",
                    &opts,
                )
                .await?;
        }
        return Ok(true);
    }
    if event_type != "restaurant.table_order.sent" {
        return Ok(false);
    }
    let order_uuid = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Kitchen ticket source order id must be a valid UUID".into()],
            )
        })?;
    let Some(lines) = document.get("lines").and_then(Value::as_array) else {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Kitchen ticket source order requires lines".into()],
        ));
    };
    let mut station_lines: BTreeMap<&'static str, Vec<Value>> = BTreeMap::new();
    for line in lines {
        let Some(product) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Err(crate::error::ApiError::validation(
                event_type,
                vec!["Kitchen ticket order line has an invalid product".into()],
            ));
        };
        let station = tx
            .query_opt(
                "SELECT station FROM restaurant__menu_item WHERE tenant_id = $1 AND product = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &product],
            )
            .await?
            .and_then(|row| row.get::<_, Option<String>>(0))
            .filter(|station| station == "bar")
            .map(|_| "bar")
            .unwrap_or("kitchen");
        station_lines.entry(station).or_default().push(line.clone());
    }
    let entity = kernel.ent(tenant, "restaurant.kitchen_ticket")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    for (station, station_lines) in station_lines {
        let mut data = Map::new();
        data.insert("order".into(), json!(order_uuid));
        data.insert("station".into(), json!(station));
        data.insert("lines".into(), Value::Array(station_lines));
        kernel
            .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
            .await?;
    }
    Ok(true)
}

/// Build a server-owned snapshot of the ingredients to consume. Recipe
/// quantities are per `output_qty` portions; a menu item without a recipe
/// consumes its own tracked product quantity.
pub async fn prepare_order(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
    refresh: bool,
) -> R<Vec<String>> {
    if document
        .get("table")
        .and_then(Value::as_str)
        .is_some_and(|table| !table.is_empty())
    {
        document.entry("guest_count").or_insert(json!(1));
    }
    let mut price_errors = Vec::new();
    if refresh {
        if let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) {
            let mut order_total = Decimal::ZERO;
            let mut tax_total = Decimal::ZERO;
            for (index, line) in lines.iter_mut().enumerate() {
                let prefix = format!("Món ở dòng {}", index + 1);
                let Some(line) = line.as_object_mut() else {
                    price_errors.push(format!("{prefix} không hợp lệ"));
                    continue;
                };
                let Some(product_id) = line
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    price_errors.push(format!("{prefix} cần sản phẩm hợp lệ"));
                    continue;
                };
                if !line
                    .get("qty")
                    .and_then(money::decimal)
                    .is_some_and(|qty| qty > Decimal::ZERO)
                {
                    price_errors.push(format!("{prefix} cần số lượng lớn hơn 0"));
                    continue;
                }
                let Some(menu_item) = tx
                    .query_opt(
                        "SELECT available FROM restaurant__menu_item WHERE tenant_id = $1 AND product = $2 LIMIT 1 FOR SHARE",
                        &[&tenant.id, &product_id],
                    )
                    .await?
                else {
                    price_errors.push(format!("{prefix} chưa được khai báo trong thực đơn"));
                    continue;
                };
                if menu_item.get::<_, Option<bool>>(0) == Some(false) {
                    price_errors.push(format!("{prefix} hiện không được bán"));
                    continue;
                }
                let Some(product) = tx
                    .query_opt(
                        "SELECT price::text, active, name, tax FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &product_id],
                    )
                    .await?
                else {
                    price_errors.push(format!("{prefix} không tồn tại trong doanh nghiệp"));
                    continue;
                };
                if product.get::<_, Option<bool>>(1) == Some(false) {
                    price_errors.push(format!("{prefix} đã ngừng kinh doanh"));
                    continue;
                }
                let price_text: Option<String> = product.get(0);
                let Some(price) = price_text
                    .as_deref()
                    .and_then(money::decimal_str)
                    .filter(|price| *price >= Decimal::ZERO)
                else {
                    price_errors.push(format!("{prefix} chưa có đơn giá hợp lệ"));
                    continue;
                };
                let name: String = product.get(2);
                let tax_id: Option<Uuid> = product.get(3);
                let (tax_rate, tax_name) = if let Some(tax_id) = tax_id {
                    let Some(tax) = tx
                        .query_opt(
                            "SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &tax_id],
                        )
                        .await?
                    else {
                        price_errors.push(format!("{prefix}: tax is missing from this tenant"));
                        continue;
                    };
                    let name: String = tax.get(0);
                    let rate_text: String = tax.get(1);
                    let Some(rate) = money::decimal_str(&rate_text)
                        .filter(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(rate))
                    else {
                        price_errors.push(format!("{prefix}: tax rate is invalid"));
                        continue;
                    };
                    (rate, Some(name))
                } else {
                    (Decimal::ZERO, None)
                };
                let qty = line.get("qty").and_then(money::decimal).unwrap_or_default();
                let Some((discount, net, line_tax, line_total)) =
                    money::line_amounts(qty, price, Decimal::ZERO, tax_rate)
                else {
                    price_errors.push(format!("{prefix}: amount exceeds supported limits"));
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
                    money::json_number(price),
                    money::json_number(tax_rate),
                    money::json_number(discount),
                    money::json_number(net),
                    money::json_number(line_tax),
                    money::json_number(line_total),
                )
                else {
                    price_errors.push(format!("{prefix}: amounts cannot be represented"));
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
                line.insert("product_name".into(), Value::String(name));
                line.insert("discount_pct".into(), Value::from(0));
                line.insert("discount_amount".into(), discount_value);
                line.insert("net_amount".into(), net_value);
                line.insert("tax_rate".into(), rate_value);
                line.insert("tax_amount".into(), tax_value);
                line.insert("line_total".into(), total_value);
                if let Some(tax_id) = tax_id {
                    line.insert("tax".into(), Value::String(tax_id.to_string()));
                } else {
                    line.remove("tax");
                }
                if let Some(tax_name) = tax_name {
                    line.insert("tax_name".into(), Value::String(tax_name));
                }
                let Some(next_total) = order_total.checked_add(line_total) else {
                    price_errors.push("Order total exceeds supported limits".into());
                    continue;
                };
                let Some(next_tax) = tax_total.checked_add(line_tax) else {
                    price_errors.push("Order tax exceeds supported limits".into());
                    continue;
                };
                order_total = next_total;
                tax_total = next_tax;
            }
            if price_errors.is_empty() {
                if let (Some(total), Some(tax)) = (
                    money::json_number(order_total),
                    money::json_number(tax_total),
                ) {
                    document.insert("total".into(), total);
                    document.insert("tax_total".into(), tax);
                } else {
                    price_errors.push("Order total cannot be represented".into());
                }
            }
        }
    }
    if !price_errors.is_empty() {
        return Ok(price_errors);
    }
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        let Some(total) = restaurant_total(lines).and_then(money::json_number) else {
            document.remove("total");
            return Ok(vec!["Tổng tiền đơn nhà hàng không hợp lệ".into()]);
        };
        document.insert("total".into(), total);
    }
    if !refresh
        && document
            .get("consumptions")
            .and_then(Value::as_array)
            .is_some()
    {
        return Ok(Vec::new());
    }
    let Some(lines) = document.get("lines").and_then(Value::as_array).cloned() else {
        return Ok(Vec::new());
    };
    let editable = matches!(
        document.get("status").and_then(Value::as_str),
        Some("open") | None
    );
    let mut consumptions = Vec::new();
    let mut errors = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let Some(order_qty) = line.get("qty").and_then(money::decimal) else {
            errors.push(format!("Số lượng món ở dòng {} không hợp lệ", index + 1));
            continue;
        };
        if order_qty <= Decimal::ZERO {
            errors.push(format!("Số lượng món ở dòng {} phải lớn hơn 0", index + 1));
            continue;
        }
        if let Some(menu_item) = tx.query_opt(
            "SELECT available FROM restaurant__menu_item WHERE tenant_id = $1 AND product = $2 LIMIT 1 FOR SHARE",
            &[&tenant.id, &product_id],
        ).await? {
            let available: Option<bool> = menu_item.get(0);
            if editable && available == Some(false) {
                errors.push(format!("Món ở dòng {} hiện không được bán", index + 1));
                continue;
            }
        }
        let recipe = tx
            .query_opt(
                "SELECT ingredients, output_qty::text FROM restaurant__recipe WHERE tenant_id = $1 AND product = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &product_id],
            )
            .await?;
        if let Some(recipe) = recipe {
            let ingredients: Value = recipe.get(0);
            let output_qty_text: Option<String> = recipe.get(1);
            let output_qty = match output_qty_text.as_deref() {
                Some(value) => money::decimal_str(value).ok_or_else(|| {
                    ApiError::validation(
                        "restaurant.recipe.output_qty",
                        vec!["Stored recipe output quantity is not a valid decimal".into()],
                    )
                })?,
                None => Decimal::ONE,
            };
            if output_qty <= Decimal::ZERO {
                errors.push(format!(
                    "Công thức món ở dòng {} cần output_qty lớn hơn 0",
                    index + 1
                ));
                continue;
            }
            let Some(ingredients) = ingredients.as_array() else {
                errors.push(format!(
                    "Công thức món ở dòng {} cần danh sách nguyên liệu",
                    index + 1
                ));
                continue;
            };
            for (ingredient_index, ingredient) in ingredients.iter().enumerate() {
                let Some(ingredient_id) = ingredient
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    errors.push(format!(
                        "Công thức dòng {} có nguyên liệu {} không hợp lệ",
                        index + 1,
                        ingredient_index + 1
                    ));
                    continue;
                };
                let Some(qty) = ingredient.get("qty").and_then(money::decimal) else {
                    errors.push(format!(
                        "Công thức dòng {} có lượng nguyên liệu {} không hợp lệ",
                        index + 1,
                        ingredient_index + 1
                    ));
                    continue;
                };
                if qty <= Decimal::ZERO {
                    errors.push(format!(
                        "Công thức dòng {} có lượng nguyên liệu {} không hợp lệ",
                        index + 1,
                        ingredient_index + 1
                    ));
                    continue;
                }
                let Some(consumption_qty) = qty
                    .checked_mul(order_qty)
                    .and_then(|quantity| quantity.checked_div(output_qty))
                else {
                    errors.push(format!(
                        "Lượng xuất kho tính cho món ở dòng {} vượt giới hạn Decimal",
                        index + 1
                    ));
                    continue;
                };
                append_tracked_product(
                    tx,
                    tenant,
                    ingredient_id,
                    consumption_qty,
                    editable,
                    index + 1,
                    &mut consumptions,
                    &mut errors,
                )
                .await?;
            }
        } else {
            append_tracked_product(
                tx,
                tenant,
                product_id,
                order_qty,
                editable,
                index + 1,
                &mut consumptions,
                &mut errors,
            )
            .await?;
        }
    }
    document.insert("consumptions".into(), Value::Array(consumptions));
    Ok(errors)
}

fn restaurant_total(lines: &[Value]) -> Option<Decimal> {
    lines.iter().try_fold(Decimal::ZERO, |total, line| {
        let line_total = line
            .get("line_total")
            .and_then(money::decimal)
            .or_else(|| {
                let qty = line.get("qty").and_then(money::decimal)?;
                let price = line.get("price").and_then(money::decimal)?;
                money::amount(qty, price)
            })?;
        total.checked_add(line_total)
    })
}

async fn append_tracked_product(
    tx: &Tx<'_>,
    tenant: &Tenant,
    product_id: Uuid,
    qty: Decimal,
    editable: bool,
    order_line: usize,
    consumptions: &mut Vec<Value>,
    errors: &mut Vec<String>,
) -> R<()> {
    if qty <= Decimal::ZERO {
        errors.push(format!(
            "Lượng xuất kho tính cho món ở dòng {} không hợp lệ",
            order_line
        ));
        return Ok(());
    }
    let row = tx
        .query_opt(
            "SELECT kind, tracked, active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        )
        .await?;
    let Some(row) = row else {
        errors.push(format!(
            "Không tìm thấy sản phẩm/nguyên liệu cho món ở dòng {}",
            order_line
        ));
        return Ok(());
    };
    let kind: Option<String> = row.get(0);
    let tracked: Option<bool> = row.get(1);
    let active: Option<bool> = row.get(2);
    if editable && active == Some(false) {
        errors.push(format!(
            "Sản phẩm/nguyên liệu cho món ở dòng {} đã ngừng hoạt động",
            order_line
        ));
    }
    let kind = kind.unwrap_or_else(|| "goods".into());
    let tracked = tracked.unwrap_or(kind == "goods");
    if tracked {
        let qty_value = money::json_number(qty).ok_or_else(|| {
            ApiError::validation(
                "restaurant.table_order.consumptions",
                vec!["Calculated ingredient quantity exceeds the supported decimal range".into()],
            )
        })?;
        consumptions.push(json!({
            "product": product_id.to_string(),
            "qty": qty_value,
            "kind": kind,
            "tracked": true,
            "order_line": order_line,
        }));
    }
    Ok(())
}
