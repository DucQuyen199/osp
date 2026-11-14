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
        line.insert("tracked".into(), json!(tracked.unwrap_or(kind == "goods")));
        line.insert("kind".into(), json!(kind));
    }
    Ok(errors)
}
