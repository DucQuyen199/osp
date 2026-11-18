use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

fn amount_error() -> ApiError {
    ApiError::validation(
        "consolidation.trial_balance",
        vec!["A converted report amount exceeds the supported decimal range".into()],
    )
}

fn parse_date(value: Option<&str>, field: &str) -> R<Option<NaiveDate>> {
    value
        .map(|value| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                ApiError::new(
                    422,
                    "INVALID_DATE",
                    format!("{field} must use YYYY-MM-DD format"),
                )
            })
        })
        .transpose()
}

async fn currency_rate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    from_code: &str,
    to_code: &str,
    as_of: &str,
) -> R<(Decimal, String)> {
    if from_code.eq_ignore_ascii_case(to_code) {
        return Ok((Decimal::ONE, as_of.to_owned()));
    }
    let as_of_date = NaiveDate::parse_from_str(as_of, "%Y-%m-%d")
        .map_err(|_| ApiError::new(422, "INVALID_DATE", "Rate date must use YYYY-MM-DD"))?;
    let direct = tx
        .query_opt(
            "SELECT rate::text, effective_date::text FROM master_data__currency_rate WHERE tenant_id=$1 AND from_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($2)) AND to_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($3)) AND effective_date <= $4::date ORDER BY effective_date DESC, created_at DESC LIMIT 1",
            &[&tenant.id, &from_code, &to_code, &as_of_date],
        )
        .await?;
    if let Some(row) = direct {
        let rate = row
            .get::<_, String>(0)
            .parse::<Decimal>()
            .map_err(|_| amount_error())?;
        if rate <= Decimal::ZERO {
            return Err(ApiError::new(
                409,
                "INVALID_CURRENCY_RATE",
                "Currency exchange rate must be positive",
            ));
        }
        let effective_date: String = row.get(1);
        return Ok((rate, effective_date));
    }
    let reverse = tx
        .query_opt(
            "SELECT rate::text, effective_date::text FROM master_data__currency_rate WHERE tenant_id=$1 AND from_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($3)) AND to_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($2)) AND effective_date <= $4::date ORDER BY effective_date DESC, created_at DESC LIMIT 1",
            &[&tenant.id, &from_code, &to_code, &as_of_date],
        )
        .await?
        .ok_or_else(|| ApiError::new(409, "CURRENCY_RATE_MISSING", format!("No {from_code}/{to_code} currency rate is available on or before {as_of}")))?;
    let effective_date: String = reverse.get(1);
    let reverse_rate = reverse
        .get::<_, String>(0)
        .parse::<Decimal>()
        .map_err(|_| amount_error())?;
    if reverse_rate <= Decimal::ZERO {
        return Err(ApiError::new(
            409,
            "INVALID_CURRENCY_RATE",
            "Currency exchange rate must be positive",
        ));
    }
    let rate = Decimal::ONE
        .checked_div(reverse_rate)
        .ok_or_else(amount_error)?;
    Ok((rate, effective_date))
}

fn rate_age_days(effective_date: &str, as_of: &str) -> R<i64> {
    let effective_date = NaiveDate::parse_from_str(effective_date, "%Y-%m-%d").map_err(|_| {
        ApiError::new(
            409,
            "INVALID_CURRENCY_RATE_DATE",
            "Currency rate has an invalid effective date",
        )
    })?;
    let as_of = NaiveDate::parse_from_str(as_of, "%Y-%m-%d")
        .map_err(|_| ApiError::new(422, "INVALID_DATE", "Rate date must use YYYY-MM-DD"))?;
    let age_days = as_of.signed_duration_since(effective_date).num_days();
    if age_days < 0 {
        return Err(ApiError::new(
            409,
            "INVALID_CURRENCY_RATE_DATE",
            "Currency rate is effective after the report end date",
        ));
    }
    Ok(age_days)
}

fn parse_rate_age_policy(value: Option<&str>) -> R<Option<Decimal>> {
    value
        .map(|value| {
            let days = value.parse::<Decimal>().map_err(|_| {
                ApiError::new(
                    409,
                    "INVALID_CURRENCY_RATE_POLICY",
                    "Maximum currency rate age must be a positive whole number of days",
                )
            })?;
            if days <= Decimal::ZERO || days.fract() != Decimal::ZERO {
                return Err(ApiError::new(
                    409,
                    "INVALID_CURRENCY_RATE_POLICY",
                    "Maximum currency rate age must be a positive whole number of days",
                ));
            }
            Ok(days)
        })
        .transpose()
}

fn converted(value: &Value, field: &str, rate: Decimal) -> R<Decimal> {
    let amount = value
        .get(field)
        .and_then(crate::money::decimal)
        .ok_or_else(amount_error)?;
    amount
        .checked_mul(rate)
        .map(crate::money::round_money)
        .ok_or_else(amount_error)
}

fn json_amount(value: Decimal) -> R<Value> {
    crate::money::json_number(value).ok_or_else(amount_error)
}

impl Kernel {
    /// Management consolidation of member trial balances. Each tenant is read
    /// in its own RLS-scoped transaction after reciprocal consent is verified.
    pub async fn consolidated_trial_balance(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        self.ent(owner, "consolidation.company_group")?;
        self.ent(owner, "consolidation.member")?;
        self.authorize(owner, actor, "consolidation.company_group.read")?;
        self.authorize(owner, actor, "accounting.journal_entry.read")?;
        let group_id = super::domain::parse_id(group_id, "Company group")?;
        let from = parse_date(from, "from")?;
        let to = parse_date(to, "to")?;
        if from.zip(to).is_some_and(|(start, end)| start > end) {
            return Err(ApiError::new(
                422,
                "INVALID_DATE_RANGE",
                "from must be on or before to",
            ));
        }
        let from_text = from.map(|date| date.to_string());
        let to_text = Some(
            to.map(|date| date.to_string())
                .unwrap_or_else(|| owner.business_today().to_string()),
        );

        let mut owner_conn = self.pool.get().await?;
        let owner_tx = Tx::begin(&mut owner_conn, &owner.id, false).await?;
        let grant_exists = owner_tx
            .query_opt(
                "SELECT id FROM consolidation__report_grant WHERE tenant_id=$1 AND \"group\"=$2 AND user_id=$3 AND report_type='trial_balance' AND status='active' LIMIT 1",
                &[&owner.id, &group_id, &actor.user_id()],
            )
            .await?
            .is_some();
        if !grant_exists {
            return Err(ApiError::forbidden(
                "consolidation.report_grant.trial_balance",
            ));
        }
        let group_row = owner_tx.query_opt(
            "SELECT currency.code, group_row.max_rate_age_days::text FROM consolidation__company_group group_row JOIN master_data__currency currency ON currency.tenant_id=group_row.tenant_id AND currency.id=group_row.reporting_currency WHERE group_row.tenant_id=$1 AND group_row.id=$2",
            &[&owner.id, &group_id],
        ).await?.ok_or_else(|| ApiError::not_found("Company group"))?;
        let reporting_currency: String = group_row.get(0);
        let max_rate_age_days =
            parse_rate_age_policy(group_row.get::<_, Option<String>>(1).as_deref())?;
        let members = owner_tx.query(
            "SELECT id, member_tenant_id, member_name FROM consolidation__member WHERE tenant_id=$1 AND \"group\"=$2 AND status='active' ORDER BY member_name, member_tenant_id",
            &[&owner.id, &group_id],
        ).await?;
        owner_tx.commit().await?;

        let mut companies = Vec::with_capacity(members.len());
        let mut totals: BTreeMap<(String, String), (String, [Decimal; 6])> = BTreeMap::new();
        let fields = [
            "openingDebit",
            "openingCredit",
            "periodDebit",
            "periodCredit",
            "closingDebit",
            "closingCredit",
        ];
        for member in members {
            let member_id: Uuid = member.get(0);
            let member_tenant_id: String = member.get(1);
            let member_name: String = member.get(2);
            let tenant = self.tenant(&member_tenant_id).await?;
            if tenant.suspended
                || !tenant.has_module("accounting")
                || !tenant.has_module("consolidation")
                || !tenant.has_module("master-data")
            {
                return Err(ApiError::new(
                    409,
                    "MEMBER_TENANT_UNAVAILABLE",
                    format!(
                        "Member tenant {} cannot provide a complete accounting report",
                        tenant.name
                    ),
                ));
            }
            let mut member_conn = self.pool.get().await?;
            let member_tx = Tx::begin(&mut member_conn, &tenant.id, false).await?;
            if member_tx.query_opt(
                "SELECT id FROM consolidation__shared_company WHERE tenant_id=$1 AND owner_tenant_id=$2 AND owner_member_id=$3 AND status='active'",
                &[&tenant.id, &owner.id, &member_id.to_string()],
            ).await?.is_none() {
                return Err(ApiError::new(409, "MEMBER_CONSENT_MISSING", format!("Tenant {} no longer has active consent", tenant.name)));
            }
            let local_currency = tenant
                .setting_str("baseCurrency")
                .filter(|code| !code.trim().is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        409,
                        "BASE_CURRENCY_MISSING",
                        format!("Tenant {} has no base currency configured", tenant.name),
                    )
                })?;
            let as_of = to_text
                .as_deref()
                .map(str::to_owned)
                .unwrap_or_else(|| tenant.business_today().to_string());
            let (rate, rate_effective_date) = currency_rate(
                &member_tx,
                &tenant,
                local_currency,
                &reporting_currency,
                &as_of,
            )
            .await?;
            let rate_age_days = rate_age_days(&rate_effective_date, &as_of)?;
            if !local_currency.eq_ignore_ascii_case(&reporting_currency) {
                let allowed_age = max_rate_age_days.ok_or_else(|| {
                    ApiError::new(
                        409,
                        "CURRENCY_RATE_POLICY_MISSING",
                        "Set a maximum currency rate age on the company group before viewing translated reports",
                    )
                })?;
                if Decimal::from(rate_age_days) > allowed_age {
                    return Err(ApiError::new(
                        409,
                        "CURRENCY_RATE_STALE",
                        format!(
                            "Tenant {} currency rate is {rate_age_days} days old; this group allows at most {allowed_age} days",
                            tenant.name
                        ),
                    ));
                }
            }
            member_tx.commit().await?;

            let balance = self
                .accounting_trial_balance(
                    &Actor::System,
                    &tenant,
                    from_text.as_deref(),
                    to_text.as_deref(),
                )
                .await?;
            let mut accounts = Vec::new();
            for row in balance
                .get("accounts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let code = row
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let kind = row
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let name = row
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let mut values = [Decimal::ZERO; 6];
                let mut account = row.clone();
                for (index, field) in fields.iter().enumerate() {
                    values[index] = converted(row, field, rate)?;
                    if let Some(object) = account.as_object_mut() {
                        let suffix = field
                            .chars()
                            .next()
                            .unwrap()
                            .to_ascii_uppercase()
                            .to_string()
                            + &field[1..];
                        object.insert(format!("reporting{suffix}"), json_amount(values[index])?);
                    }
                }
                let bucket = totals
                    .entry((code.clone(), kind.clone()))
                    .or_insert((name, [Decimal::ZERO; 6]));
                for (total, value) in bucket.1.iter_mut().zip(values) {
                    *total = total.checked_add(value).ok_or_else(amount_error)?;
                }
                accounts.push(account);
            }
            companies.push(json!({
                "tenantId": tenant.id,
                "name": member_name,
                "localCurrency": local_currency,
                "reportingCurrency": reporting_currency,
                "conversionRate": json_amount(rate)?,
                "rateEffectiveDate": rate_effective_date,
                "rateAgeDays": rate_age_days,
                "maxRateAgeDays": max_rate_age_days.map(json_amount).transpose()?,
                "accounts": accounts,
            }));
        }
        let accounts = totals
            .into_iter()
            .map(|((code, kind), (name, values))| {
                Ok(json!({
                    "code": code,
                    "name": name,
                    "kind": kind,
                    "openingDebit": json_amount(values[0])?,
                    "openingCredit": json_amount(values[1])?,
                    "periodDebit": json_amount(values[2])?,
                    "periodCredit": json_amount(values[3])?,
                    "closingDebit": json_amount(values[4])?,
                    "closingCredit": json_amount(values[5])?,
                }))
            })
            .collect::<R<Vec<_>>>()?;
        let (debit_total, credit_total) = accounts.iter().try_fold(
            (Decimal::ZERO, Decimal::ZERO),
            |(debit_total, credit_total), account| {
                let debit = account
                    .get("closingDebit")
                    .and_then(crate::money::decimal)
                    .ok_or_else(amount_error)?;
                let credit = account
                    .get("closingCredit")
                    .and_then(crate::money::decimal)
                    .ok_or_else(amount_error)?;
                Ok::<_, ApiError>((
                    debit_total.checked_add(debit).ok_or_else(amount_error)?,
                    credit_total.checked_add(credit).ok_or_else(amount_error)?,
                ))
            },
        )?;
        let imbalance = debit_total
            .checked_sub(credit_total)
            .ok_or_else(amount_error)?;
        self.audit_raw_ro(
            owner,
            actor,
            "company_group.trial_balance.read",
            &format!("consolidation.company_group#{group_id}"),
        )
        .await?;
        Ok(json!({
            "groupId": group_id,
            "from": from_text,
            "to": to_text,
            "reportingCurrency": reporting_currency,
            "maxRateAgeDays": max_rate_age_days.map(json_amount).transpose()?,
            "rateBasis": "latest direct or inverse currency rate effective on or before the report end date; same rate applied to all balance columns",
            "consolidationMethod": "account-code roll-up; intercompany balances are not eliminated",
            "reconciliation": {
                "closingDebitTotal": json_amount(debit_total)?,
                "closingCreditTotal": json_amount(credit_total)?,
                "difference": json_amount(imbalance)?,
                "withinCentTolerance": imbalance.abs() <= Decimal::new(1, 2),
            },
            "companies": companies,
            "accounts": accounts,
        }))
    }
}
