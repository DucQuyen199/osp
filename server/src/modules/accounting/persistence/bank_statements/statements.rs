//! Bank statement creation, period coverage, currency and retention checks.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

use super::super::{date, lock_period_calendar, overlaps_closed_period};

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match action {
        "created" | "updated" => {
            lock_period_calendar(tx, tenant).await?;
            let account = document
                .get("account")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let Some(account) = account else {
                return Ok(vec!["Sao kê cần chọn tài khoản ngân hàng hợp lệ".into()]);
            };
            let start = date(document, "start_date");
            let end = date(document, "end_date");
            let (Some(start), Some(end)) = (start, end) else {
                return Ok(vec!["Sao kê cần khoảng ngày hợp lệ".into()]);
            };
            if start <= end && overlaps_closed_period(tx, tenant, start, end).await? {
                errors.push("Bank statements cannot be created or changed inside a closed accounting period".into());
            }
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("accounting.bank_statement:{}:{}", tenant.id, account)],
            )
            .await?;
            let account_row = tx
                .query_opt(
                    "SELECT code FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &account],
                )
                .await?;
            if !account_row.is_some_and(|row| row.get::<_, String>(0) == "112") {
                errors.push("Sao kê chỉ được gắn với tài khoản tiền gửi ngân hàng 112".into());
            }
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .unwrap_or(Uuid::nil());
            let base_code = tenant
                .setting_str("baseCurrency")
                .unwrap_or("VND")
                .to_ascii_uppercase();
            let Some(base_currency_id) = tx
                .query_opt(
                    "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
                    &[&tenant.id, &base_code],
                )
                .await?
                .map(|row| row.get::<_, Uuid>(0))
            else {
                return Ok(vec![format!(
                    "Tenant base currency {base_code} is missing from its currency catalog"
                )]);
            };
            let currency_id = match document.get("currency") {
                None | Some(Value::Null) => base_currency_id,
                Some(Value::String(value)) => match Uuid::parse_str(value) {
                    Ok(currency_id) => currency_id,
                    Err(_) => {
                        errors.push("Sao kê cần chọn đồng tiền hợp lệ".into());
                        base_currency_id
                    }
                },
                Some(_) => {
                    errors.push("Sao kê cần chọn đồng tiền hợp lệ".into());
                    base_currency_id
                }
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM master_data__currency WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &currency_id],
                )
                .await?
                .is_none()
            {
                errors.push("Đồng tiền sao kê không tồn tại trong tenant này".into());
            }
            if action == "updated" {
                if let Some(existing) = tx
                    .query_opt(
                        "SELECT currency FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &id],
                    )
                    .await?
                {
                    let existing_currency: Option<Uuid> = existing.get(0);
                    let has_lines = tx
                        .query_opt(
                            "SELECT 1 FROM accounting__bank_statement_line WHERE tenant_id = $1 AND statement = $2 LIMIT 1",
                            &[&tenant.id, &id],
                        )
                        .await?
                        .is_some();
                    if has_lines && existing_currency.unwrap_or(base_currency_id) != currency_id {
                        errors.push(
                            "Không thể đổi đồng tiền khi sao kê đã có dòng; hãy tạo sao kê mới"
                                .into(),
                        );
                    }
                }
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM accounting__bank_statement WHERE tenant_id = $1 AND account = $2 AND statement_number = $3 AND id <> $4 LIMIT 1",
                    &[&tenant.id, &account, &document.get("statement_number").and_then(Value::as_str).unwrap_or_default(), &id],
                )
                .await?
                .is_some()
            {
                errors.push("Mã sao kê đã tồn tại trên tài khoản này".into());
            }
            if start <= end
                && tx
                    .query_opt(
                        "SELECT 1 FROM accounting__bank_statement WHERE tenant_id = $1 AND account = $2 AND id <> $3 AND status <> 'cancelled' AND start_date <= $4 AND end_date >= $5 LIMIT 1",
                        &[&tenant.id, &account, &id, &end, &start],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Khoảng thời gian sao kê bị chồng với sao kê khác của cùng tài khoản".into());
            }
        }
        "removed" => {
            if let Some(statement) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                && tx
                    .query_opt(
                        "SELECT 1 FROM accounting__bank_statement_line WHERE tenant_id = $1 AND statement = $2 LIMIT 1",
                        &[&tenant.id, &statement],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Không xóa được sao kê còn dòng đối soát".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
