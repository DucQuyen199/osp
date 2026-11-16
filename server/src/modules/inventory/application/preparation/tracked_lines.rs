use super::*;

pub async fn prepare_tracked_lines(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let key = match entity {
        "maintenance_request" => "parts",
        "work_order" | "repair_order" => "lines",
        "prescription" => "items",
        _ => return Ok(Vec::new()),
    };
    let editable = matches!(
        document.get("status").and_then(Value::as_str),
        Some("open" | "draft" | "in_progress") | None
    );
    let Some(lines) = document.get_mut(key).and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("{key}[{}] phải là một dòng hàng", index + 1));
            continue;
        };
        if matches!(key, "parts" | "items") && editable {
            for field in ["base_qty", "uom_name", "uom_ratio", "base_uom"] {
                line.remove(field);
            }
        }
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        if line.get("tracked").and_then(Value::as_bool).is_some()
            && line.get("kind").and_then(Value::as_str).is_some()
            && !editable
        {
            continue;
        }
        let product = tx
            .query_opt(
                "SELECT kind, tracked, active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product_id],
            )
            .await?;
        let Some(product) = product else {
            errors.push(format!(
                "Không tìm thấy sản phẩm ở {key}[{}] trong doanh nghiệp",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let tracked: Option<bool> = product.get(1);
        let active: Option<bool> = product.get(2);
        if editable && active == Some(false) {
            errors.push(format!(
                "Sản phẩm ở {key}[{}] đã ngừng hoạt động",
                index + 1
            ));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        let is_tracked = tracked.unwrap_or(kind == "goods");
        if key == "items" && kind != "goods" {
            errors.push("Thuốc kê đơn phải là hàng hóa tồn kho".into());
            continue;
        }
        if key == "items" && !is_tracked {
            errors.push("Thuốc kê đơn cần được theo dõi tồn kho".into());
            continue;
        }
        line.insert("tracked".into(), json!(is_tracked));
        line.insert("kind".into(), json!(kind));
        if matches!(key, "parts" | "items") && editable {
            let selected_unit = match line.get("uom") {
                Some(Value::String(value)) => match Uuid::parse_str(value) {
                    Ok(unit) => Some(unit),
                    Err(_) => {
                        errors.push(format!("{key}[{}] has an invalid unit", index + 1));
                        continue;
                    }
                },
                Some(value) if !value.is_null() => {
                    errors.push(format!("{key}[{}] has an invalid unit", index + 1));
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
                    errors.push(format!("{key}[{}]: {message}", index + 1));
                    continue;
                }
            };
            if let Some(quantity) = line.get("qty").and_then(crate::money::decimal) {
                let Some(base_qty) = unit
                    .base_quantity(quantity)
                    .and_then(crate::money::json_number)
                else {
                    errors.push(format!(
                        "{key}[{}] converted quantity is invalid",
                        index + 1
                    ));
                    continue;
                };
                line.insert("base_qty".into(), base_qty);
            }
            let Some(ratio) = crate::money::json_number(unit.ratio) else {
                errors.push(format!(
                    "{key}[{}] unit ratio exceeds the supported range",
                    index + 1
                ));
                continue;
            };
            line.insert("uom_ratio".into(), ratio);
            if let Some(unit_id) = unit.unit_id {
                line.insert("uom".into(), json!(unit_id));
            }
            if let Some(name) = unit.unit_name {
                line.insert("uom_name".into(), json!(name));
            }
            if let Some(base_unit) = unit.base_unit_id {
                line.insert("base_uom".into(), json!(base_unit));
            }
        }
    }
    Ok(errors)
}
