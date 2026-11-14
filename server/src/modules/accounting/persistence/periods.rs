//! Period calendar locking and close safeguards.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::NaiveDate;
use serde_json::Value;
use uuid::Uuid;

use super::{date, lock_period_calendar};

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match action {
        "created" | "updated" => {
            lock_period_calendar(tx, tenant).await?;
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
            {
                let id = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .unwrap_or(Uuid::nil());
                if action == "updated"
                    && let Some(current) = tx
                        .query_opt(
                            "SELECT start_date, end_date FROM accounting__period WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                            &[&tenant.id, &id],
                        )
                        .await?
                {
                    let old_start: NaiveDate = current.get(0);
                    let old_end: NaiveDate = current.get(1);
                    if start != old_start || end != old_end {
                        let has_journals = tx
                            .query_opt(
                                "SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND COALESCE(posting_date, (created_at AT TIME ZONE 'UTC')::date) BETWEEN $2 AND $3 LIMIT 1",
                                &[&tenant.id, &old_start, &old_end],
                            )
                            .await?
                            .is_some();
                        let has_statements = tx
                            .query_opt(
                                "SELECT 1 FROM accounting__bank_statement WHERE tenant_id = $1 AND status <> 'cancelled' AND start_date <= $3 AND end_date >= $2 LIMIT 1",
                                &[&tenant.id, &old_start, &old_end],
                            )
                            .await?
                            .is_some();
                        if has_journals || has_statements {
                            errors.push("Không thể đổi ngày kỳ kế toán sau khi kỳ đã có bút toán hoặc sao kê ngân hàng".into());
                        }
                    }
                }
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__period WHERE tenant_id = $1 AND id <> $2 AND start_date <= $3 AND end_date >= $4 LIMIT 1",
                        &[&tenant.id, &id, &end, &start],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Kỳ kế toán không được chồng lấn với kỳ khác".into());
                }
            }
        }
        "closed" => {
            lock_period_calendar(tx, tenant).await?;
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
            {
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__bank_statement WHERE tenant_id = $1 AND status = 'draft' AND start_date <= $3 AND end_date >= $2 LIMIT 1",
                        &[&tenant.id, &start, &end],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể khóa kỳ khi còn sao kê ngân hàng nháp trong kỳ".into());
                }
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND status = 'draft' AND COALESCE(posting_date, (created_at AT TIME ZONE 'UTC')::date) BETWEEN $2 AND $3 LIMIT 1",
                        &[&tenant.id, &start, &end],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể khóa kỳ khi còn bút toán nháp trong kỳ".into());
                }
            }
        }
        "reopened" => lock_period_calendar(tx, tenant).await?,
        "removed" => {
            lock_period_calendar(tx, tenant).await?;
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
            {
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__bank_statement WHERE tenant_id = $1 AND status <> 'cancelled' AND start_date <= $3 AND end_date >= $2 LIMIT 1",
                        &[&tenant.id, &start, &end],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể xóa kỳ kế toán còn sao kê ngân hàng".into());
                }
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND COALESCE(posting_date, (created_at AT TIME ZONE 'UTC')::date) BETWEEN $2 AND $3 LIMIT 1",
                        &[&tenant.id, &start, &end],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Không thể xóa kỳ kế toán đã có bút toán".into());
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
