use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match (entity, action) {
        ("billing_cycle", "created") => {
            let Some(subscription) = document
                .get("subscription")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Kỳ thu phí cần thuê bao hợp lệ".into()]);
            };
            let Some(row) = tx
                .query_opt(
                    "SELECT s.party, s.status, p.price::text FROM subscription__subscription s JOIN subscription__plan p ON p.tenant_id = s.tenant_id AND p.id = s.plan WHERE s.tenant_id = $1 AND s.id = $2 FOR UPDATE OF s, p",
                    &[&tenant.id, &subscription],
                )
                .await?
            else {
                return Ok(vec!["Không tìm thấy thuê bao cần thu phí".into()]);
            };
            let party: Uuid = row.get(0);
            let status: String = row.get(1);
            let price: Option<String> = row.get(2);
            let price = price.as_deref().and_then(money::decimal_str);
            let amount = document.get("amount").and_then(money::decimal);
            let supplied_party = document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let mut errors = Vec::new();
            if status != "active" {
                errors.push("Không lập kỳ thu cho thuê bao đã tạm dừng hoặc hủy".into());
            }
            if supplied_party != Some(party) {
                errors.push("Khách hàng trên kỳ thu phải khớp với thuê bao".into());
            }
            if !price.zip(amount).is_some_and(|(expected, actual)| {
                money::within_tolerance(expected, actual, Decimal::new(5, 3))
            }) {
                errors.push("Số tiền kỳ thu phải khớp mức phí của gói dịch vụ".into());
            }
            let due_date = document
                .get("due_date")
                .and_then(Value::as_str)
                .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
            if let Some(due_date) = due_date {
                if tx
                    .query_opt(
                        "SELECT 1 FROM subscription__billing_cycle WHERE tenant_id = $1 AND subscription = $2 AND due_date = $3 LIMIT 1",
                        &[&tenant.id, &subscription, &due_date],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Thuê bao đã có kỳ thu cho ngày này".into());
                }
            }
            Ok(errors)
        }
        ("billing_cycle", "due") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Không xác định được kỳ thu phải xử lý".into()]);
            };
            let row = tx
                .query_opt(
                    "SELECT s.status FROM subscription__billing_cycle c JOIN subscription__subscription s ON s.tenant_id = c.tenant_id AND s.id = c.subscription WHERE c.tenant_id = $1 AND c.id = $2 FOR UPDATE OF s",
                    &[&tenant.id, &id],
                )
                .await?;
            match row {
                Some(row) if row.get::<_, String>(0) == "active" => Ok(Vec::new()),
                Some(_) => Ok(vec!["Chỉ được thu phí khi thuê bao đang hoạt động".into()]),
                None => Ok(vec!["Không tìm thấy thuê bao của kỳ thu".into()]),
            }
        }
        ("billing_cycle", "paid") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec!["Không xác định được kỳ thu cần chốt".into()]);
            };
            if tx
                .query_opt(
                    "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND source = 'subscription' AND source_id = $2 AND status = 'paid' LIMIT 1",
                    &[&tenant.id, &id.to_string()],
                )
                .await?
                .is_some()
            {
                Ok(Vec::new())
            } else {
                Ok(vec!["Chỉ chốt kỳ thu sau khi hóa đơn kế toán nguồn đã thanh toán".into()])
            }
        }
        ("subscription", "removed") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(Vec::new());
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM subscription__billing_cycle WHERE tenant_id = $1 AND subscription = $2 LIMIT 1",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec!["Thuê bao đã có kỳ thanh toán phải được lưu làm lịch sử".into()]);
            }
            Ok(Vec::new())
        }
        _ => Ok(Vec::new()),
    }
}
