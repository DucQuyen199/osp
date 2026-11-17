use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;

mod accounts;
mod bank_statements;
mod documents;
mod journals;
mod payments;
mod periods;
mod settlement_batches;
mod stock_posting;

pub use stock_posting::post_stock_movement;
use uuid::Uuid;

pub(super) fn decimal_amount(document: &Value, field: &str) -> Option<Decimal> {
    money::decimal(document.get(field)?)
}

fn payment_amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

fn accounting_amount_overflow() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "accounting.document",
        vec!["A document balance exceeds the supported decimal range".into()],
    )
}

pub(super) fn purchase_line_amounts(lines: &Value) -> Option<BTreeMap<String, (Decimal, Decimal)>> {
    let lines = lines.as_array()?;
    let mut amounts = BTreeMap::new();
    for line in lines {
        let product = line.get("product")?.as_str()?.to_owned();
        let qty = crate::money::decimal(line.get("qty")?)?;
        let net = line
            .get("net_amount")
            .and_then(crate::money::decimal)
            .or_else(|| crate::money::amount(qty, crate::money::decimal(line.get("price")?)?))?;
        if product.is_empty() || qty <= Decimal::ZERO || net < Decimal::ZERO {
            return None;
        }
        let entry = amounts
            .entry(product)
            .or_insert((Decimal::ZERO, Decimal::ZERO));
        entry.0 = entry.0.checked_add(qty)?;
        entry.1 = entry.1.checked_add(net)?;
    }
    Some(amounts)
}

pub(super) fn database_amount(row: &tokio_postgres::Row, column: usize) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.document",
            vec!["A stored financial amount exceeds the supported decimal range".into()],
        )
    })
}

pub(super) fn database_optional_amount(
    row: &tokio_postgres::Row,
    column: usize,
) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            crate::money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "accounting.document",
                    vec!["A stored financial amount exceeds the supported decimal range".into()],
                )
            })
        })
        .transpose()
}

pub(super) async fn lock_period_calendar(tx: &Tx<'_>, tenant: &Tenant) -> R<()> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("accounting.period_calendar:{}", tenant.id)],
    )
    .await?;
    Ok(())
}

pub(super) fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub(super) async fn overlaps_closed_period(
    tx: &Tx<'_>,
    tenant: &Tenant,
    start: NaiveDate,
    end: NaiveDate,
) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT 1 FROM accounting__period WHERE tenant_id = $1 AND status = 'period_closed' AND start_date <= $3 AND end_date >= $2 LIMIT 1",
            &[&tenant.id, &start, &end],
        )
        .await?
        .is_some())
}

/// Cross-record checks stay inside the caller's tenant transaction.
pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "period" {
        return periods::validate_persistence(tx, tenant, action, document).await;
    }
    if matches!(entity, "bank_statement" | "bank_statement_line") {
        return bank_statements::validate_persistence(tx, tenant, entity, action, document).await;
    }
    if entity == "account" {
        return accounts::validate_persistence(tx, tenant, action, document).await;
    }
    if entity == "settlement_batch" {
        return settlement_batches::validate(tx, tenant, action, document).await;
    }
    let mut errors = Vec::new();
    if entity == "journal_entry" {
        errors.extend(journals::validate_journal_line_references(tx, tenant, document).await?);
        if action == "submitted" {
            if document
                .get("source")
                .and_then(Value::as_str)
                .is_some_and(|source| !source.trim().is_empty())
            {
                errors.push("Only manual journal entries can be submitted for approval".into());
            }
            if !tenant.has_module("workflow-approval") {
                errors.push("Enable workflow-approval before submitting a manual journal".into());
            } else if let Some(total) =
                document
                    .get("lines")
                    .and_then(Value::as_array)
                    .and_then(|lines| {
                        lines.iter().try_fold(Decimal::ZERO, |total, line| {
                            let debit = money::decimal(line.get("debit")?)?;
                            total.checked_add(debit)
                        })
                    })
            {
                let amount = total.normalize().to_string();
                if tx.query_opt(
                    "SELECT 1 FROM workflow_approval__approval_rule WHERE tenant_id = $1 AND entity = 'accounting.journal_entry' AND (min_amount IS NULL OR min_amount <= $2::text::numeric) LIMIT 1",
                    &[&tenant.id, &amount],
                ).await?.is_none() {
                    errors.push("Configure an applicable journal entry approval rule before submitting".into());
                }
            }
        }
        if matches!(action, "created" | "updated" | "posted")
            && document.get("source").and_then(Value::as_str) == Some("ticket_refund")
        {
            errors.extend(journals::validate_ticket_refund_journal(tx, tenant, document).await?);
        }
    }
    match (entity, action) {
        ("journal_entry", "posted") => {
            lock_period_calendar(tx, tenant).await?;
            let posting_date =
                date(document, "posting_date").unwrap_or_else(|| tenant.business_today());
            if tx
                .query_opt(
                    "SELECT id FROM accounting__period WHERE tenant_id = $1 AND status = 'period_closed' AND start_date <= $2 AND end_date >= $2 LIMIT 1",
                    &[&tenant.id, &posting_date],
                )
                .await?
                .is_some()
            {
                errors.push(format!(
                    "Không thể ghi sổ vào kỳ đã khóa ({posting_date})"
                ));
            }
        }
        ("journal_entry", "created" | "updated") => {
            lock_period_calendar(tx, tenant).await?;
            let posting_date =
                date(document, "posting_date").unwrap_or_else(|| tenant.business_today());
            if tx
                .query_opt(
                    "SELECT id FROM accounting__period WHERE tenant_id = $1 AND status = 'period_closed' AND start_date <= $2 AND end_date >= $2 LIMIT 1",
                    &[&tenant.id, &posting_date],
                )
                .await?
                .is_some()
            {
                errors.push(format!(
                    "Không thể tạo hoặc sửa bút toán trong kỳ đã khóa ({posting_date})"
                ));
            }
        }
        ("payment", "created" | "updated") => {
            errors.extend(payments::validate_payment(tx, tenant, document).await?);
        }
        ("expense_claim", "approved") if tenant.has_module("accounting") => {
            for code in ["642", "334"] {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
                }
            }
        }
        ("invoice" | "bill" | "credit_note" | "debit_note", "posted") => {
            errors.extend(documents::validate_posted_document(tx, tenant, entity, document).await?);
        }
        ("invoice" | "bill", "partially_paid" | "partially_settled" | "paid" | "settled") => {
            let Some(id) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|v| Uuid::parse_str(v).ok())
            else {
                return Ok(vec!["Không xác định được hóa đơn cần thanh toán".into()]);
            };
            let (fk, note_table, note_fk) = if entity == "invoice" {
                ("invoice", "accounting__credit_note", "invoice")
            } else {
                ("bill", "accounting__debit_note", "bill")
            };
            let payment_sql = format!(
                "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {fk} = $2"
            );
            let paid_row = tx.query_opt(&payment_sql, &[&tenant.id, &id]).await?;
            let paid = match paid_row {
                Some(row) => database_amount(&row, 0)?,
                None => Decimal::ZERO,
            };
            let note_sql = format!(
                "SELECT COALESCE(SUM(total), 0)::text FROM {note_table} WHERE tenant_id = $1 AND {note_fk} = $2 AND status = 'posted'"
            );
            let adjusted_row = tx.query_opt(&note_sql, &[&tenant.id, &id]).await?;
            let adjusted = match adjusted_row {
                Some(row) => database_amount(&row, 0)?,
                None => Decimal::ZERO,
            };
            let total = decimal_amount(document, "total").unwrap_or(Decimal::ZERO);
            let covered = paid
                .checked_add(adjusted)
                .ok_or_else(accounting_amount_overflow)?;
            let tolerance = payment_amount_tolerance();
            let remains_outstanding = total
                .checked_sub(tolerance)
                .is_some_and(|threshold| covered < threshold);
            let paid_in_full = paid
                .checked_add(tolerance)
                .is_some_and(|paid| paid >= total);
            let valid = match action {
                "partially_paid" => {
                    paid > tolerance && adjusted <= tolerance && remains_outstanding
                }
                "partially_settled" => adjusted > tolerance && remains_outstanding,
                "paid" => paid_in_full,
                "settled" => {
                    covered
                        .checked_add(tolerance)
                        .is_some_and(|covered| covered >= total)
                        && adjusted > tolerance
                }
                _ => false,
            };
            if !valid {
                errors.push(match action {
                    "partially_paid" => {
                        "Trạng thái thanh toán một phần cần có số đã trả nhưng vẫn còn số dư".into()
                    }
                    "partially_settled" => {
                        "Trạng thái cấn trừ một phần cần có điều chỉnh giảm và vẫn còn số dư".into()
                    }
                    "paid" => {
                        "Hóa đơn chỉ chuyển sang đã thanh toán khi tổng payment đủ toàn bộ".into()
                    }
                    _ => "Hóa đơn chỉ được tất toán khi tiền đã trả và điều chỉnh giảm đủ tổng"
                        .into(),
                });
            }
        }
        ("invoice" | "bill", "void") => {
            let fk = if entity == "invoice" {
                "invoice"
            } else {
                "bill"
            };
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|v| Uuid::parse_str(v).ok());
            if let Some(id) = id {
                let sql = format!(
                    "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND {fk} = $2 LIMIT 1"
                );
                if tx.query_opt(&sql, &[&tenant.id, &id]).await?.is_some() {
                    errors.push("Không thể hủy hóa đơn đã có payment".into());
                }
                if entity == "bill"
                    && tx.query_opt(
                        "SELECT 1 FROM accounting__debit_note WHERE tenant_id = $1 AND bill = $2 AND status = 'posted' LIMIT 1",
                        &[&tenant.id, &id],
                    ).await?.is_some()
                {
                    errors.push("Không thể hủy hóa đơn mua đã có chứng từ điều chỉnh".into());
                }
                if entity == "invoice"
                    && tx.query_opt(
                        "SELECT 1 FROM accounting__credit_note WHERE tenant_id = $1 AND invoice = $2 AND status = 'posted' LIMIT 1",
                        &[&tenant.id, &id],
                    ).await?.is_some()
                {
                    errors.push("Không thể hủy hóa đơn đã có credit note".into());
                }
                if entity == "invoice" && tenant.has_module("einvoice") {
                    if let Some(einvoice) = tx
                        .query_opt(
                            "SELECT status, COALESCE(operation, 'issue'), COALESCE(attempts, 0)::bigint FROM einvoice__einvoice WHERE tenant_id = $1 AND invoice = $2",
                            &[&tenant.id, &id],
                        )
                        .await?
                    {
                        let status: String = einvoice.get(0);
                        let operation: String = einvoice.get(1);
                        let attempts: i64 = einvoice.get(2);
                        let unresolved = matches!(
                            status.as_str(),
                            "pending" | "issued" | "cancellation_pending"
                        ) || (status == "failed" && (operation == "cancel" || attempts > 0));
                        if unresolved {
                            errors.push("Cần xử lý yêu cầu hóa đơn điện tử trước khi hủy hóa đơn kế toán".into());
                        }
                    }
                }
            }
        }
        ("journal_entry", "reversed") => {
            if document.get("source").and_then(Value::as_str) == Some("production_qc_scrap") {
                errors.push("Không đảo trực tiếp bút toán loại bỏ thành phẩm; cần lập nghiệp vụ điều chỉnh QC và số lượng tương ứng".into());
            }
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let Some(id) = id {
                let lock_key = format!("accounting.journal_reversal:{}:{}", tenant.id, id);
                tx.query_opt(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    &[&lock_key],
                )
                .await?;
                if tx
                    .query_opt(
                        "SELECT id FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'reversal' AND source_id = $2 LIMIT 1",
                        &[&tenant.id, &id.to_string()],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Bút toán này đã có chứng từ đảo".into());
                }
            } else {
                errors.push("Không xác định được bút toán gốc cần đảo".into());
            }
            if document.get("status").and_then(Value::as_str) != Some("posted") {
                errors.push("Chỉ đảo bút toán đã ghi sổ".into());
            }
        }
        _ => {}
    }
    Ok(errors)
}
