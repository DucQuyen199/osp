//! Normalize vehicle identity and prepare catalog-priced repair orders.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
    reprice: bool,
) -> R<Vec<String>> {
    normalize_document(entity, document);
    if entity != "repair_order" {
        return Ok(Vec::new());
    }

    let Some(lines) = document.get_mut("lines") else {
        return Ok(Vec::new());
    };
    let Some(lines) = lines.as_array_mut() else {
        return Ok(vec!["Dòng sửa chữa phải là danh sách".into()]);
    };

    let mut errors = Vec::new();
    for (index, line) in lines.iter_mut().enumerate() {
        let prefix = format!("Dòng sửa chữa {}", index + 1);
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("{prefix}: dữ liệu dòng không hợp lệ"));
            continue;
        };
        let qty = line.get("qty").and_then(money::decimal);
        if !qty.is_some_and(|value| value > Decimal::ZERO) {
            errors.push(format!("{prefix}: số lượng phải lớn hơn 0"));
            continue;
        }

        if reprice {
            let Some(product) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                errors.push(format!("{prefix}: phải chọn phụ tùng hoặc dịch vụ hợp lệ"));
                continue;
            };
            let Some(row) = tx
                .query_opt(
                    "SELECT kind, tracked, active, price::text, name FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
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
            line.insert(
                "price".into(),
                money::json_number(price).unwrap_or(Value::Null),
            );
            let is_tracked = tracked.unwrap_or(kind.as_deref() == Some("goods"));
            line.insert(
                "kind".into(),
                Value::String(kind.unwrap_or_else(|| "goods".into())),
            );
            line.insert("tracked".into(), Value::Bool(is_tracked));
            line.insert("product_name".into(), Value::String(name));
            for field in [
                "discount_pct",
                "discount",
                "tax_rate",
                "tax_amount",
                "line_total",
            ] {
                line.remove(field);
            }
        }
    }
    if !errors.is_empty() {
        return Ok(errors);
    }

    match money::sum_line_totals(lines).and_then(money::json_number) {
        Some(total) => {
            document.insert("total".into(), total);
            Ok(Vec::new())
        }
        None => Ok(vec!["Không thể tính tổng tiền lệnh sửa chữa".into()]),
    }
}

fn normalize_document(entity: &str, document: &mut Map<String, Value>) {
    let fields: &[&str] = match entity {
        "vehicle" => &["plate", "vin", "make", "model"],
        "repair_order" => &["complaint"],
        _ => &[],
    };
    for field in fields {
        if let Some(value) = document.get(*field).and_then(Value::as_str) {
            let value = value.trim();
            let normalized = if matches!(*field, "plate" | "vin") {
                value.to_ascii_uppercase()
            } else {
                value.to_owned()
            };
            document.insert((*field).into(), Value::String(normalized));
        }
    }
}
