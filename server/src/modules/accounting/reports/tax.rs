use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::NaiveDate;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

#[derive(Default)]
struct TaxBucket {
    rate: Option<Decimal>,
    name: String,
    invoiced_base: Decimal,
    invoiced_tax: Decimal,
    credited_base: Decimal,
    credited_tax: Decimal,
    billed_base: Decimal,
    billed_tax: Decimal,
    debited_base: Decimal,
    debited_tax: Decimal,
    invoices: HashSet<String>,
    credit_notes: HashSet<String>,
    bills: HashSet<String>,
    debit_notes: HashSet<String>,
}

impl TaxBucket {
    fn add(&mut self, kind: &str, id: &str, base: Decimal, tax: Decimal) -> R<()> {
        let (ids, base_total, tax_total) = match kind {
            "invoice" => (
                &mut self.invoices,
                &mut self.invoiced_base,
                &mut self.invoiced_tax,
            ),
            "credit_note" => (
                &mut self.credit_notes,
                &mut self.credited_base,
                &mut self.credited_tax,
            ),
            "bill" => (&mut self.bills, &mut self.billed_base, &mut self.billed_tax),
            "debit_note" => (
                &mut self.debit_notes,
                &mut self.debited_base,
                &mut self.debited_tax,
            ),
            _ => return Ok(()),
        };
        ids.insert(id.to_owned());
        add_amount(base_total, base)?;
        add_amount(tax_total, tax)
    }
}

const TAX_REGISTER_SQL: &str = r#"SELECT i.id::text, COALESCE(i.base_total, i.total)::text, COALESCE(i.base_tax_total, i.tax_total, 0)::text, COALESCE(i.lines, '[]'::jsonb), COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 1::int, 'invoice'::text, COALESCE(p.name, ''), COALESCE(p.tax_code, ''), COALESCE(currency.code, ''), COALESCE(i.exchange_rate, 1)::text
FROM accounting__invoice i
JOIN accounting__journal_entry j ON j.tenant_id = i.tenant_id AND j.source = 'invoice' AND j.source_id = i.id::text AND j.status = 'posted'
LEFT JOIN master_data__party p ON p.tenant_id = i.tenant_id AND p.id = i.party
LEFT JOIN master_data__currency currency ON currency.tenant_id = i.tenant_id AND currency.id = i.currency
WHERE i.tenant_id = $1 AND i.status NOT IN ('draft', 'void')
  AND ($2::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) >= $2::date)
  AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) <= $3::date)
UNION ALL
SELECT c.id::text, COALESCE(c.base_total, c.total)::text, COALESCE(c.base_tax_total, c.tax_total, 0)::text, COALESCE(c.lines, sr.lines, '[]'::jsonb), COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), -1::int, 'credit_note'::text, COALESCE(p.name, ''), COALESCE(p.tax_code, ''), COALESCE(currency.code, ''), COALESCE(c.exchange_rate, 1)::text
FROM accounting__credit_note c
LEFT JOIN sales__sales_return sr ON sr.tenant_id = c.tenant_id AND c.source = 'sales_return' AND c.source_id = sr.id::text
LEFT JOIN accounting__invoice source_invoice ON source_invoice.tenant_id = c.tenant_id AND source_invoice.id = c.invoice
LEFT JOIN master_data__party p ON p.tenant_id = c.tenant_id AND p.id = source_invoice.party
LEFT JOIN master_data__currency currency ON currency.tenant_id = c.tenant_id AND currency.id = c.currency
JOIN accounting__journal_entry j ON j.tenant_id = c.tenant_id AND j.source = 'credit_note' AND j.source_id = c.id::text AND j.status = 'posted'
WHERE c.tenant_id = $1 AND c.status = 'posted'
  AND (c.source IS DISTINCT FROM 'sales_return' OR sr.status = 'received')
  AND ($2::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) >= $2::date)
  AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) <= $3::date)
UNION ALL
SELECT b.id::text, COALESCE(b.base_total, b.total)::text, COALESCE(b.base_tax_total, b.tax_total, 0)::text, COALESCE(b.lines, po.lines, '[]'::jsonb), COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), 1::int, 'bill'::text, COALESCE(p.name, ''), COALESCE(p.tax_code, ''), COALESCE(currency.code, ''), COALESCE(b.exchange_rate, 1)::text
FROM accounting__bill b
LEFT JOIN purchasing__purchase_order po ON po.tenant_id = b.tenant_id AND b.source = 'purchase_order' AND b.source_id = po.id::text
LEFT JOIN master_data__party p ON p.tenant_id = b.tenant_id AND p.id = b.supplier
LEFT JOIN master_data__currency currency ON currency.tenant_id = b.tenant_id AND currency.id = b.currency
JOIN accounting__journal_entry j ON j.tenant_id = b.tenant_id AND j.source = 'bill' AND j.source_id = b.id::text AND j.status = 'posted'
WHERE b.tenant_id = $1 AND b.status NOT IN ('draft', 'void')
  AND ($2::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) >= $2::date)
  AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) <= $3::date)
UNION ALL
SELECT d.id::text, COALESCE(d.base_total, d.total)::text, COALESCE(d.base_tax_total, d.tax_total, 0)::text, COALESCE(d.lines, pr.lines, '[]'::jsonb), COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date), -1::int, 'debit_note'::text, COALESCE(p.name, ''), COALESCE(p.tax_code, ''), COALESCE(currency.code, ''), COALESCE(d.exchange_rate, 1)::text
FROM accounting__debit_note d
LEFT JOIN purchasing__purchase_return pr ON pr.tenant_id = d.tenant_id AND d.source = 'purchase_return' AND d.source_id = pr.id::text
LEFT JOIN accounting__bill source_bill ON source_bill.tenant_id = d.tenant_id AND source_bill.id = d.bill
LEFT JOIN master_data__party p ON p.tenant_id = d.tenant_id AND p.id = source_bill.supplier
LEFT JOIN master_data__currency currency ON currency.tenant_id = d.tenant_id AND currency.id = d.currency
JOIN accounting__journal_entry j ON j.tenant_id = d.tenant_id AND j.source = 'debit_note' AND j.source_id = d.id::text AND j.status = 'posted'
WHERE d.tenant_id = $1 AND d.status = 'posted'
  AND (d.source IS DISTINCT FROM 'purchase_return' OR pr.status = 'dispatched')
  AND ($2::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) >= $2::date)
  AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) <= $3::date)
UNION ALL
SELECT p.id::text, abs(COALESCE(p.base_amount, p.amount))::text, abs(COALESCE(p.base_tax_amount, p.tax_amount, 0))::text,
       CASE WHEN p.tax_rate IS NULL OR p.tax_amount IS NULL THEN '[]'::jsonb ELSE
         jsonb_build_array(jsonb_build_object(
           'net_amount', abs(p.amount) - abs(p.tax_amount),
           'line_total', abs(p.amount),
           'tax_amount', abs(p.tax_amount),
           'tax_rate', p.tax_rate,
           'tax_name', COALESCE(NULLIF(p.tax_name, ''), 'Ticket VAT')
         )) END,
       COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date),
       CASE WHEN p.source IN ('ticket', 'pos_order') THEN 1 ELSE -1 END::int,
       CASE WHEN p.source IN ('ticket', 'pos_order') THEN 'invoice'::text ELSE 'credit_note'::text END,
       COALESCE(party.name, ''), COALESCE(party.tax_code, ''), COALESCE(currency.code, ''), COALESCE(p.exchange_rate, 1)::text
FROM accounting__payment p
JOIN accounting__journal_entry j ON j.tenant_id = p.tenant_id AND j.status = 'posted'
  AND ((p.source = 'ticket' AND j.source = 'payment' AND j.source_id = p.id::text)
    OR (p.source = 'event_ticket_refund' AND j.source = 'ticket_refund' AND j.source_id = p.source_id)
    OR (p.source = 'pos_order' AND j.source = 'payment' AND j.source_id = p.id::text)
    OR (p.source = 'pos_order_refund' AND j.source = 'pos_refund' AND j.source_id = p.source_id))
LEFT JOIN master_data__party party ON party.tenant_id = p.tenant_id AND party.id = p.party
LEFT JOIN master_data__currency currency ON currency.tenant_id = p.tenant_id AND currency.id = p.currency
WHERE p.tenant_id = $1 AND p.source IN ('ticket', 'event_ticket_refund', 'pos_order', 'pos_order_refund')
  AND abs(COALESCE(p.tax_amount, 0)) > 0.005
  AND ($2::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) >= $2::date)
  AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE 'UTC')::date) <= $3::date)
ORDER BY 5, 1"#;

use super::common::parse_date;

fn report_amount_error() -> ApiError {
    ApiError::validation(
        "accounting.tax_register",
        vec!["A tax-register amount exceeds the supported decimal range".into()],
    )
}

fn row_amount(row: &tokio_postgres::Row, column: usize) -> R<Decimal> {
    let value: String = row.get(column);
    crate::money::decimal_str(&value).ok_or_else(report_amount_error)
}

fn round_tax_amount(value: Decimal) -> Decimal {
    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

fn add_amount(total: &mut Decimal, amount: Decimal) -> R<()> {
    *total = total.checked_add(amount).ok_or_else(report_amount_error)?;
    Ok(())
}

fn subtract_amount(left: Decimal, right: Decimal) -> R<Decimal> {
    left.checked_sub(right).ok_or_else(report_amount_error)
}

fn decimal_json(value: Decimal) -> R<Value> {
    crate::money::json_number(value).ok_or_else(report_amount_error)
}

fn insert_decimal(object: &mut Value, field: &str, value: Decimal) -> R<()> {
    object[field] = decimal_json(value)?;
    Ok(())
}

impl Kernel {
    /// Summarize posted output and recoverable input tax by journal posting date.
    pub async fn accounting_tax_register(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        let from = parse_date(from, "from")?;
        let to = parse_date(to, "to")?;
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err(ApiError::new(
                422,
                "INVALID_DATE_RANGE",
                "from must be on or before to",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let rows = tx
            .query(TAX_REGISTER_SQL, &[&tenant.id, &from, &to])
            .await?;

        let mut buckets = BTreeMap::<String, TaxBucket>::new();
        let mut invoice_count = 0_u64;
        let mut credit_note_count = 0_u64;
        let mut invoice_base = Decimal::ZERO;
        let mut invoice_tax = Decimal::ZERO;
        let mut credit_base = Decimal::ZERO;
        let mut credit_tax = Decimal::ZERO;
        let mut bill_count = 0_u64;
        let mut debit_note_count = 0_u64;
        let mut bill_base = Decimal::ZERO;
        let mut bill_tax = Decimal::ZERO;
        let mut debit_base = Decimal::ZERO;
        let mut debit_tax = Decimal::ZERO;
        let mut tax_documents = Vec::new();
        for row in rows {
            let id: String = row.get(0);
            let total = row_amount(&row, 1)?;
            let document_tax = row_amount(&row, 2)?;
            let mut lines: Value = row.get(3);
            let posting_date: NaiveDate = row.get(4);
            let _sign: i32 = row.get(5);
            let kind: String = row.get(6);
            let counterparty: String = row.get(7);
            let tax_code: String = row.get(8);
            let currency_code: String = row.get(9);
            let exchange_rate = row_amount(&row, 10)?;
            let document_base = subtract_amount(total, document_tax)?;
            match kind.as_str() {
                "invoice" => {
                    invoice_count += 1;
                    add_amount(&mut invoice_base, document_base)?;
                    add_amount(&mut invoice_tax, document_tax)?;
                }
                "credit_note" => {
                    credit_note_count += 1;
                    add_amount(&mut credit_base, document_base)?;
                    add_amount(&mut credit_tax, document_tax)?;
                }
                "bill" => {
                    bill_count += 1;
                    add_amount(&mut bill_base, document_base)?;
                    add_amount(&mut bill_tax, document_tax)?;
                }
                "debit_note" => {
                    debit_note_count += 1;
                    add_amount(&mut debit_base, document_base)?;
                    add_amount(&mut debit_tax, document_tax)?;
                }
                _ => continue,
            }

            let mut line_base_total = Decimal::ZERO;
            let mut line_tax_total = Decimal::ZERO;
            if let Some(lines) = lines.as_array_mut() {
                for line in lines {
                    let source_tax = line
                        .get("tax_amount")
                        .and_then(crate::money::decimal)
                        .unwrap_or(Decimal::ZERO);
                    let source_base = line
                        .get("net_amount")
                        .and_then(crate::money::decimal)
                        .or_else(|| {
                            line.get("line_total")
                                .and_then(crate::money::decimal)
                                .and_then(|line_total| line_total.checked_sub(source_tax))
                        })
                        .unwrap_or(Decimal::ZERO);
                    if exchange_rate <= Decimal::ZERO {
                        continue;
                    }
                    let base = round_tax_amount(
                        source_base
                            .checked_mul(exchange_rate)
                            .ok_or_else(report_amount_error)?,
                    );
                    let tax = round_tax_amount(
                        source_tax
                            .checked_mul(exchange_rate)
                            .ok_or_else(report_amount_error)?,
                    );
                    if let Some(line) = line.as_object_mut() {
                        line.insert("base_net_amount".into(), decimal_json(base)?);
                        line.insert("base_tax_amount".into(), decimal_json(tax)?);
                    }
                    add_amount(&mut line_base_total, base)?;
                    add_amount(&mut line_tax_total, tax)?;
                    let rate = line.get("tax_rate").and_then(crate::money::decimal);
                    let name = line
                        .get("tax_name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.trim().is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| {
                            if rate == Some(Decimal::ZERO) {
                                "No tax"
                            } else {
                                "Unallocated tax"
                            }
                            .into()
                        });
                    let key = rate
                        .map(|rate| format!("{rate:.4}|{}", name.to_lowercase()))
                        .unwrap_or_else(|| format!("unallocated|{}", name.to_lowercase()));
                    let bucket = buckets.entry(key).or_default();
                    bucket.rate = rate;
                    bucket.name = name;
                    bucket.add(&kind, &id, base, tax)?;
                }
            }
            let mut tax_document = json!({
                "id": id,
                "kind": kind,
                "postingDate": posting_date.to_string(),
                "counterparty": counterparty,
                "taxCode": tax_code,
                "currency": currency_code,
                "exchangeRate": null,
                "total": null,
                "taxTotal": null,
                "lines": lines,
            });
            insert_decimal(&mut tax_document, "exchangeRate", exchange_rate)?;
            insert_decimal(&mut tax_document, "total", total)?;
            insert_decimal(&mut tax_document, "taxTotal", document_tax)?;
            tax_documents.push(tax_document);
            let residual_base =
                subtract_amount(subtract_amount(total, document_tax)?, line_base_total)?;
            let residual_tax = subtract_amount(document_tax, line_tax_total)?;
            let tolerance = Decimal::new(5, 3);
            if !crate::money::within_tolerance(residual_base, Decimal::ZERO, tolerance)
                || !crate::money::within_tolerance(residual_tax, Decimal::ZERO, tolerance)
            {
                let key = "unallocated|unallocated tax".to_string();
                let bucket = buckets.entry(key).or_default();
                bucket.rate = None;
                bucket.name = "Unallocated tax".into();
                bucket.add(&kind, &id, residual_base, residual_tax)?;
            }
        }
        let mut by_rate = Vec::new();
        for bucket in buckets.into_values() {
            let taxable_base = subtract_amount(bucket.invoiced_base, bucket.credited_base)?;
            let output_tax = subtract_amount(bucket.invoiced_tax, bucket.credited_tax)?;
            let taxable_purchase_base = subtract_amount(bucket.billed_base, bucket.debited_base)?;
            let input_tax = subtract_amount(bucket.billed_tax, bucket.debited_tax)?;
            let net_tax_position = subtract_amount(output_tax, input_tax)?;
            let mut row = json!({
                "taxName": bucket.name,
                "taxRate": null,
                "invoiceCount": bucket.invoices.len(),
                "creditNoteCount": bucket.credit_notes.len(),
                "billCount": bucket.bills.len(),
                "debitNoteCount": bucket.debit_notes.len(),
            });
            if let Some(rate) = bucket.rate {
                row["taxRate"] = decimal_json(rate)?;
            }
            for (field, value) in [
                ("invoicedBase", bucket.invoiced_base),
                ("invoicedTax", bucket.invoiced_tax),
                ("creditedBase", bucket.credited_base),
                ("creditedTax", bucket.credited_tax),
                ("taxableBase", taxable_base),
                ("outputTax", output_tax),
                ("netTaxPosition", net_tax_position),
                ("billedBase", bucket.billed_base),
                ("billedTax", bucket.billed_tax),
                ("debitedBase", bucket.debited_base),
                ("debitedTax", bucket.debited_tax),
                ("taxablePurchaseBase", taxable_purchase_base),
                ("inputTax", input_tax),
            ] {
                insert_decimal(&mut row, field, value)?;
            }
            by_rate.push(row);
        }
        by_rate.sort_by(|left, right| {
            let left_rate = left.get("taxRate").and_then(crate::money::decimal);
            let right_rate = right.get("taxRate").and_then(crate::money::decimal);
            match (left_rate, right_rate) {
                (Some(left), Some(right)) => left.cmp(&right),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
        let taxable_base = subtract_amount(invoice_base, credit_base)?;
        let output_tax = subtract_amount(invoice_tax, credit_tax)?;
        let taxable_purchase_base = subtract_amount(bill_base, debit_base)?;
        let input_tax = subtract_amount(bill_tax, debit_tax)?;
        let net_tax_position = subtract_amount(output_tax, input_tax)?;
        let mut report = json!({
            "from": from,
            "to": to,
            "invoiceCount": invoice_count,
            "creditNoteCount": credit_note_count,
            "billCount": bill_count, "debitNoteCount": debit_note_count,
            "byRate": by_rate,
            "documents": tax_documents,
        });
        for (field, value) in [
            ("invoicedBase", invoice_base),
            ("invoicedTax", invoice_tax),
            ("creditedBase", credit_base),
            ("creditedTax", credit_tax),
            ("taxableBase", taxable_base),
            ("outputTax", output_tax),
            ("billedBase", bill_base),
            ("billedTax", bill_tax),
            ("debitedBase", debit_base),
            ("debitedTax", debit_tax),
            ("taxablePurchaseBase", taxable_purchase_base),
            ("inputTax", input_tax),
            ("netTaxPosition", net_tax_position),
        ] {
            insert_decimal(&mut report, field, value)?;
        }
        Ok(report)
    }
}
