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
) -> R<Decimal> {
    if from_code.eq_ignore_ascii_case(to_code) {
        return Ok(Decimal::ONE);
    }
    let direct = tx
        .query_opt(
            "SELECT rate::text FROM master_data__currency_rate WHERE tenant_id=$1 AND from_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($2)) AND to_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($3)) AND effective_date <= $4::date ORDER BY effective_date DESC, created_at DESC LIMIT 1",
            &[&tenant.id, &from_code, &to_code, &as_of],
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
        return Ok(rate);
    }
    let reverse = tx
        .query_opt(
            "SELECT rate::text FROM master_data__currency_rate WHERE tenant_id=$1 AND from_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($3)) AND to_currency=(SELECT id FROM master_data__currency WHERE tenant_id=$1 AND upper(code)=upper($2)) AND effective_date <= $4::date ORDER BY effective_date DESC, created_at DESC LIMIT 1",
            &[&tenant.id, &from_code, &to_code, &as_of],
        )
        .await?
        .ok_or_else(|| ApiError::new(409, "CURRENCY_RATE_MISSING", format!("No {from_code}/{to_code} currency rate is available on or before {as_of}")))?;
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
    Decimal::ONE
        .checked_div(reverse_rate)
        .ok_or_else(amount_error)
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
        self.authorize(owner, actor, "consolidation.member.read")?;
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
        let group_row = owner_tx.query_opt(
            "SELECT currency.code FROM consolidation__company_group group_row JOIN master_data__currency currency ON currency.tenant_id=group_row.tenant_id AND currency.id=group_row.reporting_currency WHERE group_row.tenant_id=$1 AND group_row.id=$2",
            &[&owner.id, &group_id],
        ).await?.ok_or_else(|| ApiError::not_found("Company group"))?;
        let reporting_currency: String = group_row.get(0);
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
            let rate = currency_rate(
                &member_tx,
                &tenant,
                local_currency,
                &reporting_currency,
                &as_of,
            )
            .await?;
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
                        object.insert((*field).into(), json_amount(values[index])?);
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
            "rateBasis": "latest direct or inverse currency rate effective on or before the report end date; same rate applied to all balance columns",
            "consolidationMethod": "account-code roll-up; intercompany balances are not eliminated",
            "companies": companies,
            "accounts": accounts,
        }))
    }
}
