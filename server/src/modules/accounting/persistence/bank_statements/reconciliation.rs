//! Close a bank statement against all imported lines and posted ledger entries.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

use super::super::{database_amount, decimal_amount, lock_period_calendar, overlaps_closed_period};

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    _action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    lock_period_calendar(tx, tenant).await?;
    let Some(statement) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Không xác định được sao kê cần đối soát".into()]);
    };
    let statement_row = tx
        .query_opt(
            "SELECT start_date, end_date FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &statement],
        )
        .await?;
    if let Some(statement_row) = statement_row {
        let start: NaiveDate = statement_row.get(0);
        let end: NaiveDate = statement_row.get(1);
        if overlaps_closed_period(tx, tenant, start, end).await? {
            errors.push(
                "A bank statement cannot be reconciled inside a closed accounting period".into(),
            );
        }
    }
    let row = tx
        .query_one_row(
            "SELECT count(*), count(*) FILTER (WHERE status = 'unmatched'), COALESCE(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text FROM accounting__bank_statement_line WHERE tenant_id = $1 AND statement = $2",
            &[&tenant.id, &statement],
        )
        .await?;
    let count: i64 = row.get(0);
    let unmatched: i64 = row.get(1);
    let movement = database_amount(&row, 2)?;
    let opening = decimal_amount(document, "opening_balance").unwrap_or(Decimal::ZERO);
    let closing = decimal_amount(document, "closing_balance").unwrap_or(Decimal::ZERO);
    if count == 0 || unmatched > 0 {
        errors.push("Sao kê cần có dòng và mọi dòng phải được khớp hoặc đánh dấu bỏ qua".into());
    }
    let calculated_closing = opening.checked_add(movement).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.bank_statement",
            vec!["Bank statement balance exceeds the supported decimal range".into()],
        )
    })?;
    if !money::within_tolerance(calculated_closing, closing, amount_tolerance()) {
        errors.push("Số dư cuối kỳ phải bằng số dư đầu kỳ cộng phát sinh Có trừ Nợ".into());
    }
    let invalid_matches: i64 = tx
        .query_one_row(
            "SELECT count(*) FROM accounting__bank_statement_line b \
             JOIN accounting__bank_statement s ON s.tenant_id = b.tenant_id AND s.id = b.statement \
             JOIN master_data__currency base ON base.tenant_id = b.tenant_id AND upper(base.code) = upper(COALESCE((SELECT settings->>'baseCurrency' FROM osp_tenants WHERE id = b.tenant_id), 'VND')) \
             WHERE b.tenant_id = $1 AND b.statement = $2 AND b.status = 'matched' AND ( \
               (b.payment IS NULL) = (b.journal_entry IS NULL) OR NOT ( \
                 EXISTS ( \
                   SELECT 1 FROM accounting__payment p \
                   JOIN accounting__journal_entry j ON j.tenant_id = p.tenant_id \
                     AND j.source = 'payment' AND j.source_id = p.id::text AND j.status = 'posted' \
                   JOIN accounting__account a ON a.tenant_id = p.tenant_id AND a.code = '112' \
                   WHERE p.tenant_id = b.tenant_id AND p.id = b.payment \
                     AND p.method IN ('transfer', 'bank') \
                     AND abs(p.amount::numeric - b.amount::numeric) <= 0.005 \
                     AND COALESCE(p.currency, base.id) = COALESCE(s.currency, base.id) \
                     AND abs(COALESCE(p.base_amount, p.amount)::numeric - COALESCE(b.base_amount, b.amount)::numeric) <= 0.005 \
                     AND abs(COALESCE((SELECT sum(COALESCE((l->>'debit')::numeric, 0) - COALESCE((l->>'credit')::numeric, 0)) \
                       FROM jsonb_array_elements(COALESCE(j.lines, '[]'::jsonb)) l \
                       WHERE l->>'account' = a.id::text), 0) - CASE WHEN b.direction = 'credit' \
                       THEN COALESCE(b.base_amount, b.amount)::numeric ELSE -COALESCE(b.base_amount, b.amount)::numeric END) <= 0.005 \
                 ) OR EXISTS ( \
                   SELECT 1 FROM accounting__journal_entry j \
                   JOIN accounting__account a ON a.tenant_id = j.tenant_id AND a.code = '112' \
                   WHERE j.tenant_id = b.tenant_id AND j.id = b.journal_entry AND j.status = 'posted' \
                     AND abs(COALESCE((SELECT sum(COALESCE((l->>'debit')::numeric, 0) - COALESCE((l->>'credit')::numeric, 0)) \
                       FROM jsonb_array_elements(COALESCE(j.lines, '[]'::jsonb)) l \
                       WHERE l->>'account' = a.id::text), 0) - CASE WHEN b.direction = 'credit' \
                       THEN COALESCE(b.base_amount, b.amount)::numeric ELSE -COALESCE(b.base_amount, b.amount)::numeric END) <= 0.005 \
                 ) \
               ) \
             )",
            &[&tenant.id, &statement],
        )
        .await?
        .get(0);
    if invalid_matches > 0 {
        errors.push("Một dòng đã khớp không còn payment hoặc bút toán TK 112 hợp lệ".into());
    }
    Ok(errors)
}
