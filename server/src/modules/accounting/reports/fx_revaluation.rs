use super::common::parse_date;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value, json};

fn report_amount_error() -> ApiError {
    ApiError::validation(
        "accounting.fx_revaluation",
        vec!["Calculated foreign-currency amount exceeds the supported decimal range".into()],
    )
}

fn amount_value(value: Decimal) -> R<Value> {
    crate::money::json_number(value).ok_or_else(report_amount_error)
}

async fn fx_positions(
    tx: &Tx<'_>,
    tenant: &Tenant,
    base_code: &str,
    as_of: chrono::NaiveDate,
) -> R<Vec<Value>> {
    let sql = "WITH base_currency AS ( \
              SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 \
            ), open_docs AS ( \
              SELECT 'receivable'::text AS side, d.id AS document_id, d.id::text AS document_number, \
                     p.name AS party, COALESCE(d.currency, bc.id) AS currency_id, \
                     GREATEST(d.total::numeric - COALESCE(( \
                       SELECT SUM(pm.amount)::numeric FROM accounting__payment pm \
                       LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                       WHERE pm.tenant_id = d.tenant_id AND pm.invoice = d.id \
                         AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                           OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.invoice = pm.invoice AND (refund.created_at AT TIME ZONE 'UTC')::date <= $3::date)) \
                     ), 0) - COALESCE(( \
                       SELECT SUM(n.total)::numeric FROM accounting__credit_note n \
                       LEFT JOIN accounting__journal_entry nj ON nj.tenant_id = n.tenant_id AND nj.source = 'credit_note' AND nj.source_id = n.id::text AND nj.status IN ('posted', 'reversed') \
                       WHERE n.tenant_id = d.tenant_id AND n.invoice = d.id AND n.status = 'posted' \
                         AND COALESCE(nj.posting_date, (n.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry nr WHERE nr.tenant_id = n.tenant_id AND nr.source = 'reversal' AND nr.source_id = nj.id::text AND nr.status IN ('posted', 'reversed') AND COALESCE(nr.posting_date, (nr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                     ), 0), 0) AS foreign_balance, \
                     GREATEST(COALESCE(d.base_total, d.total)::numeric - COALESCE(( \
                       SELECT SUM(COALESCE(pm.applied_base_amount, pm.amount))::numeric FROM accounting__payment pm \
                       LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                       WHERE pm.tenant_id = d.tenant_id AND pm.invoice = d.id \
                         AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                           OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.invoice = pm.invoice AND (refund.created_at AT TIME ZONE 'UTC')::date <= $3::date)) \
                     ), 0) - COALESCE(( \
                       SELECT SUM(COALESCE(n.base_total, n.total))::numeric FROM accounting__credit_note n \
                       LEFT JOIN accounting__journal_entry nj ON nj.tenant_id = n.tenant_id AND nj.source = 'credit_note' AND nj.source_id = n.id::text AND nj.status IN ('posted', 'reversed') \
                       WHERE n.tenant_id = d.tenant_id AND n.invoice = d.id AND n.status = 'posted' \
                         AND COALESCE(nj.posting_date, (n.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry nr WHERE nr.tenant_id = n.tenant_id AND nr.source = 'reversal' AND nr.source_id = nj.id::text AND nr.status IN ('posted', 'reversed') AND COALESCE(nr.posting_date, (nr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                     ), 0), 0) AS carrying_base \
              FROM accounting__invoice d JOIN master_data__party p ON p.tenant_id = d.tenant_id AND p.id = d.party \
              CROSS JOIN base_currency bc \
              WHERE d.tenant_id = $1 AND d.status NOT IN ('draft', 'void') AND COALESCE(d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
              UNION ALL \
              SELECT 'payable'::text, d.id, d.id::text, p.name, COALESCE(d.currency, bc.id), \
                     GREATEST(d.total::numeric - COALESCE(( \
                       SELECT SUM(pm.amount)::numeric FROM accounting__payment pm \
                       LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                       WHERE pm.tenant_id = d.tenant_id AND pm.bill = d.id \
                         AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                           OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.bill = pm.bill AND (refund.created_at AT TIME ZONE 'UTC')::date <= $3::date)) \
                     ), 0) - COALESCE(( \
                       SELECT SUM(n.total)::numeric FROM accounting__debit_note n \
                       LEFT JOIN accounting__journal_entry nj ON nj.tenant_id = n.tenant_id AND nj.source = 'debit_note' AND nj.source_id = n.id::text AND nj.status IN ('posted', 'reversed') \
                       WHERE n.tenant_id = d.tenant_id AND n.bill = d.id AND n.status = 'posted' \
                         AND COALESCE(nj.posting_date, (n.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry nr WHERE nr.tenant_id = n.tenant_id AND nr.source = 'reversal' AND nr.source_id = nj.id::text AND nr.status IN ('posted', 'reversed') AND COALESCE(nr.posting_date, (nr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                     ), 0), 0) AS foreign_balance, \
                     GREATEST(COALESCE(d.base_total, d.total)::numeric - COALESCE(( \
                       SELECT SUM(COALESCE(pm.applied_base_amount, pm.amount))::numeric FROM accounting__payment pm \
                       LEFT JOIN accounting__journal_entry pj ON pj.tenant_id = pm.tenant_id AND pj.source = 'payment' AND pj.source_id = pm.id::text AND pj.status IN ('posted', 'reversed') \
                       WHERE pm.tenant_id = d.tenant_id AND pm.bill = d.id \
                         AND COALESCE(pj.posting_date, (pm.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND (NOT EXISTS (SELECT 1 FROM accounting__journal_entry pr WHERE pr.tenant_id = pm.tenant_id AND pr.source = 'reversal' AND pr.source_id = pj.id::text AND pr.status IN ('posted', 'reversed') AND COALESCE(pr.posting_date, (pr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                           OR EXISTS (SELECT 1 FROM accounting__payment refund WHERE refund.tenant_id = pm.tenant_id AND refund.source = 'payment_refund' AND refund.source_id = pm.source_id AND refund.bill = pm.bill AND (refund.created_at AT TIME ZONE 'UTC')::date <= $3::date)) \
                     ), 0) - COALESCE(( \
                       SELECT SUM(COALESCE(n.base_total, n.total))::numeric FROM accounting__debit_note n \
                       LEFT JOIN accounting__journal_entry nj ON nj.tenant_id = n.tenant_id AND nj.source = 'debit_note' AND nj.source_id = n.id::text AND nj.status IN ('posted', 'reversed') \
                       WHERE n.tenant_id = d.tenant_id AND n.bill = d.id AND n.status = 'posted' \
                         AND COALESCE(nj.posting_date, (n.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry nr WHERE nr.tenant_id = n.tenant_id AND nr.source = 'reversal' AND nr.source_id = nj.id::text AND nr.status IN ('posted', 'reversed') AND COALESCE(nr.posting_date, (nr.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                     ), 0), 0) AS carrying_base \
              FROM accounting__bill d JOIN master_data__party p ON p.tenant_id = d.tenant_id AND p.id = d.supplier \
              CROSS JOIN base_currency bc \
              WHERE d.tenant_id = $1 AND d.status NOT IN ('draft', 'void') AND COALESCE(d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
            ), currency_positions AS ( \
              SELECT side, currency_id, SUM(foreign_balance) AS foreign_balance, \
                     SUM(carrying_base) + COALESCE(( \
                       SELECT SUM(CASE WHEN cp.side = 'receivable' THEN COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0) ELSE COALESCE((line->>'credit')::numeric, 0) - COALESCE((line->>'debit')::numeric, 0) END) \
                       FROM accounting__journal_entry fx \
                       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fx.lines, '[]'::jsonb)) line \
                       WHERE fx.tenant_id = $1 AND fx.source = 'fx_revaluation' AND fx.status IN ('posted', 'reversed') \
                         AND COALESCE(fx.posting_date, (fx.created_at AT TIME ZONE 'UTC')::date) <= $3::date \
                         AND line->>'fx_currency_id' = cp.currency_id::text AND line->>'fx_side' = cp.side \
                         AND NOT EXISTS (SELECT 1 FROM accounting__journal_entry reversal WHERE reversal.tenant_id = fx.tenant_id AND reversal.source = 'reversal' AND reversal.source_id = fx.id::text AND reversal.status IN ('posted', 'reversed') AND COALESCE(reversal.posting_date, (reversal.created_at AT TIME ZONE 'UTC')::date) <= $3::date) \
                     ), 0) AS carrying_base, \
                     jsonb_agg(jsonb_build_object('documentId', document_id, 'document', document_number, 'party', party, 'foreignBalance', foreign_balance, 'carryingBase', carrying_base) ORDER BY party, document_id) AS documents \
              FROM open_docs WHERE foreign_balance > 0.005 GROUP BY side, currency_id \
            ) \
            SELECT jsonb_build_object( \
              'side', cp.side, 'currencyId', c.id, 'currency', c.code, 'currencyName', c.name, \
              'foreignBalance', cp.foreign_balance, 'carryingBase', cp.carrying_base, \
              'closingRate', COALESCE(rate.rate::numeric, CASE WHEN upper(c.code) = $2 THEN 1::numeric END), \
              'rateDate', rate.effective_date, \
              'targetBase', CASE WHEN rate.rate IS NOT NULL OR upper(c.code) = $2 THEN round(cp.foreign_balance * COALESCE(rate.rate::numeric, 1), 2) END, \
              'adjustment', CASE WHEN rate.rate IS NOT NULL OR upper(c.code) = $2 THEN round((cp.foreign_balance * COALESCE(rate.rate::numeric, 1) - cp.carrying_base) * CASE WHEN cp.side = 'receivable' THEN 1 ELSE -1 END, 2) END, \
              'documents', cp.documents \
            ) \
            FROM currency_positions cp JOIN master_data__currency c ON c.tenant_id = $1 AND c.id = cp.currency_id \
            LEFT JOIN LATERAL (SELECT r.rate, r.effective_date FROM master_data__currency_rate r WHERE r.tenant_id = $1 AND r.from_currency = c.id AND r.to_currency = (SELECT id FROM base_currency) AND r.effective_date <= $3 ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) rate ON true \
            ORDER BY c.code, cp.side";
    let sql = sql.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE $4");
    tx.query_json(
        &sql,
        &[
            &tenant.id,
            &base_code,
            &as_of,
            &tenant.business_timezone().to_string(),
        ],
    )
    .await
}
impl Kernel {
    /// Preview open foreign-currency receivables and payables at a closing rate.
    /// The result is informational; posting remains a separate audited workflow.
    pub async fn accounting_fx_revaluation_preview(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        as_of: Option<&str>,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        let as_of = parse_date(as_of, "asOf")?.unwrap_or_else(|| tenant.business_today());
        let base_code = tenant
            .setting_str("baseCurrency")
            .unwrap_or("VND")
            .to_ascii_uppercase();

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let positions = fx_positions(&tx, tenant, &base_code, as_of).await?;
        let missing_rates = positions
            .iter()
            .filter(|position| position.get("closingRate").is_none_or(Value::is_null))
            .count();
        let has_adjustment = positions.iter().any(|position| {
            position
                .get("adjustment")
                .and_then(crate::money::decimal)
                .is_some_and(|amount| amount.abs() > Decimal::new(5, 3))
        });
        Ok(json!({
            "asOf": as_of,
            "baseCurrency": base_code,
            "positions": positions,
            "missingRates": missing_rates,
            "draftCreationEnabled": missing_rates == 0 && has_adjustment,
            "postingEnabled": false
        }))
    }

    /// Creates one idempotent draft journal for the open foreign-currency
    /// receivable/payable positions on an accounting date.
    pub async fn create_accounting_fx_revaluation_draft(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        as_of: &str,
        memo: &str,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        self.authorize(tenant, actor, "accounting.journal_entry.create")?;
        let as_of = parse_date(Some(as_of), "asOf")?
            .ok_or_else(|| ApiError::new(422, "INVALID_DATE", "asOf must use YYYY-MM-DD"))?;
        let memo = memo.trim();
        if memo.is_empty() || memo.chars().count() > 300 {
            return Err(ApiError::validation(
                "accounting.fx_revaluation",
                vec!["Memo must contain 1 to 300 characters".into()],
            ));
        }
        if !tenant.has_module("master-data") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Master data module is required for currency revaluation",
            ));
        }
        let base_code = tenant
            .setting_str("baseCurrency")
            .unwrap_or("VND")
            .to_ascii_uppercase();
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        if tx
            .query_opt(
                "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
                &[&tenant.id, &base_code],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::validation(
                "accounting.fx_revaluation",
                vec![format!("Base currency {base_code} is missing from this tenant")],
            ));
        }
        if tx
            .query_opt(
                "SELECT 1 FROM accounting__period WHERE tenant_id = $1 AND status = 'period_closed' AND start_date <= $2 AND end_date >= $2 LIMIT 1",
                &[&tenant.id, &as_of],
            )
            .await?
            .is_some()
        {
            return Err(ApiError::validation(
                "accounting.fx_revaluation",
                vec!["Cannot create a revaluation journal in a closed accounting period".into()],
            ));
        }
        let source_id = as_of.to_string();
        if let Some(existing) = tx
            .query_opt(
                "SELECT id, status FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'fx_revaluation' AND source_id = $2 ORDER BY created_at, id LIMIT 1 FOR UPDATE",
                &[&tenant.id, &source_id],
            )
            .await?
        {
            let id: uuid::Uuid = existing.get(0);
            let status: String = existing.get(1);
            tx.commit().await?;
            return Ok(json!({"journalId": id, "status": status, "asOf": as_of, "existing": true}));
        }

        let positions = fx_positions(&tx, tenant, &base_code, as_of).await?;
        if positions
            .iter()
            .any(|position| position.get("closingRate").is_none_or(Value::is_null))
        {
            return Err(ApiError::validation(
                "accounting.fx_revaluation",
                vec![
                    "Every open foreign-currency position needs a closing rate before revaluation"
                        .into(),
                ],
            ));
        }
        let mut lines = Vec::new();
        let mut total = Decimal::ZERO;
        for position in &positions {
            let side = position
                .get("side")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let adjustment = position
                .get("adjustment")
                .and_then(crate::money::decimal)
                .unwrap_or(Decimal::ZERO);
            let amount = adjustment
                .abs()
                .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
            if amount <= Decimal::new(5, 3) {
                continue;
            }
            let amount_json = amount_value(amount)?;
            let (control_code, control_name, control_kind) = match side {
                "receivable" => ("131", "Phải thu khách hàng", "asset"),
                "payable" => ("331", "Phải trả nhà cung cấp", "liability"),
                _ => {
                    return Err(ApiError::validation(
                        "accounting.fx_revaluation",
                        vec!["Unsupported foreign-currency position type".into()],
                    ));
                }
            };
            let control = crate::modules::accounting::application::ensure_account(
                self,
                &tx,
                tenant,
                control_code,
                control_name,
                control_kind,
            )
            .await?;
            let fx_metadata = json!({
                "fx_currency_id": position.get("currencyId").cloned().unwrap_or(Value::Null),
                "fx_base_currency": base_code,
                "fx_side": side,
                "fx_closing_rate": position.get("closingRate").cloned().unwrap_or(Value::Null),
                "fx_rate_date": position.get("rateDate").cloned().unwrap_or(Value::Null),
                "fx_foreign_balance": position.get("foreignBalance").cloned().unwrap_or(Value::Null),
                "fx_carrying_base": position.get("carryingBase").cloned().unwrap_or(Value::Null),
                "fx_target_base": position.get("targetBase").cloned().unwrap_or(Value::Null),
                "fx_adjustment": amount_value(adjustment)?,
            });
            let gain = crate::modules::accounting::application::ensure_account(
                self,
                &tx,
                tenant,
                "515",
                "Lãi chênh lệch tỷ giá",
                "revenue",
            )
            .await?;
            let loss = crate::modules::accounting::application::ensure_account(
                self,
                &tx,
                tenant,
                "635",
                "Lỗ chênh lệch tỷ giá",
                "expense",
            )
            .await?;
            if adjustment > Decimal::ZERO {
                let mut control_line =
                    json!({"account": control, "debit": amount_json.clone(), "credit": 0});
                control_line
                    .as_object_mut()
                    .unwrap()
                    .extend(fx_metadata.as_object().unwrap().clone());
                lines.push(control_line);
                lines.push(json!({"account": gain, "debit": 0, "credit": amount_json.clone()}));
            } else {
                lines.push(json!({"account": loss, "debit": amount_json.clone(), "credit": 0}));
                let mut control_line =
                    json!({"account": control, "debit": 0, "credit": amount_json});
                control_line
                    .as_object_mut()
                    .unwrap()
                    .extend(fx_metadata.as_object().unwrap().clone());
                lines.push(control_line);
            }
            total = total.checked_add(amount).ok_or_else(report_amount_error)?;
        }
        if total <= Decimal::new(5, 3) {
            return Err(ApiError::validation(
                "accounting.fx_revaluation",
                vec!["Open positions have no material closing-rate adjustment".into()],
            ));
        }
        let entity = self.ent(tenant, "accounting.journal_entry")?;
        let journal = self
            .create_in(
                &tx,
                actor,
                tenant,
                &entity,
                Map::from_iter([
                    ("memo".into(), json!(memo)),
                    ("amount".into(), amount_value(total)?),
                    ("posting_date".into(), json!(as_of)),
                    ("source".into(), json!("fx_revaluation")),
                    ("source_id".into(), json!(source_id)),
                    ("lines".into(), Value::Array(lines)),
                ]),
                &Opts::top(),
            )
            .await?;
        tx.commit().await?;
        Ok(json!({
            "journal": journal,
            "asOf": as_of,
            "positions": positions,
            "existing": false
        }))
    }
}
