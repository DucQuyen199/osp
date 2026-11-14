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
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        let Some(total) = money::sum_line_totals(lines).and_then(money::json_number) else {
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
