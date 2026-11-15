use super::common::{account_with_balance, balance_value, parse_date};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use rust_decimal::Decimal;
use serde_json::{Value, json};

fn add_amount(left: Decimal, right: Decimal) -> R<Decimal> {
    left.checked_add(right).ok_or_else(report_amount_error)
}

fn subtract_amount(left: Decimal, right: Decimal) -> R<Decimal> {
    left.checked_sub(right).ok_or_else(report_amount_error)
}

fn amount_value(value: Decimal) -> R<Value> {
    crate::money::json_number(value).ok_or_else(report_amount_error)
}

fn report_amount_error() -> ApiError {
    ApiError::validation(
        "accounting.report",
        vec!["Calculated report amount exceeds the supported decimal range".into()],
    )
}

impl Kernel {
    /// Summarize opening, period movement, and closing balances per account.
    pub async fn accounting_trial_balance(
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
                "from phải nhỏ hơn hoặc bằng to",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let rows = tx
            .query_json(
                "WITH posted_lines AS ( \
                    SELECT a.id AS account_id, a.code, a.name, a.kind, COALESCE(j.posting_date, (j.created_at AT TIME ZONE $4)::date) AS posting_date, \
                           COALESCE((line.value->>'debit')::numeric, 0) AS debit, \
                           COALESCE((line.value->>'credit')::numeric, 0) AS credit \
                    FROM accounting__journal_entry j \
                    CROSS JOIN LATERAL jsonb_array_elements(j.lines) AS line(value) \
                    JOIN accounting__account a ON a.tenant_id = j.tenant_id \
                      AND a.id = (line.value->>'account')::uuid \
                    WHERE j.tenant_id = $1 AND j.status IN ('posted', 'reversed') \
                      AND ($3::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE $4)::date) <= $3::date) \
                 ), grouped AS ( \
                    SELECT account_id, code, name, kind, \
                      COALESCE(SUM(debit) FILTER (WHERE $2::date IS NOT NULL AND posting_date < $2::date), 0) AS opening_debit_total, \
                      COALESCE(SUM(credit) FILTER (WHERE $2::date IS NOT NULL AND posting_date < $2::date), 0) AS opening_credit_total, \
                      COALESCE(SUM(debit) FILTER (WHERE ($2::date IS NULL OR posting_date >= $2::date) AND ($3::date IS NULL OR posting_date <= $3::date)), 0) AS period_debit, \
                      COALESCE(SUM(credit) FILTER (WHERE ($2::date IS NULL OR posting_date >= $2::date) AND ($3::date IS NULL OR posting_date <= $3::date)), 0) AS period_credit \
                    FROM posted_lines GROUP BY account_id, code, name, kind \
                 ), all_accounts AS ( \
                    SELECT a.id AS account_id, a.code, a.name, a.kind, \
                      COALESCE(g.opening_debit_total, 0) AS opening_debit_total, \
                      COALESCE(g.opening_credit_total, 0) AS opening_credit_total, \
                      COALESCE(g.period_debit, 0) AS period_debit, \
                      COALESCE(g.period_credit, 0) AS period_credit \
                    FROM accounting__account a LEFT JOIN grouped g ON g.account_id = a.id \
                    WHERE a.tenant_id = $1 \
                 ) SELECT jsonb_build_object( \
                    'accountId', account_id, 'code', code, 'name', name, 'kind', kind, \
                    'openingDebit', GREATEST(opening_debit_total - opening_credit_total, 0), \
                    'openingCredit', GREATEST(opening_credit_total - opening_debit_total, 0), \
                    'periodDebit', period_debit, 'periodCredit', period_credit, \
                    'closingDebit', GREATEST(opening_debit_total - opening_credit_total + period_debit - period_credit, 0), \
                    'closingCredit', GREATEST(opening_credit_total - opening_debit_total + period_credit - period_debit, 0) \
                 ) FROM all_accounts ORDER BY code, account_id",
                &[&tenant.id, &from, &to, &tenant.business_timezone().to_string()],
            )
            .await?;
        Ok(json!({ "from": from, "to": to, "accounts": rows }))
    }

    /// List posted transactions for one account with a chronological running balance.
    pub async fn accounting_general_ledger(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        account_id: &str,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        self.ensure_accounting_read(tenant, actor)?;
        let account_id = uuid::Uuid::parse_str(account_id)
            .map_err(|_| ApiError::new(422, "INVALID_ACCOUNT", "accountId không hợp lệ"))?;
        let from = parse_date(from, "from")?;
        let to = parse_date(to, "to")?;
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err(ApiError::new(
                422,
                "INVALID_DATE_RANGE",
                "from phải nhỏ hơn hoặc bằng to",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        if tx
            .query_opt(
                "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &account_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::not_found("Không tìm thấy tài khoản kế toán"));
        }
        let rows = tx
            .query_json(
                "WITH account_lines AS ( \
                    SELECT j.id AS entry_id, j.created_at, COALESCE(j.posting_date, (j.created_at AT TIME ZONE $5)::date) AS posting_date, j.memo, \
                           line.ordinality AS line_number, \
                           COALESCE((line.value->>'debit')::numeric, 0) AS debit, \
                           COALESCE((line.value->>'credit')::numeric, 0) AS credit \
                    FROM accounting__journal_entry j \
                    CROSS JOIN LATERAL jsonb_array_elements(j.lines) WITH ORDINALITY AS line(value, ordinality) \
                    WHERE j.tenant_id = $1 AND j.status IN ('posted', 'reversed') \
                      AND line.value->>'account' = $2::text \
                      AND ($4::date IS NULL OR COALESCE(j.posting_date, (j.created_at AT TIME ZONE $5)::date) <= $4::date) \
                 ), balances AS ( \
                    SELECT *, SUM(debit - credit) OVER (ORDER BY posting_date, created_at, entry_id, line_number) AS running_balance \
                    FROM account_lines \
                 ) SELECT jsonb_build_object( \
                    'entryId', entry_id, 'date', posting_date, 'memo', memo, 'lineNumber', line_number, \
                    'debit', debit, 'credit', credit, 'runningBalance', running_balance \
                 ) FROM balances WHERE ($3::date IS NULL OR posting_date >= $3::date) \
                   AND ($4::date IS NULL OR posting_date <= $4::date) \
                 ORDER BY posting_date, created_at, entry_id, line_number",
                &[
                    &tenant.id,
                    &account_id.to_string(),
                    &from,
                    &to,
                    &tenant.business_timezone().to_string(),
                ],
            )
            .await?;
        Ok(json!({ "accountId": account_id, "from": from, "to": to, "entries": rows }))
    }

    /// Profit and loss for a date range, calculated from posted ledger movements.
    pub async fn accounting_income_statement(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        from: Option<&str>,
        to: Option<&str>,
    ) -> R<Value> {
        let trial_balance = self
            .accounting_trial_balance(actor, tenant, from, to)
            .await?;
        let accounts = trial_balance
            .get("accounts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut revenue_accounts = Vec::new();
        let mut expense_accounts = Vec::new();
        let mut unclassified_accounts = Vec::new();
        let mut revenue = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        for account in accounts {
            match account.get("kind").and_then(Value::as_str) {
                Some("revenue") => {
                    let balance = subtract_amount(
                        balance_value(&account, "periodCredit")?,
                        balance_value(&account, "periodDebit")?,
                    )?;
                    revenue = add_amount(revenue, balance)?;
                    revenue_accounts.push(account_with_balance(&account, balance)?);
                }
                Some("expense") => {
                    let balance = subtract_amount(
                        balance_value(&account, "periodDebit")?,
                        balance_value(&account, "periodCredit")?,
                    )?;
                    expense = add_amount(expense, balance)?;
                    expense_accounts.push(account_with_balance(&account, balance)?);
                }
                Some("clearing") => {
                    if balance_value(&account, "periodDebit")? != Decimal::ZERO
                        || balance_value(&account, "periodCredit")? != Decimal::ZERO
                    {
                        unclassified_accounts.push(account_with_balance(
                            &account,
                            subtract_amount(
                                balance_value(&account, "periodDebit")?,
                                balance_value(&account, "periodCredit")?,
                            )?,
                        )?);
                    }
                }
                _ => unclassified_accounts.push(account_with_balance(
                    &account,
                    subtract_amount(
                        balance_value(&account, "periodDebit")?,
                        balance_value(&account, "periodCredit")?,
                    )?,
                )?),
            }
        }
        let from = trial_balance.get("from").cloned().unwrap_or(Value::Null);
        let to = trial_balance.get("to").cloned().unwrap_or(Value::Null);
        let complete = unclassified_accounts.is_empty();
        Ok(json!({
            "from": from,
            "to": to,
            "revenue": revenue_accounts,
            "expense": expense_accounts,
            "unclassified": unclassified_accounts,
            "complete": complete,
            "totalRevenue": amount_value(revenue)?,
            "totalExpense": amount_value(expense)?,
            "netIncome": amount_value(subtract_amount(revenue, expense)?)?,
        }))
    }

    /// Balance sheet through an inclusive accounting date, including accumulated current earnings.
    pub async fn accounting_balance_sheet(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        as_of: Option<&str>,
    ) -> R<Value> {
        let as_of = as_of
            .map(str::to_owned)
            .unwrap_or_else(|| tenant.business_today().to_string());
        let trial_balance = self
            .accounting_trial_balance(actor, tenant, None, Some(&as_of))
            .await?;
        let accounts = trial_balance
            .get("accounts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut assets = Vec::new();
        let mut liabilities = Vec::new();
        let mut equity = Vec::new();
        let mut unclassified = Vec::new();
        let mut revenue = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        let mut total_assets = Decimal::ZERO;
        let mut total_liabilities = Decimal::ZERO;
        let mut total_equity = Decimal::ZERO;
        for account in accounts {
            let debit = balance_value(&account, "closingDebit")?;
            let credit = balance_value(&account, "closingCredit")?;
            match account.get("kind").and_then(Value::as_str) {
                Some("asset") => {
                    let balance = subtract_amount(debit, credit)?;
                    total_assets = add_amount(total_assets, balance)?;
                    assets.push(account_with_balance(&account, balance)?);
                }
                Some("liability") => {
                    let balance = subtract_amount(credit, debit)?;
                    total_liabilities = add_amount(total_liabilities, balance)?;
                    liabilities.push(account_with_balance(&account, balance)?);
                }
                Some("equity") => {
                    let balance = subtract_amount(credit, debit)?;
                    total_equity = add_amount(total_equity, balance)?;
                    equity.push(account_with_balance(&account, balance)?);
                }
                Some("revenue") => {
                    revenue = add_amount(revenue, subtract_amount(credit, debit)?)?;
                }
                Some("expense") => {
                    expense = add_amount(expense, subtract_amount(debit, credit)?)?;
                }
                Some("clearing") if debit == Decimal::ZERO && credit == Decimal::ZERO => {}
                _ => unclassified.push(account_with_balance(
                    &account,
                    subtract_amount(debit, credit)?,
                )?),
            }
        }
        let current_earnings = subtract_amount(revenue, expense)?;
        let liabilities_and_equity = add_amount(
            add_amount(total_liabilities, total_equity)?,
            current_earnings,
        )?;
        let difference = subtract_amount(total_assets, liabilities_and_equity)?;
        let complete = unclassified.is_empty();
        Ok(json!({
            "asOf": trial_balance.get("to").cloned().unwrap_or(Value::Null),
            "assets": assets,
            "liabilities": liabilities,
            "equity": equity,
            "unclassified": unclassified,
            "totalAssets": amount_value(total_assets)?,
            "totalLiabilities": amount_value(total_liabilities)?,
            "totalEquity": amount_value(total_equity)?,
            "currentEarnings": amount_value(current_earnings)?,
            "liabilitiesAndEquity": amount_value(liabilities_and_equity)?,
            "difference": amount_value(difference)?,
            "balanced": crate::money::within_tolerance(difference, Decimal::ZERO, Decimal::new(5, 3)) && complete,
            "complete": complete,
        }))
    }
}
