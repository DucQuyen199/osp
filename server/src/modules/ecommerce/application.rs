//! Ecommerce placement, canonical price calculation, and Sales conversion.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// Refresh the cart line prices and total from the owning storefront's catalog.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(lines) = document.get("lines") else {
        document.insert("total".into(), json!(0));
        return Ok(Vec::new());
    };
    if !lines.is_array() {
        return Ok(vec!["Online order lines must be a list".into()]);
    }
    let storefront_id =
        parse_id(&Value::Object(document.clone()), "storefront").ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec!["Storefront id is invalid".into()],
            )
        })?;
    let Some(storefront) = tx
        .query_opt(
            "SELECT price_list, tax FROM ecommerce__storefront WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &storefront_id],
        )
        .await?
    else {
        return Ok(vec!["Storefront was not found for this tenant".into()]);
    };
    let price_list: Option<Uuid> = storefront.get(0);
    let tax: Option<Uuid> = storefront.get(1);
    let normalized = price_lines(
        tx,
        tenant,
        &Value::Object(document.clone()),
        price_list,
        tax,
    )
    .await?;
    // Price the cart through the published Sales facade so the amount shown
    // before placement includes exactly the tax and rounding used by its order
    // and invoice. Only copy fields owned by the ecommerce catalog back.
    let mut priced = Map::from_iter([("lines".into(), Value::Array(normalized))]);
    if let Some(price_list) = price_list {
        priced.insert("price_list".into(), json!(price_list));
    }
    let errors =
        crate::modules::sales::prepare_document(tx, tenant, "sales_order", &mut priced).await?;
    if !errors.is_empty() {
        return Ok(errors);
    }
    document.insert(
        "lines".into(),
        priced.remove("lines").expect("prepared sales lines"),
    );
    document.insert(
        "total".into(),
        priced.remove("total").expect("prepared sales total"),
    );
    Ok(Vec::new())
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type == "ecommerce.web_order.cancelled" {
        let source_id = parse_id(document, "id").ok_or_else(|| {
            ApiError::validation(event_type, vec!["Đơn online cần mã hợp lệ để hủy".into()])
        })?;
        let key = format!("ecommerce-order:{}:{source_id}", tenant.id);
        tx.query_one_row(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&key],
        )
        .await?;
        let sale = tx
            .query_opt(
                "SELECT id, status FROM sales__sales_order WHERE tenant_id = $1 AND source = 'ecommerce' AND source_id = $2 FOR UPDATE",
                &[&tenant.id, &source_id.to_string()],
            )
            .await?;
        if let Some(sale) = sale {
            let sale_id: Uuid = sale.get(0);
            let status: String = sale.get(1);
            if status == "confirmed" {
                let entity = kernel.ent(tenant, "sales.sales_order")?;
                kernel
                    .act_in(
                        tx,
                        &Actor::System,
                        tenant,
                        &entity,
                        &sale_id.to_string(),
                        "cancelled",
                        &child_opts(event_id, depth),
                    )
                    .await?;
            } else if status != "cancelled" {
                return Err(ApiError::validation(
                    event_type,
                    vec!["Placed order can only be cancelled before shipment or delivery".into()],
                ));
            }
        }
        return Ok(true);
    }
    if event_type != "ecommerce.web_order.placed" {
        return Ok(false);
    }
    let source_id = parse_id(document, "id")
        .ok_or_else(|| ApiError::validation(event_type, vec!["Đơn online cần mã hợp lệ".into()]))?;
    let key = format!("ecommerce-order:{}:{source_id}", tenant.id);
    tx.query_one_row(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&key],
    )
    .await?;
    let source_id_text = source_id.to_string();
    if let Some(row) = tx
        .query_opt(
            "SELECT id, status FROM sales__sales_order WHERE tenant_id = $1 AND source = 'ecommerce' AND source_id = $2 FOR UPDATE",
            &[&tenant.id, &source_id_text],
        )
        .await?
    {
        let order_id: Uuid = row.get(0);
        let status: String = row.get(1);
        if status == "draft" {
            let entity = kernel.ent(tenant, "sales.sales_order")?;
            kernel
                .act_in(
                    tx,
                    &Actor::System,
                    tenant,
                    &entity,
                    &order_id.to_string(),
                    "confirmed",
                    &child_opts(event_id, depth),
                )
                .await?;
        } else if !matches!(status.as_str(), "confirmed" | "delivered") {
            return Err(ApiError::validation(
                event_type,
                vec![format!("Đơn bán liên kết đang ở trạng thái {status}; không thể tạo bản sao")],
            ));
        }
        return Ok(true);
    }

    let storefront_id = parse_id(document, "storefront").ok_or_else(|| {
        ApiError::validation(event_type, vec!["Đơn online cần gian hàng hợp lệ".into()])
    })?;
    let storefront = tx
        .query_opt(
            "SELECT warehouse, price_list, tax FROM ecommerce__storefront WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &storefront_id],
        )
        .await?
        .ok_or_else(|| ApiError::validation(event_type, vec!["Không tìm thấy gian hàng".into()]))?;
    let warehouse: Option<Uuid> = storefront.get(0);
    let price_list: Option<Uuid> = storefront.get(1);
    let tax: Option<Uuid> = storefront.get(2);
    let current_lines = price_lines(tx, tenant, document, price_list, tax).await?;
    let mut current_price = Map::from_iter([("lines".into(), Value::Array(current_lines))]);
    if let Some(price_list) = price_list {
        current_price.insert("price_list".into(), json!(price_list));
    }
    let price_errors =
        crate::modules::sales::prepare_document(tx, tenant, "sales_order", &mut current_price)
            .await?;
    if !price_errors.is_empty() {
        return Err(ApiError::validation(event_type, price_errors));
    }
    if !cart_price_snapshot_matches(document, &current_price) {
        return Err(ApiError::validation(
            event_type,
            vec!["Giá hoặc thuế của giỏ hàng đã thay đổi. Hãy cập nhật lại giỏ, kiểm tra tổng tiền mới rồi đặt đơn.".into()],
        ));
    }
    let mut data = Map::new();
    data.insert(
        "party".into(),
        document.get("party").cloned().unwrap_or(Value::Null),
    );
    data.insert("warehouse".into(), json!(warehouse));
    data.insert(
        "lines".into(),
        current_price
            .remove("lines")
            .expect("prepared ecommerce price lines"),
    );
    if let Some(price_list) = price_list {
        data.insert("price_list".into(), json!(price_list));
    }
    if let Some(address) = document.get("shipping_address") {
        data.insert("shipping_address".into(), address.clone());
    }
    data.insert("source".into(), json!("ecommerce"));
    data.insert("source_id".into(), json!(source_id_text));
    let entity = kernel.ent(tenant, "sales.sales_order")?;
    let order = kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &child_opts(event_id, depth),
        )
        .await?;
    let order_id = order["id"]
        .as_str()
        .ok_or_else(|| ApiError::internal("Created sales order has no id"))?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            order_id,
            "confirmed",
            &child_opts(event_id, depth),
        )
        .await?;
    Ok(true)
}

fn cart_price_snapshot_matches(cart: &Value, current_price: &Map<String, Value>) -> bool {
    let (Some(cart_lines), Some(current_lines)) = (
        cart.get("lines").and_then(Value::as_array),
        current_price.get("lines").and_then(Value::as_array),
    ) else {
        return false;
    };
    cart_lines.len() == current_lines.len()
        && cart_lines
            .iter()
            .zip(current_lines)
            .all(|(cart_line, current_line)| {
                ["qty", "price", "discount_pct", "tax_rate", "line_total"]
                    .into_iter()
                    .all(|field| {
                        cart_line.get(field).and_then(money::decimal)
                            == current_line.get(field).and_then(money::decimal)
                    })
                    && ["product", "tax", "tax_name", "kind", "tracked"]
                        .into_iter()
                        .all(|field| cart_line.get(field) == current_line.get(field))
            })
}

fn child_opts(event_id: Uuid, depth: u32) -> Opts {
    Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    }
}

async fn price_lines(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    price_list: Option<Uuid>,
    tax: Option<Uuid>,
) -> R<Vec<Value>> {
    let lines = document
        .get("lines")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec!["Đơn cần danh sách sản phẩm".into()],
            )
        })?;
    let list_items = if let Some(price_list) = price_list {
        tx.query_opt(
            "SELECT items FROM sales__price_list WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &price_list],
        )
        .await?
        .map(|row| row.get::<_, Value>(0))
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut normalized = Vec::with_capacity(lines.len());
    for (index, line) in lines.iter().enumerate() {
        let product = parse_id(line, "product").ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Sản phẩm dòng {} không hợp lệ", index + 1)],
            )
        })?;
        let qty = line
            .get("qty")
            .and_then(money::decimal)
            .filter(|qty| *qty > Decimal::ZERO)
            .ok_or_else(|| {
                ApiError::validation(
                    "ecommerce.web_order",
                    vec![format!("Số lượng dòng {} phải lớn hơn 0", index + 1)],
                )
            })?;
        let row = tx
            .query_opt(
                "SELECT kind, tracked, active, price::text FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product],
            )
            .await?
            .ok_or_else(|| ApiError::validation("ecommerce.web_order", vec![format!("Sản phẩm dòng {} không tồn tại", index + 1)]))?;
        let kind: Option<String> = row.get(0);
        let tracked: Option<bool> = row.get(1);
        let active: Option<bool> = row.get(2);
        let fallback_price_text: Option<String> = row.get(3);
        let fallback_price = fallback_price_text
            .as_deref()
            .map(|value| {
                money::decimal_str(value).ok_or_else(|| {
                    ApiError::validation(
                        "ecommerce.product.price",
                        vec![format!(
                            "Giá sản phẩm dòng {} không phải số thập phân hợp lệ",
                            index + 1
                        )],
                    )
                })
            })
            .transpose()?;
        if active == Some(false) {
            return Err(ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Sản phẩm dòng {} đã ngừng kinh doanh", index + 1)],
            ));
        }
        let list_price = list_items.iter().find_map(|item| {
            (item.get("product").and_then(Value::as_str) == Some(product.to_string().as_str()))
                .then(|| item.get("price").and_then(money::decimal))
                .flatten()
        });
        let price = if price_list.is_some() {
            list_price.ok_or_else(|| {
                ApiError::validation(
                    "ecommerce.web_order",
                    vec![format!(
                        "Sản phẩm dòng {} chưa có giá trong bảng giá của gian hàng",
                        index + 1
                    )],
                )
            })?
        } else {
            fallback_price.ok_or_else(|| {
                ApiError::validation(
                    "ecommerce.web_order",
                    vec![format!(
                        "Sản phẩm dòng {} chưa được khai báo giá bán",
                        index + 1
                    )],
                )
            })?
        };
        if price < Decimal::ZERO {
            return Err(ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Giá sản phẩm dòng {} không hợp lệ", index + 1)],
            ));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        let qty = money::json_number(qty).ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Số lượng dòng {} vượt giới hạn Decimal", index + 1)],
            )
        })?;
        let price = money::json_number(price).ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Giá dòng {} vượt giới hạn Decimal", index + 1)],
            )
        })?;
        let discount_pct = money::json_number(Decimal::ZERO).ok_or_else(|| {
            ApiError::validation(
                "ecommerce.web_order",
                vec![format!("Chiết khấu dòng {} không hợp lệ", index + 1)],
            )
        })?;
        normalized.push(json!({
            "product": product,
            "qty": qty,
            "price": price,
            "discount_pct": discount_pct,
            "kind": kind.clone(),
            "tracked": tracked.unwrap_or(kind == "goods"),
            "tax": tax,
        }));
    }
    Ok(normalized)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
