//! Tenant-scoped recipe and restaurant order checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

async fn station_for(tx: &Tx<'_>, tenant: &Tenant, product: Uuid) -> R<&'static str> {
    let station: Option<String> = tx
        .query_opt(
            "SELECT station FROM restaurant__menu_item WHERE tenant_id = $1 AND product = $2 LIMIT 1 FOR SHARE",
            &[&tenant.id, &product],
        )
        .await?
        .and_then(|row| row.get(0));
    Ok(if station.as_deref() == Some("bar") {
        "bar"
    } else {
        "kitchen"
    })
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "reservation" && matches!(action, "created" | "updated" | "confirmed" | "arrived")
    {
        let table_id = document
            .get("table")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if let Some(table_id) = table_id {
            let lock_key = format!("restaurant.table:{}:{}", tenant.id, table_id);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let Some(row) = tx.query_opt("SELECT seats::text FROM restaurant__table WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&tenant.id, &table_id]).await? else {
                return Ok(vec!["Bàn đặt trước không tồn tại trong doanh nghiệp".into()]);
            };
            let seats: Option<String> = row.get(0);
            let seats = seats.as_deref().and_then(crate::money::decimal_str);
            let guests = document.get("guest_count").and_then(crate::money::decimal);
            if seats
                .zip(guests)
                .is_some_and(|(seats, guests)| guests > seats)
            {
                return Ok(vec!["Số khách vượt sức chứa của bàn đã chọn".into()]);
            }
            if (action == "arrived" || (action == "updated" && document.get("status").and_then(Value::as_str) == Some("arrived"))) && tx.query_opt("SELECT id FROM restaurant__table_order WHERE tenant_id=$1 AND \"table\"=$2 AND status IN ('open','sent','served') LIMIT 1 FOR UPDATE", &[&tenant.id, &table_id]).await?.is_some() {
                return Ok(vec!["Bàn vẫn đang có order chưa thanh toán; hãy đóng order trước khi ghi nhận lượt đặt bàn mới".into()]);
            }
            if matches!(action, "confirmed")
                || matches!(
                    document.get("status").and_then(Value::as_str),
                    Some("confirmed" | "arrived")
                )
            {
                let Some(start) = document
                    .get("starts_at")
                    .and_then(Value::as_str)
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                else {
                    return Ok(vec!["Thời gian bắt đầu đặt bàn không hợp lệ".into()]);
                };
                let Some(end) = document
                    .get("ends_at")
                    .and_then(Value::as_str)
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                else {
                    return Ok(vec!["Thời gian kết thúc đặt bàn không hợp lệ".into()]);
                };
                let id = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .unwrap_or(Uuid::nil());
                if tx.query_opt("SELECT id FROM restaurant__reservation WHERE tenant_id=$1 AND \"table\"=$2 AND id<>$3 AND status IN ('confirmed','arrived') AND starts_at < $4 AND ends_at > $5 LIMIT 1 FOR UPDATE", &[&tenant.id, &table_id, &id, &end.with_timezone(&chrono::Utc), &start.with_timezone(&chrono::Utc)]).await?.is_some() {
                    return Ok(vec!["Bàn đã có một đặt chỗ được xác nhận trong khung giờ này".into()]);
                }
            }
        }
        return Ok(Vec::new());
    }
    if entity == "table" && action == "updated" {
        let Some(table_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Table id is required".into()]);
        };
        if let Some(seats) = document.get("seats").and_then(crate::money::decimal) {
            let seats = seats.normalize().to_string();
            if tx.query_opt("SELECT id FROM restaurant__reservation WHERE tenant_id=$1 AND \"table\"=$2 AND status IN ('confirmed','arrived') AND guest_count::numeric > $3::numeric LIMIT 1 FOR UPDATE", &[&tenant.id, &table_id, &seats]).await?.is_some() {
                return Ok(vec!["Không thể giảm sức chứa dưới số khách của đặt bàn đã xác nhận".into()]);
            }
            if tx
                .query_opt(
                    "SELECT id FROM restaurant__table_order WHERE tenant_id = $1 AND \"table\" = $2 AND status IN ('open', 'sent', 'served') AND COALESCE(guest_count, 1)::double precision > $3::double precision LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &table_id, &seats],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Không thể giảm số chỗ thấp hơn số khách trong order đang mở".into(),
                ]);
            }
        }
        return Ok(Vec::new());
    }
    if entity == "table" && action == "removed" {
        let Some(table_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Table id is required".into()]);
        };
        if tx.query_opt("SELECT id FROM restaurant__reservation WHERE tenant_id=$1 AND \"table\"=$2 LIMIT 1 FOR UPDATE", &[&tenant.id, &table_id]).await?.is_some()
            || tx.query_opt("SELECT id FROM restaurant__table_order WHERE tenant_id=$1 AND \"table\"=$2 LIMIT 1 FOR UPDATE", &[&tenant.id, &table_id]).await?.is_some()
        {
            return Ok(vec!["Không thể xóa bàn đã có lịch sử order hoặc đặt bàn".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "table_order" && matches!(action, "created" | "updated") {
        if let Some(table) = document
            .get("table")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            let lock_key = format!("restaurant.table:{}:{}", tenant.id, table);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
            let same_table_update = if action == "updated" {
                if let Some(id) = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                {
                    tx.query_opt("SELECT \"table\" FROM restaurant__table_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&tenant.id, &id]).await?.and_then(|row| row.get::<_, Option<Uuid>>(0)) == Some(table)
                } else {
                    false
                }
            } else {
                false
            };
            if !same_table_update && tx.query_opt("SELECT id FROM restaurant__reservation WHERE tenant_id=$1 AND \"table\"=$2 AND status='confirmed' AND starts_at <= now() AND ends_at > now() LIMIT 1 FOR UPDATE", &[&tenant.id, &table]).await?.is_some() {
                return Ok(vec!["Bàn đang được giữ cho khách đặt trước; hãy ghi nhận khách đến trước khi mở order".into()]);
            }
            let current_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx
                .query_opt(
                    "SELECT id FROM restaurant__table_order WHERE tenant_id = $1 AND \"table\" = $2 AND id <> $3 AND status IN ('open', 'sent', 'served') LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &table, &current_id],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Bàn đang có order chưa thanh toán hoặc chưa hủy".into()]);
            }
            let Some(row) = tx
                .query_opt(
                    "SELECT seats::text FROM restaurant__table WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &table],
                )
                .await?
            else {
                return Ok(vec!["Không tìm thấy bàn trong doanh nghiệp".into()]);
            };
            let seats: Option<String> = row.get(0);
            let seats = seats
                .map(|value| {
                    crate::money::decimal_str(&value).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "restaurant.table.seats",
                            vec!["Sức chứa của bàn không phải số hợp lệ".into()],
                        )
                    })
                })
                .transpose()?;
            let guests = document
                .get("guest_count")
                .and_then(crate::money::decimal)
                .unwrap_or(rust_decimal::Decimal::ONE);
            if let Some(seats) = seats
                && guests > seats
            {
                return Ok(vec![format!(
                    "Bàn này chỉ có {} chỗ; hãy chọn bàn lớn hơn hoặc giảm số khách",
                    seats.normalize()
                )]);
            }
        }
    }
    if entity == "table_order" && matches!(action, "served" | "completed") {
        let order_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let tickets = tx.query(
            "SELECT status FROM restaurant__kitchen_ticket WHERE tenant_id = $1 AND \"order\" = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        ).await?;
        if tickets.is_empty() || tickets.iter().any(|row| row.get::<_, String>(0) != "ready") {
            return Ok(vec![
                "All kitchen and bar tickets must be ready before serving the order".into(),
            ]);
        }
    }
    if entity == "table_order"
        && action == "cancelled"
        && document.get("status").and_then(Value::as_str) == Some("sent")
    {
        let Some(order_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec![
                "Order id is required to cancel kitchen tickets".into(),
            ]);
        };
        let tickets = tx.query(
            "SELECT status FROM restaurant__kitchen_ticket WHERE tenant_id = $1 AND \"order\" = $2 FOR UPDATE",
            &[&tenant.id, &order_id],
        ).await?;
        if tickets.is_empty()
            || tickets
                .iter()
                .any(|row| row.get::<_, String>(0) != "queued")
        {
            return Ok(vec!["An order sent to the kitchen can only be cancelled before any station starts preparation".into()]);
        }
    }
    if entity == "menu_item" && matches!(action, "created" | "updated") {
        let Some(product_id) = document
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Món trong thực đơn cần sản phẩm hợp lệ".into()]);
        };
        let lock_key = format!("restaurant.menu_item:{}:{}", tenant.id, product_id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or(Uuid::nil());
        return Ok(if tx
            .query_opt(
                "SELECT id FROM restaurant__menu_item WHERE tenant_id = $1 AND product = $2 AND id <> $3 LIMIT 1",
                &[&tenant.id, &product_id, &id],
            )
            .await?
            .is_some()
        {
            vec!["Mỗi sản phẩm chỉ được khai báo một lần trong thực đơn doanh nghiệp".into()]
        } else {
            Vec::new()
        });
    }

    if entity == "kitchen_ticket" && action == "created" {
        let Some(order_id) = document
            .get("order")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Phiếu bếp cần order nguồn hợp lệ".into()]);
        };
        let station = document
            .get("station")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(station, "kitchen" | "bar") {
            return Ok(vec![
                "Phiếu bếp cần trạm bếp hoặc quầy pha chế hợp lệ".into(),
            ]);
        }
        let lock_key = format!(
            "restaurant.kitchen_ticket:{}:{}:{}",
            tenant.id, order_id, station
        );
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM restaurant__kitchen_ticket WHERE tenant_id = $1 AND \"order\" = $2 AND station = $3 LIMIT 1",
                &[&tenant.id, &order_id, &station],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Order đã có phiếu tại trạm này".into()]);
        }
        let order = tx
            .query_opt(
                "SELECT lines, status FROM restaurant__table_order WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &order_id],
            )
            .await?;
        let Some(order) = order else {
            return Ok(vec!["Không tìm thấy order nguồn trong doanh nghiệp".into()]);
        };
        let order_status: String = order.get(1);
        if !matches!(order_status.as_str(), "sent" | "served" | "completed") {
            return Ok(vec!["Chỉ tạo phiếu bếp từ order đã gửi".into()]);
        }
        let order_lines: Value = order.get(0);
        let expected_lines = match order_lines.as_array() {
            Some(lines) => {
                let mut expected = Vec::new();
                for line in lines {
                    let Some(product) = line
                        .get("product")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok())
                    else {
                        continue;
                    };
                    if station_for(tx, tenant, product).await? == station {
                        expected.push(line.clone());
                    }
                }
                expected
            }
            None => Vec::new(),
        };
        let ticket_lines = document
            .get("lines")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if expected_lines.is_empty() || ticket_lines != expected_lines {
            return Ok(vec![
                "Dòng phiếu bếp phải đúng các món của order tại trạm được chọn".into(),
            ]);
        }
        return Ok(Vec::new());
    }

    if entity != "recipe" || !matches!(action, "created" | "updated") {
        return Ok(Vec::new());
    }
    let Some(product_id) = document
        .get("product")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Công thức cần sản phẩm món hợp lệ".into()]);
    };
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        )
        .await?
        .is_none()
    {
        errors.push("Sản phẩm món không tồn tại trong doanh nghiệp".into());
    }
    let recipe_lock = format!("restaurant.recipe:{}:{}", tenant.id, product_id);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&recipe_lock],
    )
    .await?;
    let record_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if tx.query_opt(
        "SELECT id FROM restaurant__recipe WHERE tenant_id = $1 AND product = $2 AND id IS DISTINCT FROM $3 LIMIT 1",
        &[&tenant.id, &product_id, &record_id],
    ).await?.is_some() {
        errors.push("Mỗi món chỉ được có một công thức đang dùng".into());
    }
    if let Some(ingredients) = document.get("ingredients").and_then(Value::as_array) {
        for (index, ingredient) in ingredients.iter().enumerate() {
            let Some(ingredient_id) = ingredient
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            if ingredient_id == product_id {
                errors.push(format!(
                    "Món không thể là nguyên liệu của chính công thức ở dòng {}",
                    index + 1
                ));
                continue;
            }
            if tx.query_opt(
                "SELECT id FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &ingredient_id],
            ).await?.is_none() {
                errors.push(format!("Nguyên liệu ở dòng {} không tồn tại trong doanh nghiệp", index + 1));
            }
        }
    }
    if let Some(ingredients) = document.get("ingredients").and_then(Value::as_array) {
        for (index, ingredient) in ingredients.iter().enumerate() {
            let Some(ingredient_id) = ingredient
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let selected_unit = match ingredient.get("uom") {
                Some(Value::String(value)) => match Uuid::parse_str(value) {
                    Ok(unit) => Some(unit),
                    Err(_) => {
                        errors.push(format!("Unit on ingredient {} is invalid", index + 1));
                        continue;
                    }
                },
                Some(value) if !value.is_null() => {
                    errors.push(format!("Unit on ingredient {} is invalid", index + 1));
                    continue;
                }
                _ => None,
            };
            if let Err(message) = crate::modules::master_data::unit_conversion::resolve(
                tx,
                tenant,
                ingredient_id,
                selected_unit,
            )
            .await?
            {
                errors.push(format!("Unit on ingredient {}: {message}", index + 1));
            }
        }
    }
    Ok(errors)
}
