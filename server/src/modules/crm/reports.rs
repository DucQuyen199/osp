//! Opportunity pipeline forecast read model.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn report_error(message: impl Into<String>) -> ApiError {
    ApiError::validation("crm.pipeline.report", vec![message.into()])
}

fn checked_add(left: Decimal, right: Decimal, field: &str) -> R<Decimal> {
    left.checked_add(right).ok_or_else(|| {
        report_error(format!(
            "CRM forecast {field} exceeds the supported decimal range"
        ))
    })
}

fn json_decimal(value: Decimal, field: &str) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        report_error(format!(
            "CRM forecast {field} exceeds the supported decimal range"
        ))
    })
}

impl Kernel {
    /// Returns open opportunities with their stage-weighted forecast values.
    pub async fn crm_pipeline_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        if !tenant.has_module("crm") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module CRM is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "crm.deal.read")?;
        let from = parse_date(from, "from")?;
        let to = parse_date(to, "to")?;
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err(ApiError::new(
                422,
                "INVALID_DATE_RANGE",
                "from must not be later than to",
            ));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let mut stage_config = BTreeMap::new();
        for row in tx
            .query(
                "SELECT stage, COALESCE(name, ''), probability::text FROM crm__pipeline_stage WHERE tenant_id = $1",
                &[&tenant.id],
            )
            .await?
        {
            let stage: String = row.get(0);
            let name: String = row.get(1);
            let probability_text: String = row.get(2);
            let probability = money::decimal_str(&probability_text)
                .filter(|value| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(value))
                .ok_or_else(|| report_error("Stored pipeline probability is invalid"))?;
            stage_config.insert(stage, (name, probability));
        }
        let mut deals = tx
            .query_json(
                "SELECT jsonb_build_object( \
                   'id', d.id, 'title', d.title, 'party', COALESCE(p.name, ''), \
                   'amount', COALESCE(d.amount, 0), 'pipelineStage', d.pipeline_stage, \
                   'legacyStage', d.stage, 'probability', d.probability, \
                   'expectedClose', d.expected_close \
                 ) FROM crm__deal d \
                 LEFT JOIN master_data__party p ON p.tenant_id = d.tenant_id AND p.id = d.party \
                 WHERE d.tenant_id = $1 AND d.status = 'open' \
                   AND ($2::date IS NULL OR d.expected_close >= $2) \
                   AND ($3::date IS NULL OR d.expected_close <= $3) \
                 ORDER BY d.expected_close NULLS LAST, d.title, d.id",
                &[&tenant.id, &from, &to],
            )
            .await?;

        let mut stage_order = vec![
            "qualification".to_owned(),
            "discovery".to_owned(),
            "proposal".to_owned(),
            "negotiation".to_owned(),
        ];
        stage_order.extend(
            stage_config
                .keys()
                .filter(|stage| super::domain::canonical_pipeline_stage(stage).is_none())
                .cloned(),
        );
        stage_order.push("unclassified".to_owned());
        let mut stage_totals: BTreeMap<String, (usize, Decimal, Decimal)> = stage_order
            .iter()
            .cloned()
            .map(|stage| (stage, (0, Decimal::ZERO, Decimal::ZERO)))
            .collect();
        let mut amount_total = Decimal::ZERO;
        let mut weighted_total = Decimal::ZERO;
        for deal in &mut deals {
            let raw_stage = deal
                .get("pipelineStage")
                .and_then(Value::as_str)
                .or_else(|| deal.get("legacyStage").and_then(Value::as_str));
            let stage = raw_stage.and_then(|value| {
                super::domain::canonical_pipeline_stage(value)
                    .or_else(|| stage_config.contains_key(value).then_some(value))
            });
            let stage_key = stage.unwrap_or("unclassified").to_owned();
            let amount = deal
                .get("amount")
                .and_then(money::decimal)
                .filter(|amount| *amount >= Decimal::ZERO)
                .unwrap_or(Decimal::ZERO);
            let probability = deal
                .get("probability")
                .and_then(money::decimal)
                .filter(|probability| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(probability))
                .or_else(|| {
                    stage_config
                        .get(&stage_key)
                        .map(|(_, probability)| *probability)
                })
                .or_else(|| {
                    super::domain::canonical_pipeline_stage(&stage_key)
                        .map(super::domain::default_probability)
                })
                .unwrap_or(Decimal::ZERO);
            let weighted = amount
                .checked_mul(probability)
                .and_then(|value| value.checked_div(Decimal::ONE_HUNDRED))
                .map(|value| {
                    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                })
                .ok_or_else(|| {
                    report_error("Weighted opportunity value exceeds the supported decimal range")
                })?;
            let stage_name = stage_config
                .get(&stage_key)
                .map(|(name, _)| name.as_str())
                .filter(|name| !name.trim().is_empty())
                .map(str::to_owned);
            if let Some(object) = deal.as_object_mut() {
                object.insert("pipelineStage".into(), json!(stage_key));
                object.insert(
                    "pipelineStageName".into(),
                    json!(stage_name.unwrap_or_else(|| stage_key.to_owned())),
                );
                object.insert(
                    "probability".into(),
                    json_decimal(probability, "probability")?,
                );
                object.insert(
                    "weightedAmount".into(),
                    json_decimal(weighted, "weighted amount")?,
                );
            }
            let (count, stage_amount, stage_weighted) = stage_totals.entry(stage_key).or_default();
            *count += 1;
            *stage_amount = checked_add(*stage_amount, amount, "stage amount")?;
            *stage_weighted = checked_add(*stage_weighted, weighted, "stage forecast")?;
            amount_total = checked_add(amount_total, amount, "pipeline amount")?;
            weighted_total = checked_add(weighted_total, weighted, "weighted forecast")?;
        }
        let mut stages = Vec::with_capacity(stage_order.len());
        for stage in stage_order {
            let (count, amount, weighted) = stage_totals.get(&stage).copied().unwrap_or_default();
            stages.push(json!({
                "stage": stage,
                "name": stage_config.get(&stage).map(|(name, _)| name.as_str()).filter(|name| !name.trim().is_empty()),
                "count": count,
                "amount": json_decimal(amount, "stage amount")?,
                "weightedAmount": json_decimal(weighted, "stage forecast")?,
            }));
        }
        Ok(json!({
            "from": from.map(|date| date.to_string()),
            "to": to.map(|date| date.to_string()),
            "dealCount": deals.len(),
            "pipelineAmount": json_decimal(amount_total, "pipeline amount")?,
            "weightedForecast": json_decimal(weighted_total, "weighted forecast")?,
            "stages": stages,
            "deals": deals,
        }))
    }
}

fn parse_date(value: Option<&str>, field: &str) -> R<Option<chrono::NaiveDate>> {
    value
        .map(|value| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                ApiError::new(422, "INVALID_DATE", format!("{field} must use YYYY-MM-DD"))
            })
        })
        .transpose()
}
