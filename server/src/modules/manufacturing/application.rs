//! BOM preparation and product snapshots.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub async fn prepare_bom(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(components) = document.get_mut("components").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    for (index, component) in components.iter_mut().enumerate() {
        let Some(component) = component.as_object_mut() else {
            errors.push(format!(
                "components[{}] phải là một dòng nguyên liệu",
                index + 1
            ));
            continue;
        };
        let Some(product_id) = component
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let product = tx.query_opt(
            "SELECT kind, tracked, active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        ).await?;
        let Some(product) = product else {
            errors.push(format!(
                "Không tìm thấy nguyên liệu ở dòng {} trong doanh nghiệp",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let tracked: Option<bool> = product.get(1);
        let active: Option<bool> = product.get(2);
        if active == Some(false) {
            errors.push(format!(
                "Nguyên liệu ở dòng {} đã ngừng hoạt động",
                index + 1
            ));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        let tracked = tracked.unwrap_or(kind == "goods");
        if !tracked {
            errors.push(format!(
                "Nguyên liệu ở dòng {} không được theo dõi tồn kho",
                index + 1
            ));
        }
        component.insert("tracked".into(), json!(tracked));
        component.insert("kind".into(), json!(kind));
    }
    Ok(errors)
}

/// Fill planned output into good/scrap quantities when the order is completed.
/// Scrap is absorbed into the cost of accepted output; separate abnormal-loss
/// expense policy is not inferred by this bounded context.
pub fn prepare_completion(document: &mut Map<String, Value>) -> Vec<String> {
    let Some(planned) = document.get("qty").and_then(money::decimal) else {
        return vec!["Production order requires a planned quantity".into()];
    };
    if planned <= Decimal::ZERO {
        return vec!["Production order planned quantity must be positive".into()];
    }
    let good = document.get("good_qty").and_then(money::decimal);
    let scrap = document.get("scrap_qty").and_then(money::decimal);
    if document
        .get("good_qty")
        .is_some_and(|value| !value.is_null())
        && good.is_none()
        || document
            .get("scrap_qty")
            .is_some_and(|value| !value.is_null())
            && scrap.is_none()
    {
        return vec!["Good and scrap quantities must be numeric".into()];
    }
    let (good, scrap) = match (good, scrap) {
        (Some(good), Some(scrap)) => (good, scrap),
        (Some(good), None) => {
            let Some(scrap) = planned.checked_sub(good) else {
                return vec!["Production output exceeds the supported decimal range".into()];
            };
            (good, scrap)
        }
        (None, Some(scrap)) => {
            let Some(good) = planned.checked_sub(scrap) else {
                return vec!["Production output exceeds the supported decimal range".into()];
            };
            (good, scrap)
        }
        (None, None) => (planned, Decimal::ZERO),
    };
    let (Some(good), Some(scrap)) = (money::json_number(good), money::json_number(scrap)) else {
        return vec!["Production output exceeds the supported decimal range".into()];
    };
    document.insert("good_qty".into(), good);
    document.insert("scrap_qty".into(), scrap);
    if let Some(reason) = document.get("scrap_reason").and_then(Value::as_str) {
        document.insert("scrap_reason".into(), json!(reason.trim()));
    }
    Vec::new()
}
