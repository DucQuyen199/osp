//! Normalize case commands and derive client/fee snapshots from source records.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value};
use uuid::Uuid;

fn max_case_money() -> Decimal {
    Decimal::from(999_999_999_999_999_i64)
}

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    match entity {
        "case" => {
            trim(document, &["title", "kind", "owner"]);
            if !document.contains_key("opened_on") && !document.contains_key("id") {
                document.insert(
                    "opened_on".into(),
                    Value::String(tenant.business_today().to_string()),
                );
            }
        }
        "case_note" => trim(document, &["body"]),
        "time_entry" => {
            trim(document, &["who"]);
            if !document.contains_key("date") && !document.contains_key("id") {
                document.insert(
                    "date".into(),
                    Value::String(tenant.business_today().to_string()),
                );
            }
            let Some(case_id) = document
                .get("case")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Giờ công cần vụ việc hợp lệ".into()]);
            };
            let Some(row) = tx
                .query_opt(
                    "SELECT party FROM case_management__case WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &case_id],
                )
                .await?
            else {
                return Ok(vec!["Vụ việc không tồn tại trong doanh nghiệp".into()]);
            };
            let party: Uuid = row.get(0);
            document.insert("party".into(), Value::String(party.to_string()));
            if let (Some(hours), Some(rate)) = (
                document.get("hours").and_then(money::decimal),
                document.get("rate").and_then(money::decimal),
            ) {
                let Some(amount) = hours.checked_mul(rate) else {
                    return Ok(vec!["Không thể tính phí từ giờ công và đơn giá".into()]);
                };
                if amount > max_case_money() {
                    return Ok(vec!["Phí giờ công vượt giới hạn lưu trữ tiền tệ".into()]);
                }
                let rounded =
                    amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
                if rounded > max_case_money() {
                    return Ok(vec!["Phí giờ công vượt giới hạn lưu trữ tiền tệ".into()]);
                }
                let Some(amount) = money::json_number(rounded) else {
                    return Ok(vec!["Phí giờ công vượt giới hạn lưu trữ tiền tệ".into()]);
                };
                document.insert("amount".into(), amount);
            }
        }
        _ => {}
    }
    Ok(Vec::new())
}

fn trim(document: &mut Map<String, Value>, fields: &[&str]) {
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value));
        }
    }
}
