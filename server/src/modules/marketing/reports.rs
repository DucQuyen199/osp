//! First-touch campaign attribution and outcome read model.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};

impl Kernel {
    /// Reports campaign outcomes using first-touch, last-touch, or linear attribution.
    pub async fn marketing_campaign_performance(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        model: &str,
    ) -> R<Value> {
        if !tenant.has_module("marketing") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module marketing is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "marketing.campaign.read")?;
        if !matches!(model, "first_touch" | "last_touch" | "linear") {
            return Err(ApiError::validation(
                "marketing.campaign",
                vec!["Attribution model must be first_touch, last_touch, or linear".into()],
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let mut campaigns = tx
            .query_json(
                "WITH touches AS ( \
                   SELECT campaign, lead, row_number() OVER (PARTITION BY lead ORDER BY \
                     CASE WHEN $2 = 'last_touch' THEN created_at END DESC, \
                     CASE WHEN $2 <> 'last_touch' THEN created_at END ASC, \
                     CASE WHEN $2 = 'last_touch' THEN id END DESC, \
                     CASE WHEN $2 <> 'last_touch' THEN id END ASC) AS touch_rank, \
                     count(*) OVER (PARTITION BY lead) AS touch_count \
                   FROM marketing__campaign_member WHERE tenant_id = $1 \
                 ), attributed AS ( \
                   SELECT campaign, lead, CASE WHEN $2 = 'linear' \
                     THEN 1.0 / touch_count ELSE 1.0 END AS weight \
                   FROM touches WHERE $2 = 'linear' OR touch_rank = 1 \
                 ), lead_outcomes AS ( \
                   SELECT l.tenant_id, l.id, l.status, count(d.id) AS won_deals, \
                     COALESCE(sum(d.amount), 0) AS won_revenue \
                   FROM crm__lead l LEFT JOIN crm__deal d ON d.tenant_id = l.tenant_id \
                     AND d.lead = l.id AND d.status = 'won' \
                   WHERE l.tenant_id = $1 GROUP BY l.tenant_id, l.id, l.status \
                 ) SELECT jsonb_build_object( \
                   'id', c.id, 'name', c.name, 'channel', c.channel, 'status', c.status, \
                   'budget', COALESCE(c.budget, 0), \
                   'leads', round(COALESCE(sum(ft.weight), 0), 6), \
                   'conversions', round(COALESCE(sum(ft.weight) FILTER (WHERE l.status = 'converted'), 0), 6), \
                   'wonDeals', round(COALESCE(sum(l.won_deals * ft.weight), 0), 6), \
                   'attributedRevenue', COALESCE(sum(l.won_revenue * ft.weight), 0), \
                   'actualCost', COALESCE(cost.amount, 0) \
                 ) FROM marketing__campaign c \
                 LEFT JOIN attributed ft ON ft.campaign = c.id \
                 LEFT JOIN lead_outcomes l ON l.tenant_id = c.tenant_id AND l.id = ft.lead \
                 LEFT JOIN ( \
                   SELECT cc.campaign, sum(COALESCE(cc.allocated_amount::numeric, COALESCE(b.base_total, b.total)::numeric) * \
                     GREATEST(COALESCE(b.base_total, b.total)::numeric - \
                       COALESCE((SELECT sum(COALESCE(dn.base_total, dn.total))::numeric FROM accounting__debit_note dn \
                         WHERE dn.tenant_id = b.tenant_id AND dn.bill = b.id AND dn.status = 'posted'), 0), 0) / \
                     NULLIF(COALESCE(b.base_total, b.total)::numeric, 0)) AS amount \
                   FROM marketing__campaign_cost cc JOIN accounting__bill b \
                     ON b.tenant_id = cc.tenant_id AND b.id = cc.bill \
                   WHERE cc.tenant_id = $1 AND b.status NOT IN ('draft', 'void') \
                   GROUP BY cc.campaign \
                 ) cost ON cost.campaign = c.id \
                 WHERE c.tenant_id = $1 \
                 GROUP BY c.id, c.name, c.channel, c.status, c.budget, cost.amount \
                 ORDER BY c.name, c.id",
                &[&tenant.id, &model],
            )
            .await?;
        let mut campaign_count = 0usize;
        let mut total_leads = Decimal::ZERO;
        let mut total_conversions = Decimal::ZERO;
        let mut total_won_deals = Decimal::ZERO;
        let mut total_budget = Decimal::ZERO;
        let mut total_actual_cost = Decimal::ZERO;
        let mut attributed_revenue = Decimal::ZERO;
        for campaign in &mut campaigns {
            campaign_count += 1;
            let leads = number(campaign, "leads");
            let conversions = number(campaign, "conversions");
            let won_deals = number(campaign, "wonDeals");
            let budget = number(campaign, "budget");
            let revenue = number(campaign, "attributedRevenue");
            let actual_cost = number(campaign, "actualCost");
            let conversion_rate = if leads > Decimal::ZERO {
                ratio(conversions.checked_mul(Decimal::ONE_HUNDRED), leads)?
            } else {
                Decimal::ZERO
            };
            if let Some(object) = campaign.as_object_mut() {
                object.insert("conversionRate".into(), decimal_json(conversion_rate)?);
                object.insert(
                    "budgetPerLead".into(),
                    decimal_json(if leads > Decimal::ZERO {
                        ratio(Some(budget), leads)?
                    } else {
                        Decimal::ZERO
                    })?,
                );
                object.insert(
                    "actualCostPerLead".into(),
                    decimal_json(if leads > Decimal::ZERO {
                        ratio(Some(actual_cost), leads)?
                    } else {
                        Decimal::ZERO
                    })?,
                );
                object.insert(
                    "revenueToSpend".into(),
                    if actual_cost > Decimal::ZERO {
                        decimal_json(ratio(Some(revenue), actual_cost)?)?
                    } else {
                        Value::Null
                    },
                );
            }
            total_leads = add(total_leads, leads)?;
            total_conversions = add(total_conversions, conversions)?;
            total_won_deals = add(total_won_deals, won_deals)?;
            total_budget = add(total_budget, budget)?;
            total_actual_cost = add(total_actual_cost, actual_cost)?;
            attributed_revenue = add(attributed_revenue, revenue)?;
        }
        let total_conversion_rate = if total_leads > Decimal::ZERO {
            ratio(
                total_conversions.checked_mul(Decimal::ONE_HUNDRED),
                total_leads,
            )?
        } else {
            Decimal::ZERO
        };
        let revenue_to_spend = if total_actual_cost > Decimal::ZERO {
            Some(decimal_json(ratio(
                Some(attributed_revenue),
                total_actual_cost,
            )?)?)
        } else {
            None
        };
        Ok(json!({
            "attributionModel": model,
            "campaignCount": campaign_count,
            "leadCount": decimal_json(total_leads)?,
            "conversionCount": decimal_json(total_conversions)?,
            "wonDealCount": decimal_json(total_won_deals)?,
            "conversionRate": decimal_json(total_conversion_rate)?,
            "budgetTotal": decimal_json(total_budget)?,
            "actualCostTotal": decimal_json(total_actual_cost)?,
            "attributedRevenue": decimal_json(attributed_revenue)?,
            "revenueToSpend": revenue_to_spend,
            "campaigns": campaigns,
        }))
    }
}

fn number(value: &Value, field: &str) -> Decimal {
    value
        .get(field)
        .and_then(money::decimal)
        .unwrap_or_default()
}

fn add(left: Decimal, right: Decimal) -> R<Decimal> {
    left.checked_add(right)
        .ok_or_else(|| ApiError::internal("campaign attribution total exceeds Decimal range"))
}

fn ratio(numerator: Option<Decimal>, denominator: Decimal) -> R<Decimal> {
    numerator
        .and_then(|value| value.checked_div(denominator))
        .ok_or_else(|| ApiError::internal("campaign attribution ratio exceeds Decimal range"))
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value)
        .ok_or_else(|| ApiError::internal("campaign attribution result exceeds Decimal range"))
}
