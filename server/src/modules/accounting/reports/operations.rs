use super::common::parse_date;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use rust_decimal::Decimal;
use serde_json::{Value, json};

fn report_amount_error() -> ApiError {
    ApiError::validation(
        "accounting.report",
        vec!["Calculated report amount exceeds the supported decimal range".into()],
    )
}

fn add_amount(left: Decimal, right: Decimal) -> R<Decimal> {
    left.checked_add(right).ok_or_else(report_amount_error)
}

fn amount_value(value: Decimal) -> R<Value> {
    crate::money::json_number(value).ok_or_else(report_amount_error)
}

fn row_amount(row: &Value, field: &str) -> R<Decimal> {
    let Some(value) = row.get(field).filter(|value| !value.is_null()) else {
        return Ok(Decimal::ZERO);
    };
    crate::money::decimal(value).ok_or_else(|| {
        ApiError::validation(
            "accounting.report",
            vec![format!(
                "Stored {field} exceeds the supported decimal range"
            )],
        )
    })
}

impl Kernel {
    /// Open receivable/payable balances grouped into aging buckets by party.
    pub async fn accounting_aging_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        kind: &str,
        as_of: Option<&str>,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        let as_of = parse_date(as_of, "asOf")?.unwrap_or_else(|| tenant.business_today());
        let (document_table, party_field, note_table, note_field, note_source, kind_label) =
            match kind {
                "receivables" => (
                    "accounting__invoice",
                    "party",
                    "accounting__credit_note",
                    "invoice",
                    "credit_note",
                    "receivables",
                ),
                "payables" => (
                    "accounting__bill",
                    "supplier",
                    "accounting__debit_note",
                    "bill",
                    "debit_note",
                    "payables",
                ),
                _ => {
                    return Err(ApiError::new(
                        404,
                        "UNKNOWN_REPORT",
                        "Unknown accounting aging report",
                    ));
                }
            };
        let sql = format!(
            "WITH open_documents AS ( \
                SELECT d.id, d.{party_field} AS party_id, p.name AS party_name, \
                       COALESCE(d.due_date, d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) AS due_date, \
                       GREATEST(COALESCE(d.base_total, d.total)::numeric \
                         - COALESCE((SELECT SUM(COALESCE(pm.applied_base_amount, pm.amount))::numeric FROM accounting__payment pm \
                           LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                           WHERE pm.tenant_id = d.tenant_id AND pm.{note_field} = d.id \
                             AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                             AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $2::date) \
                               OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.invoice IS NOT DISTINCT FROM pm.invoice AND refund.bill IS NOT DISTINCT FROM pm.bill AND (refund.created_at AT TIME ZONE 'UTC')::date <= $2::date))), 0) \
                         - COALESCE((SELECT SUM(COALESCE(n.base_total, n.total))::numeric FROM {note_table} n \
                           LEFT JOIN accounting__journal_entry nj ON nj.tenant_id = n.tenant_id AND nj.source = '{note_source}' AND nj.source_id = n.id::text AND nj.status IN ('posted', 'reversed') \
                           WHERE n.tenant_id = d.tenant_id AND n.{note_field} = d.id AND n.status = 'posted' \
                             AND COALESCE(nj.posting_date, (n.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                             AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry nr WHERE nr.tenant_id = n.tenant_id AND nr.source = 'reversal' AND nr.source_id = nj.id::text AND nr.status IN ('posted', 'reversed') AND COALESCE(nr.posting_date, (nr.created_at AT TIME ZONE 'UTC')::date) <= $2::date)), 0), 0) AS balance \
                FROM {document_table} d \
                JOIN master_data__party p ON p.tenant_id = d.tenant_id AND p.id = d.{party_field} \
                WHERE d.tenant_id = $1 AND d.status NOT IN ('draft', 'void') \
                  AND COALESCE(d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
             ), aged AS ( \
                SELECT *, ($2::date - due_date) AS age_days FROM open_documents WHERE balance > 0 \
             ) SELECT jsonb_build_object( \
                'partyId', party_id, 'party', party_name, 'documents', count(*), \
                'notDue', COALESCE(sum(balance) FILTER (WHERE age_days < 0), 0), \
                'dueToday', COALESCE(sum(balance) FILTER (WHERE age_days = 0), 0), \
                'days1To30', COALESCE(sum(balance) FILTER (WHERE age_days BETWEEN 1 AND 30), 0), \
                'days31To60', COALESCE(sum(balance) FILTER (WHERE age_days BETWEEN 31 AND 60), 0), \
                'days61To90', COALESCE(sum(balance) FILTER (WHERE age_days BETWEEN 61 AND 90), 0), \
                'over90Days', COALESCE(sum(balance) FILTER (WHERE age_days > 90), 0), \
                'total', COALESCE(sum(balance), 0) \
             ) FROM aged GROUP BY party_id, party_name ORDER BY party_name, party_id"
        );
        let sql = sql.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE $3");
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let parties = tx
            .query_json(
                &sql,
                &[&tenant.id, &as_of, &tenant.business_timezone().to_string()],
            )
            .await?;
        let bucket_fields = [
            "notDue",
            "dueToday",
            "days1To30",
            "days31To60",
            "days61To90",
            "over90Days",
            "total",
        ];
        let mut totals = serde_json::Map::new();
        for field in bucket_fields {
            let total = parties.iter().try_fold(Decimal::ZERO, |total, party| {
                let amount = row_amount(party, field)?;
                add_amount(total, amount)
            })?;
            totals.insert(field.into(), amount_value(total)?);
        }
        Ok(json!({ "kind": kind_label, "asOf": as_of, "parties": parties, "totals": totals }))
    }

    /// Forecasts outstanding posted receivables/payables and approved purchase orders.
    pub async fn accounting_cash_flow_forecast(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        let as_of = tenant.business_today();
        let from = parse_date(from, "from")?.unwrap_or(as_of);
        let to = parse_date(to, "to")?.unwrap_or(from + chrono::Days::new(90));
        if from > to {
            return Err(ApiError::new(
                422,
                "INVALID_DATE_RANGE",
                "from must be on or before to",
            ));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let sql = "WITH open_documents AS ( \
                   SELECT 'receivable'::text AS kind, i.id::text AS document_id, COALESCE(p.name, '') AS party, \
                          COALESCE(i.due_date, i.issue_date, (i.created_at AT TIME ZONE 'UTC')::date) AS due_date, \
                          GREATEST(COALESCE(i.base_total, i.total)::numeric \
                            - COALESCE((SELECT SUM(COALESCE(pm.applied_base_amount, pm.amount))::numeric FROM accounting__payment pm \
                              LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                              WHERE pm.tenant_id = i.tenant_id AND pm.invoice = i.id \
                                AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                                AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $2::date) \
                                  OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.invoice IS NOT DISTINCT FROM pm.invoice AND refund.bill IS NOT DISTINCT FROM pm.bill AND (refund.created_at AT TIME ZONE 'UTC')::date <= $2::date))), 0) \
                            - COALESCE((SELECT SUM(COALESCE(c.base_total, c.total))::numeric FROM accounting__credit_note c \
                              LEFT JOIN accounting__journal_entry cj ON cj.tenant_id = c.tenant_id AND cj.source = 'credit_note' AND cj.source_id = c.id::text AND cj.status IN ('posted', 'reversed') \
                              WHERE c.tenant_id = i.tenant_id AND c.invoice = i.id AND c.status = 'posted' \
                                AND COALESCE(cj.posting_date, (c.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                                AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry cr WHERE cr.tenant_id = c.tenant_id AND cr.source = 'reversal' AND cr.source_id = cj.id::text AND cr.status IN ('posted', 'reversed') AND COALESCE(cr.posting_date, (cr.created_at AT TIME ZONE 'UTC')::date) <= $2::date)), 0), 0) AS balance \
                   FROM accounting__invoice i JOIN master_data__party p ON p.tenant_id = i.tenant_id AND p.id = i.party \
                   WHERE i.tenant_id = $1 AND i.status NOT IN ('draft', 'void') \
                     AND COALESCE(i.issue_date, (i.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                   UNION ALL \
                   SELECT 'payable'::text AS kind, b.id::text AS document_id, COALESCE(p.name, '') AS party, \
                          COALESCE(b.due_date, b.issue_date, (b.created_at AT TIME ZONE 'UTC')::date) AS due_date, \
                          GREATEST(COALESCE(b.base_total, b.total)::numeric \
                            - COALESCE((SELECT SUM(COALESCE(pm.applied_base_amount, pm.amount))::numeric FROM accounting__payment pm \
                              LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                              WHERE pm.tenant_id = b.tenant_id AND pm.bill = b.id \
                                AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                                AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $2::date) \
                                  OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.invoice IS NOT DISTINCT FROM pm.invoice AND refund.bill IS NOT DISTINCT FROM pm.bill AND (refund.created_at AT TIME ZONE 'UTC')::date <= $2::date))), 0) \
                            - COALESCE((SELECT SUM(COALESCE(dn.base_total, dn.total))::numeric FROM accounting__debit_note dn \
                              LEFT JOIN accounting__journal_entry dj ON dj.tenant_id = dn.tenant_id AND dj.source = 'debit_note' AND dj.source_id = dn.id::text AND dj.status IN ('posted', 'reversed') \
                              WHERE dn.tenant_id = b.tenant_id AND dn.bill = b.id AND dn.status = 'posted' \
                                AND COALESCE(dj.posting_date, (dn.created_at AT TIME ZONE 'UTC')::date) <= $2::date \
                                AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry dr WHERE dr.tenant_id = dn.tenant_id AND dr.source = 'reversal' AND dr.source_id = dj.id::text AND dr.status IN ('posted', 'reversed') AND COALESCE(dr.posting_date, (dr.created_at AT TIME ZONE 'UTC')::date) <= $2::date)), 0), 0) AS balance \
                   FROM accounting__bill b JOIN master_data__party p ON p.tenant_id = b.tenant_id AND p.id = b.supplier \
                   WHERE b.tenant_id = $1 AND b.status NOT IN ('draft', 'void') \
                     AND COALESCE(b.issue_date, (b.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                 ) SELECT jsonb_build_object( \
                     'kind', kind, 'documentId', document_id, 'party', party, 'dueDate', due_date, \
                     'forecastDate', GREATEST(due_date, $2::date), 'amount', balance \
                   ) FROM open_documents WHERE balance > 0 AND due_date <= $3::date \
                   ORDER BY GREATEST(due_date, $2::date), kind, party, document_id";
        let sql = sql.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE $4");
        let rows = tx
            .query_json(
                &sql,
                &[
                    &tenant.id,
                    &from,
                    &to,
                    &tenant.business_timezone().to_string(),
                ],
            )
            .await?;

        let mut inflow = Decimal::ZERO;
        let mut outflow = Decimal::ZERO;
        for row in &rows {
            let amount = row_amount(row, "amount")?;
            match row.get("kind").and_then(Value::as_str) {
                Some("receivable") => inflow = add_amount(inflow, amount)?,
                Some("payable") => outflow = add_amount(outflow, amount)?,
                _ => {}
            }
        }
        let mut commitments = Vec::new();
        if tenant.has_module("purchasing") {
            let sql = "SELECT jsonb_build_object( \
                       'kind', 'purchase_commitment', 'documentId', po.id, 'party', COALESCE(p.name, ''), \
                       'dueDate', COALESCE(po.expected_date, (po.created_at AT TIME ZONE 'UTC')::date), \
                       'forecastDate', GREATEST(COALESCE(po.expected_date, (po.created_at AT TIME ZONE 'UTC')::date), $2::date), \
                       'amount', po.total \
                     ) FROM purchasing__purchase_order po \
                     JOIN master_data__party p ON p.tenant_id = po.tenant_id AND p.id = po.supplier \
                     WHERE po.tenant_id = $1 AND po.status IN ('approved', 'partially_received') \
                       AND COALESCE(po.total, 0) > 0 \
                       AND (po.created_at AT TIME ZONE 'UTC')::date <= $2::date \
                       AND COALESCE(po.expected_date, (po.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                       AND NOT EXISTS (SELECT 1 FROM accounting__bill b WHERE b.tenant_id = po.tenant_id \
                         AND b.source = 'purchase_order' AND b.source_id = po.id::text AND b.status NOT IN ('draft', 'void')) \
                     ORDER BY GREATEST(COALESCE(po.expected_date, (po.created_at AT TIME ZONE 'UTC')::date), $2::date), p.name, po.id";
            let sql = sql.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE $4");
            commitments = tx
                .query_json(
                    &sql,
                    &[
                        &tenant.id,
                        &from,
                        &to,
                        &tenant.business_timezone().to_string(),
                    ],
                )
                .await?;
        }
        let mut payroll_outflows = Vec::new();
        if tenant.has_module("payroll") {
            payroll_outflows = tx
                .query_json(
                    "SELECT jsonb_build_object( \
                       'kind', 'payroll_payment', 'documentId', pr.id, 'party', pr.period, \
                       'dueDate', pr.payment_date, 'forecastDate', GREATEST(pr.payment_date, $2::date), \
                       'amount', pr.total_net \
                     ) FROM payroll__payroll_run pr \
                     WHERE pr.tenant_id = $1 AND pr.status = 'approved' AND pr.payment_date IS NOT NULL \
                       AND COALESCE(pr.total_net, 0) > 0 AND pr.payment_date <= $3::date \
                       AND NOT EXISTS (SELECT 1 FROM accounting__payment p WHERE p.tenant_id = pr.tenant_id \
                         AND p.source = 'payroll_run' AND p.source_id = pr.id::text) \
                     ORDER BY GREATEST(pr.payment_date, $2::date), pr.period, pr.id",
                    &[&tenant.id, &from, &to],
                )
                .await?;
        }
        let mut expense_outflows = Vec::new();
        if tenant.has_module("expense") {
            expense_outflows = tx
                .query_json(
                    "SELECT jsonb_build_object( \
                       'kind', 'expense_reimbursement', 'documentId', ec.id, 'party', COALESCE(e.name, ''), \
                       'dueDate', ec.payment_date, 'forecastDate', GREATEST(ec.payment_date, $2::date), \
                       'amount', ec.total \
                     ) FROM expense__expense_claim ec \
                     JOIN hrm__employee e ON e.tenant_id = ec.tenant_id AND e.id = ec.employee \
                     WHERE ec.tenant_id = $1 AND ec.status = 'approved' AND ec.payment_date IS NOT NULL \
                       AND COALESCE(ec.total, 0) > 0 AND ec.payment_date <= $3::date \
                       AND NOT EXISTS (SELECT 1 FROM accounting__payment p WHERE p.tenant_id = ec.tenant_id \
                         AND p.source = 'expense_claim' AND p.source_id = ec.id::text) \
                     ORDER BY GREATEST(ec.payment_date, $2::date), e.name, ec.id",
                    &[&tenant.id, &from, &to],
                )
                .await?;
        }
        let mut commitment_total = Decimal::ZERO;
        for row in &commitments {
            let amount = row_amount(row, "amount")?;
            outflow = add_amount(outflow, amount)?;
            commitment_total = add_amount(commitment_total, amount)?;
        }
        let payroll_total = payroll_outflows
            .iter()
            .try_fold(Decimal::ZERO, |total, row| {
                add_amount(total, row_amount(row, "amount")?)
            })?;
        let expense_total = expense_outflows
            .iter()
            .try_fold(Decimal::ZERO, |total, row| {
                add_amount(total, row_amount(row, "amount")?)
            })?;
        outflow = add_amount(add_amount(outflow, payroll_total)?, expense_total)?;
        let mut items = rows;
        items.extend(commitments);
        items.extend(payroll_outflows);
        items.extend(expense_outflows);
        items.sort_by(|left, right| {
            left.get("forecastDate")
                .and_then(Value::as_str)
                .cmp(&right.get("forecastDate").and_then(Value::as_str))
                .then_with(|| {
                    left.get("kind")
                        .and_then(Value::as_str)
                        .cmp(&right.get("kind").and_then(Value::as_str))
                })
                .then_with(|| {
                    left.get("documentId")
                        .and_then(Value::as_str)
                        .cmp(&right.get("documentId").and_then(Value::as_str))
                })
        });
        Ok(json!({
            "basis": "posted_open_receivables_payables_approved_purchase_orders_payroll_and_expenses",
            "asOf": from,
            "from": from,
            "to": to,
            "items": items,
            "inflow": amount_value(inflow)?,
            "outflow": amount_value(outflow)?,
            "purchaseCommitments": amount_value(commitment_total)?,
            "payrollOutflow": amount_value(payroll_total)?,
            "expenseReimbursements": amount_value(expense_total)?,
            "net": amount_value(inflow.checked_sub(outflow).ok_or_else(report_amount_error)?)?
        }))
    }
}
