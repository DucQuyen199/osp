//! Tenant-scoped case links, party consistency, daily-hour limits, and closure.
use crate::{db::Tx, error::R, kernel::Tenant, money};
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
    match entity {
        "case" => validate_case(tx, tenant, action, document).await,
        "case_note" => validate_note(tx, tenant, document).await,
        "time_entry" => validate_time(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_case(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(party) = parse_id(document, "party") else {
        return Ok(vec!["Vụ việc cần khách hàng hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Khách hàng không tồn tại trong doanh nghiệp".into());
    }
    if action == "updated" {
        if let Some(id) = id {
            let has_history = tx.query_opt(
                "SELECT id FROM case_management__case_note WHERE tenant_id = $1 AND \"case\" = $2 UNION ALL SELECT id FROM case_management__time_entry WHERE tenant_id = $1 AND \"case\" = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some();
            if has_history {
                if let Some(old) = tx.query_opt(
                    "SELECT party FROM case_management__case WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                ).await? {
                    let old_party: Uuid = old.get(0);
                    if party != old_party {
                        errors.push("Không thể đổi khách hàng của vụ việc sau khi đã ghi chú hoặc giờ công".into());
                    }
                }
            }
        }
    }
    if action == "closed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM case_management__time_entry WHERE tenant_id = $1 AND \"case\" = $2 AND status <> 'billed' LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Chỉ đóng vụ việc sau khi đã xuất hóa đơn toàn bộ giờ công".into());
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM case_management__case_note WHERE tenant_id = $1 AND \"case\" = $2 UNION ALL SELECT id FROM case_management__time_entry WHERE tenant_id = $1 AND \"case\" = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Vụ việc đã có ghi chú hoặc giờ công nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_note(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(case_id) = parse_id(document, "case") else {
        return Ok(vec!["Ghi chú cần vụ việc hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT status FROM case_management__case WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &case_id],
        )
        .await?
    else {
        return Ok(vec![
            "Vụ việc của ghi chú không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    let status: String = row.get(0);
    if status == "closed" {
        Ok(vec!["Không thể thêm ghi chú vào vụ việc đã đóng".into()])
    } else {
        Ok(Vec::new())
    }
}

async fn validate_time(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(case_id) = parse_id(document, "case") else {
        return Ok(vec!["Giờ công cần vụ việc hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT party, status FROM case_management__case WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &case_id],
    ).await? else {
        return Ok(vec!["Vụ việc không tồn tại trong doanh nghiệp".into()]);
    };
    let party: Uuid = row.get(0);
    let case_status: String = row.get(1);
    let mut errors = Vec::new();
    if parse_id(document, "party") != Some(party) {
        errors.push("Khách hàng của giờ công phải trùng khách hàng vụ việc".into());
    }
    if matches!(action, "created" | "updated") && case_status == "closed" {
        errors.push("Không thể ghi hoặc sửa giờ công cho vụ việc đã đóng".into());
    }
    if action == "billed" && case_status == "closed" {
        errors.push("Không thể xuất hóa đơn giờ công sau khi đóng vụ việc".into());
    }
    let hours = document
        .get("hours")
        .and_then(money::decimal)
        .unwrap_or_default();
    let date = document
        .get("date")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let who = document
        .get("who")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if !who.is_empty() && !date.is_empty() {
        if action != "billed" {
            let lock_key = format!(
                "case-management:time-entry:{}:{}:{}",
                tenant.id,
                date,
                who.to_lowercase()
            );
            tx.query_one_row(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&lock_key],
            )
            .await?;
        }
        let existing_text: String = tx.query_opt(
            "SELECT COALESCE(sum(hours), 0)::text FROM case_management__time_entry WHERE tenant_id = $1 AND lower(btrim(who)) = lower($2) AND date = $3::text::date AND ($4::uuid IS NULL OR id <> $4)",
            &[&tenant.id, &who, &date, &parse_id(document, "id")],
        ).await?.map(|row| row.get(0)).unwrap_or_else(|| "0".into());
        let Some(existing) = money::decimal_str(&existing_text) else {
            return Err(crate::error::ApiError::internal(
                "invalid stored case time-entry hours",
            ));
        };
        if action != "billed"
            && existing
                .checked_add(hours)
                .is_none_or(|total| total > Decimal::from(24) + Decimal::new(1, 4))
        {
            errors.push("Tổng giờ ghi nhận của một người trong ngày không thể vượt 24 giờ".into());
        }
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
