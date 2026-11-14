//! Deterministic bank-statement matching for an unambiguous posted journal.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use chrono::NaiveDate;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn base_currency_code(tenant: &Tenant) -> String {
    tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase()
}

async fn base_currency_id(tx: &Tx<'_>, tenant: &Tenant) -> R<Option<Uuid>> {
    Ok(tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
            &[&tenant.id, &base_currency_code(tenant)],
        )
        .await?
        .map(|row| row.get(0)))
}

pub async fn prepare_bank_statement(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if document
        .get("currency")
        .is_some_and(|value| !value.is_null())
    {
        return Ok(Vec::new());
    }
    let Some(currency) = base_currency_id(tx, tenant).await? else {
        return Ok(vec![format!(
            "Tenant base currency {} is missing from its currency catalog",
            base_currency_code(tenant)
        )]);
    };
    document.insert("currency".into(), json!(currency));
    Ok(Vec::new())
}

pub async fn prepare_bank_statement_line(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(statement_id) = document
        .get("statement")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(Vec::new());
    };
    let Some(transaction_date) = document
        .get("transaction_date")
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Ok(Vec::new());
    };
    let Some(amount) = document
        .get("amount")
        .and_then(money::decimal)
        .filter(|amount| *amount > Decimal::ZERO)
    else {
        return Ok(Vec::new());
    };
    let Some(base_currency_id) = base_currency_id(tx, tenant).await? else {
        return Ok(vec![format!(
            "Tenant base currency {} is missing from its currency catalog",
            base_currency_code(tenant)
        )]);
    };
    let Some(statement) = tx
        .query_opt(
            "SELECT currency FROM accounting__bank_statement WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &statement_id],
        )
        .await?
    else {
        return Ok(Vec::new());
    };
    let statement_currency: Option<Uuid> = statement.get(0);
    let currency_id = statement_currency.unwrap_or(base_currency_id);
    let (exchange_rate, exchange_rate_date) = if currency_id == base_currency_id {
        (Decimal::ONE, transaction_date)
    } else {
        let Some(rate) = tx
            .query_opt(
                "SELECT rate::text, effective_date FROM master_data__currency_rate WHERE tenant_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4 ORDER BY effective_date DESC, created_at DESC LIMIT 1 FOR SHARE",
                &[&tenant.id, &currency_id, &base_currency_id, &transaction_date],
            )
            .await?
        else {
            return Ok(vec![format!(
                "No rate exists to convert the bank statement line to {} on {transaction_date}",
                base_currency_code(tenant)
            )]);
        };
        let rate_text: String = rate.get(0);
        let Some(exchange_rate) = money::decimal_str(&rate_text) else {
            return Err(ApiError::validation(
                "accounting.bank_statement_line",
                vec!["Stored exchange rate exceeds the supported decimal range".into()],
            ));
        };
        (exchange_rate, rate.get(1))
    };
    if exchange_rate <= Decimal::ZERO {
        return Ok(vec![
            "Bank statement exchange rate must be greater than zero".into(),
        ]);
    }
    let Some(base_amount) = amount
        .checked_mul(exchange_rate)
        .map(|value| value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
    else {
        return Ok(vec![
            "Converted bank statement amount exceeds the supported money range".into(),
        ]);
    };
    let (Some(exchange_rate), Some(base_amount)) = (
        money::json_number(exchange_rate),
        money::json_number(base_amount),
    ) else {
        return Ok(vec![
            "Converted bank statement amount exceeds the supported money range".into(),
        ]);
    };
    document.insert("base_amount".into(), base_amount);
    document.insert("exchange_rate".into(), exchange_rate);
    document.insert(
        "exchange_rate_date".into(),
        Value::String(exchange_rate_date.to_string()),
    );
    Ok(Vec::new())
}

pub async fn prepare_match(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity != "bank_statement_line" || action != "matched" {
        return Ok(Vec::new());
    }
    if document
        .get("payment")
        .is_some_and(|value| !value.is_null())
        || document
            .get("journal_entry")
            .is_some_and(|value| !value.is_null())
    {
        return Ok(Vec::new());
    }
    let Some(line_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Bank statement line requires a valid id".into()]);
    };
    let Some(date) = document
        .get("transaction_date")
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Ok(vec![
            "Bank statement line requires a valid transaction date".into(),
        ]);
    };
    let Some(amount) = document
        .get("amount")
        .and_then(crate::money::decimal)
        .filter(|value| *value > Decimal::ZERO)
    else {
        return Ok(vec![
            "Bank statement line requires a positive amount".into(),
        ]);
    };
    let base_amount = document
        .get("base_amount")
        .and_then(crate::money::decimal)
        .unwrap_or(amount);
    let expected_net = match document.get("direction").and_then(Value::as_str) {
        Some("credit") => base_amount,
        Some("debit") => Decimal::ZERO.checked_sub(base_amount).ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.bank_statement_line",
                vec!["Bank statement amount exceeds the supported decimal range".into()],
            )
        })?,
        _ => {
            return Ok(vec![
                "Bank statement line requires a valid direction".into(),
            ]);
        }
    };
    let expected_net = expected_net.normalize().to_string();
    let candidates = tx
        .query(
            "SELECT j.id FROM accounting__journal_entry j \
             JOIN accounting__account bank ON bank.tenant_id = j.tenant_id AND bank.code = '112' \
             WHERE j.tenant_id = $1 AND j.status = 'posted' AND j.posting_date = $2 \
               AND abs(COALESCE((SELECT sum(COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)) \
                 FROM jsonb_array_elements(COALESCE(j.lines, '[]'::jsonb)) line \
                 WHERE line->>'account' = bank.id::text), 0) - $3::numeric) <= 0.005 \
               AND NOT EXISTS (SELECT 1 FROM accounting__bank_statement_line matched \
                 WHERE matched.tenant_id = j.tenant_id AND matched.status = 'matched' AND matched.id <> $4 \
                   AND (matched.journal_entry = j.id OR EXISTS (SELECT 1 FROM accounting__payment payment \
                     JOIN accounting__journal_entry payment_journal ON payment_journal.tenant_id = payment.tenant_id \
                       AND payment_journal.source = 'payment' AND payment_journal.source_id = payment.id::text \
                     WHERE payment.tenant_id = matched.tenant_id AND payment.id = matched.payment \
                       AND payment_journal.id = j.id))) \
             ORDER BY j.id LIMIT 2",
            &[&tenant.id, &date, &expected_net, &line_id],
        )
        .await?;
    match candidates.as_slice() {
        [candidate] => {
            let journal_id: Uuid = candidate.get(0);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("accounting.bank_match:{}:{journal_id}", tenant.id)],
            )
            .await?;
            let already_matched = tx
                .query_opt(
                    "SELECT 1 FROM accounting__bank_statement_line matched \
                     WHERE matched.tenant_id = $1 AND matched.status = 'matched' AND matched.id <> $2 \
                       AND (matched.journal_entry = $3 OR EXISTS (SELECT 1 \
                         FROM accounting__payment payment \
                         JOIN accounting__journal_entry payment_journal ON payment_journal.tenant_id = payment.tenant_id \
                           AND payment_journal.source = 'payment' AND payment_journal.source_id = payment.id::text \
                         WHERE payment.tenant_id = matched.tenant_id AND payment.id = matched.payment \
                           AND payment_journal.id = $3)) LIMIT 1",
                    &[&tenant.id, &line_id, &journal_id],
                )
                .await?
                .is_some();
            if already_matched {
                return Ok(vec![
                    "The matching journal was reconciled by another statement line; choose a different journal".into(),
                ]);
            }
            document.insert("journal_entry".into(), json!(journal_id));
            Ok(Vec::new())
        }
        [] => Ok(vec![
            "No unused posted bank journal matches this line's date, direction and amount; select the payment or journal manually".into(),
        ]),
        _ => Ok(vec![
            "More than one posted bank journal matches this line; select the journal manually".into(),
        ]),
    }
}
