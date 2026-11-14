//! Tenant-scoped fixed-asset and depreciation persistence invariants.
use super::domain::{date, number};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "asset.persistence",
            vec![format!(
                "Stored asset {field} is not a valid decimal amount"
            )],
        )
    })
}

pub(super) async fn lock_asset_financial(tx: &Tx<'_>, tenant: &Tenant, asset_id: Uuid) -> R<bool> {
    let exists = tx
        .query_opt(
            "SELECT id FROM asset__asset WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &asset_id],
        )
        .await?
        .is_some();
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("asset.depreciation:{}:{asset_id}", tenant.id)],
    )
    .await?;
    Ok(exists)
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match (entity, action) {
        ("asset", "created" | "updated") => {
            if let Some(code) = document.get("code").and_then(Value::as_str) {
                let id = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .unwrap_or(Uuid::nil());
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&format!("asset.code:{}:{}", tenant.id, code)],
                )
                .await?;
                if tx.query_opt(
                    "SELECT 1 FROM asset__asset WHERE tenant_id = $1 AND code = $2 AND id <> $3 LIMIT 1",
                    &[&tenant.id, &code, &id],
                ).await?.is_some() {
                    errors.push("Mã tài sản đã tồn tại trong doanh nghiệp".into());
                }
            }
        }
        ("asset", "activated") => {
            let offset = match document.get("acquisition_method").and_then(Value::as_str) {
                Some("cash") => "111",
                Some("bank") => "112",
                Some("opening_balance") => "411",
                _ => return Ok(vec!["Phương thức vốn hóa tài sản không hợp lệ".into()]),
            };
            let mut required_accounts = vec!["211", offset];
            if document.get("acquisition_method").and_then(Value::as_str) == Some("opening_balance")
                && number(document, "accumulated_depreciation").unwrap_or_default()
                    > Decimal::new(5, 3)
            {
                required_accounts.push("214");
            }
            for code in required_accounts {
                if tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &code],
                ).await?.is_none() {
                    errors.push(format!("Thiếu tài khoản kế toán {code}"));
                }
            }
        }
        ("asset", "opening_balance_recorded") => {
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let Some(id) = id {
                if tx.query_opt(
                    "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'fixed_asset' AND source_id = $2 LIMIT 1",
                    &[&tenant.id, &id.to_string()],
                ).await?.is_some() {
                    errors.push("TÃ i sáº£n Ä‘Ã£ cÃ³ bÃºt toÃ¡n vá»‘n hÃ³a; khÃ´ng thá»ƒ ghi sá»‘ dÆ° Ä‘áº§u ká»³ láº§n ná»¯a".into());
                }
            }
            if !tenant.has_module("accounting") {
                errors.push(
                    "Module káº¿ toÃ¡n pháº£i Ä‘Æ°á»£c báº­t Ä‘á»ƒ ghi sá»• tÃ i sáº£n".into(),
                );
            }
            let mut required_accounts = vec!["211", "411"];
            if number(document, "accumulated_depreciation").unwrap_or_default() > Decimal::new(5, 3)
            {
                required_accounts.push("214");
            }
            for code in required_accounts {
                if tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &code],
                ).await?.is_none() {
                    errors.push(format!("Thiáº¿u tÃ i khoáº£n káº¿ toÃ¡n {code}"));
                }
            }
        }
        ("asset", "disposed") => {
            if !tenant.has_module("accounting") {
                errors.push("Enable accounting before posting asset disposal".into());
            }
            let cost = number(document, "cost").unwrap_or_default();
            let accumulated = number(document, "accumulated_depreciation").unwrap_or_default();
            let calculated_book_value = cost.checked_sub(accumulated);
            let book_value = number(document, "book_value")
                .or(calculated_book_value)
                .unwrap_or_default();
            let proceeds = number(document, "disposal_proceeds").unwrap_or_default();
            let method = document.get("disposal_method").and_then(Value::as_str);
            let mut required_accounts = vec!["211"];
            if calculated_book_value.is_none() {
                errors.push("Asset book value exceeds the supported decimal range".into());
            }
            if accumulated > Decimal::new(5, 3) {
                required_accounts.push("214");
            }
            let loss = book_value.checked_sub(proceeds);
            let gain = proceeds.checked_sub(book_value);
            if loss.is_some_and(|amount| amount > Decimal::new(5, 3)) {
                required_accounts.push("642");
            }
            if gain.is_some_and(|amount| amount > Decimal::new(5, 3)) {
                required_accounts.push("711");
            }
            if loss.is_none() || gain.is_none() {
                errors.push("Asset disposal difference exceeds the supported decimal range".into());
            }
            if proceeds > Decimal::new(5, 3) {
                match method {
                    Some("cash") => required_accounts.push("111"),
                    Some("bank") => required_accounts.push("112"),
                    _ => errors.push("Select cash or bank for disposal proceeds".into()),
                }
            }
            for code in required_accounts {
                if tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &code],
                ).await?.is_none() {
                    errors.push(format!("Missing accounting account {code}"));
                }
            }
            if document.get("id").and_then(Value::as_str).is_some() {
                let id = Uuid::parse_str(document["id"].as_str().unwrap_or_default())
                    .map_err(crate::error::ApiError::internal)?;
                lock_asset_financial(tx, tenant, id).await?;
                if tx.query_opt(
                    "SELECT 1 FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND status = 'draft' LIMIT 1",
                    &[&tenant.id, &id],
                ).await?.is_some() {
                    errors.push("Hãy xóa các phiếu khấu hao nháp trước khi thanh lý tài sản".into());
                }
            }
        }
        ("depreciation", "created") => {
            let id = document
                .get("asset")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let (Some(id), Some(period)) = (id, date(document, "period")) {
                lock_asset_financial(tx, tenant, id).await?;
                let month_start = NaiveDate::from_ymd_opt(period.year(), period.month(), 1)
                    .ok_or_else(|| crate::error::ApiError::internal("Kỳ khấu hao không hợp lệ"))?;
                let method = tx
                    .query_opt(
                        "SELECT COALESCE(depreciation_method, 'straight_line') FROM asset__asset WHERE tenant_id = $1 AND id = $2",
                        &[&tenant.id, &id],
                    )
                    .await?
                    .map(|row| row.get::<_, String>(0));
                if method.as_deref() == Some("declining_balance")
                    && tx
                        .query_opt(
                            "SELECT id FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND status = 'draft' LIMIT 1",
                            &[&tenant.id, &id],
                        )
                        .await?
                        .is_some()
                {
                    errors.push(
                        "Post the existing declining-balance draft before creating another period".into(),
                    );
                }
                if tx.query_opt(
                    "SELECT 1 FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND date_trunc('month', period::timestamp)::date = $3 LIMIT 1",
                    &[&tenant.id, &id, &month_start],
                ).await?.is_some() {
                    errors.push("Tài sản đã có phiếu khấu hao trong tháng này".into());
                }
            }
        }
        ("depreciation", "posted") => {
            if !tenant.has_module("accounting") {
                errors.push("Module kế toán phải được bật để ghi sổ khấu hao".into());
            }
            for code in ["642", "214"] {
                if tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &code],
                ).await?.is_none() {
                    errors.push(format!("Thiếu tài khoản kế toán {code}"));
                }
            }
            let id = document
                .get("asset")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let Some(id) = id {
                lock_asset_financial(tx, tenant, id).await?;
            }
            let asset = if let Some(id) = id {
                tx.query_opt(
                    "SELECT status FROM asset__asset WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &id],
                )
                .await?
            } else {
                None
            };
            if !asset.is_some_and(|row| row.get::<_, String>(0) == "active") {
                errors.push("Chỉ ghi khấu hao cho tài sản đang hoạt động".into());
            }
            if let (Some(id), Some(amount)) = (
                document
                    .get("asset")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok()),
                number(document, "amount"),
            ) {
                if let Some(row) = tx
                    .query_opt(
                        "SELECT cost::text, COALESCE(salvage_value, 0)::text, COALESCE(accumulated_depreciation, 0)::text, COALESCE(depreciation_method, 'straight_line') FROM asset__asset WHERE tenant_id = $1 AND id = $2",
                        &[&tenant.id, &id],
                    )
                    .await?
                {
                    let cost = decimal_column(&row, 0, "cost")?;
                    let salvage = decimal_column(&row, 1, "salvage value")?;
                    let accumulated = decimal_column(&row, 2, "accumulated depreciation")?;
                    let method: String = row.get(3);
                    if method == "declining_balance"
                        && let Some(depreciation_id) = document
                            .get("id")
                            .and_then(Value::as_str)
                            .and_then(|value| Uuid::parse_str(value).ok())
                    {
                        if tx
                            .query_opt(
                                "SELECT id FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND status = 'draft' AND id <> $3 LIMIT 1",
                                &[&tenant.id, &id, &depreciation_id],
                            )
                            .await?
                            .is_some()
                        {
                            errors.push("Post or remove the other declining-balance draft first".into());
                        }
                        if let Some(period) = date(document, "period")
                            && tx
                                .query_opt(
                                    "SELECT id FROM asset__depreciation WHERE tenant_id = $1 AND asset = $2 AND status = 'posted' AND period > $3 LIMIT 1",
                                    &[&tenant.id, &id, &period],
                                )
                                .await?
                                .is_some()
                        {
                            errors.push("Declining-balance depreciation must be posted in period order".into());
                        }
                    }
                    let maximum_accumulated = cost
                        .checked_sub(salvage)
                        .and_then(|basis| basis.checked_add(Decimal::new(5, 3)));
                    let next_accumulated = accumulated.checked_add(amount);
                    if maximum_accumulated
                        .zip(next_accumulated)
                        .is_none_or(|(maximum, next)| next > maximum)
                    {
                        errors.push("Tổng khấu hao vượt nguyên giá trừ giá trị thu hồi".into());
                    }
                }
            }
            if let Some(period) = date(document, "period") {
                let current = Utc::now().date_naive();
                if (period.year(), period.month()) > (current.year(), current.month()) {
                    errors.push("Không thể ghi sổ khấu hao cho tháng trong tương lai".into());
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
