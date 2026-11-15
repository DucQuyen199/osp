//! Field-service ticket intake and work-order creation.
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

use super::persistence;

/// Snapshot catalog pricing and stock tracking for a work order.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
    reprice: bool,
) -> R<Vec<String>> {
    let Some(lines) = document.get_mut("lines") else {
        document.insert("total".into(), Value::from(0));
        return Ok(Vec::new());
    };
    let Some(lines) = lines.as_array_mut() else {
        return Ok(vec!["Dòng lệnh công việc phải là danh sách".into()]);
    };
    let mut errors = Vec::new();
    for (index, line) in lines.iter_mut().enumerate() {
        let prefix = format!("Dòng công việc {}", index + 1);
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("{prefix} không hợp lệ"));
            continue;
        };
        if reprice {
            for field in ["base_qty", "uom_name", "uom_ratio", "base_uom"] {
                line.remove(field);
            }
        }
        if !line
            .get("qty")
            .and_then(money::decimal)
            .is_some_and(|qty| qty > Decimal::ZERO)
        {
            errors.push(format!("{prefix}: số lượng phải lớn hơn 0"));
            continue;
        }
        if reprice {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                errors.push(format!("{prefix}: chọn vật tư hoặc dịch vụ hợp lệ"));
                continue;
            };
            let Some(row) = tx
                .query_opt(
                    "SELECT kind, tracked, active, price::text, name FROM master_data__product WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                    &[&tenant.id, &product],
                )
                .await?
            else {
                errors.push(format!("{prefix}: sản phẩm không tồn tại trong doanh nghiệp"));
                continue;
            };
            let kind: Option<String> = row.get(0);
            let tracked: Option<bool> = row.get(1);
            let active: Option<bool> = row.get(2);
            let price_text: Option<String> = row.get(3);
            let name: String = row.get(4);
            if active == Some(false) {
                errors.push(format!("{prefix}: sản phẩm đã ngừng kinh doanh"));
                continue;
            }
            let Some(price) = price_text
                .as_deref()
                .and_then(money::decimal_str)
                .filter(|price| *price >= Decimal::ZERO)
            else {
                errors.push(format!("{prefix}: sản phẩm chưa có đơn giá hợp lệ"));
                continue;
            };
            let selected_unit = match line.get("uom") {
                Some(Value::String(value)) => match Uuid::parse_str(value) {
                    Ok(unit) => Some(unit),
                    Err(_) => {
                        errors.push(format!("{prefix}: selected unit is invalid"));
                        continue;
                    }
                },
                Some(value) if !value.is_null() => {
                    errors.push(format!("{prefix}: selected unit is invalid"));
                    continue;
                }
                _ => None,
            };
            let unit = match crate::modules::master_data::unit_conversion::resolve(
                tx,
                tenant,
                product,
                selected_unit,
            )
            .await?
            {
                Ok(unit) => unit,
                Err(message) => {
                    errors.push(format!("{prefix}: {message}"));
                    continue;
                }
            };
            let Some(base_qty) = line
                .get("qty")
                .and_then(money::decimal)
                .and_then(|qty| unit.base_quantity(qty))
                .and_then(money::json_number)
            else {
                errors.push(format!("{prefix}: converted quantity is invalid"));
                continue;
            };
            let Some(unit_ratio) = money::json_number(unit.ratio) else {
                errors.push(format!("{prefix}: unit ratio exceeds the supported range"));
                continue;
            };
            let Some(unit_price) = price.checked_mul(unit.ratio).and_then(money::json_number)
            else {
                errors.push(format!(
                    "{prefix}: converted price exceeds the supported range"
                ));
                continue;
            };
            line.insert("base_qty".into(), base_qty);
            line.insert("uom_ratio".into(), unit_ratio);
            if let Some(unit_id) = unit.unit_id {
                line.insert("uom".into(), Value::String(unit_id.to_string()));
            }
            if let Some(name) = unit.unit_name {
                line.insert("uom_name".into(), Value::String(name));
            }
            if let Some(base_unit) = unit.base_unit_id {
                line.insert("base_uom".into(), Value::String(base_unit.to_string()));
            }
            line.insert("price".into(), unit_price);
            line.insert(
                "kind".into(),
                Value::String(kind.clone().unwrap_or_else(|| "goods".into())),
            );
            line.insert(
                "tracked".into(),
                Value::Bool(tracked.unwrap_or(kind.as_deref() == Some("goods"))),
            );
            line.insert("product_name".into(), Value::String(name));
        }
    }
    if !errors.is_empty() {
        return Ok(errors);
    }
    let Some(total) = money::sum_line_totals(lines).and_then(money::json_number) else {
        return Ok(vec!["Không thể tính tổng lệnh công việc".into()]);
    };
    document.insert("total".into(), total);
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
    if !tenant.has_module("field-service") {
        return Ok(false);
    }
    if event_type != "helpdesk.ticket.created"
        || document.get("channel").and_then(Value::as_str) != Some("field")
    {
        return Ok(false);
    }
    let Some(party) = document.get("party").filter(|value| !value.is_null()) else {
        return Ok(false);
    };
    let Some(ticket) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    if persistence::existing_ticket_work_order(tx, tenant, ticket).await? {
        return Ok(true);
    }

    let mut data = Map::new();
    data.insert("party".into(), party.clone());
    data.insert("source_ticket".into(), Value::String(ticket.to_string()));
    if let Some(subject) = document.get("subject") {
        data.insert("title".into(), subject.clone());
    }
    let entity = kernel.ent(tenant, "field-service.work_order")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
