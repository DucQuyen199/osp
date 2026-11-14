//! Snapshot source-currency amounts into the tenant ledger currency at posting time.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value};
use uuid::Uuid;

fn amount(document: &Map<String, Value>, field: &str) -> Option<Decimal> {
    money::decimal(document.get(field)?)
}

fn database_amount(row: &tokio_postgres::Row, column: usize) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                ApiError::validation(
                    "accounting.currency",
                    vec!["Stored currency amount exceeds the supported decimal range".into()],
                )
            })
        })
        .transpose()
}

fn round_currency(amount: Decimal) -> Decimal {
    amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

fn amount_value(amount: Decimal) -> Option<Value> {
    money::json_number(amount)
}

fn conversion_error(message: &str) -> Vec<String> {
    vec![message.to_owned()]
}

pub async fn prepare_currency_posting(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if !matches!(entity, "invoice" | "bill" | "credit_note" | "debit_note") {
        return Ok(Vec::new());
    }
    let Some(total) = amount(document, "total") else {
        return Ok(Vec::new()); // Domain validation returns the canonical document errors.
    };
    let tax = match document.get("tax_total").filter(|value| !value.is_null()) {
        None => Decimal::ZERO,
        Some(value) => match money::decimal(value) {
            Some(tax) => tax,
            None => {
                return Ok(conversion_error(
                    "Document tax total must be a valid decimal",
                ));
            }
        },
    };
    let Some(tax_limit) = total.checked_add(Decimal::new(5, 3)) else {
        return Ok(conversion_error(
            "Document total exceeds the supported decimal range",
        ));
    };
    if total <= Decimal::ZERO || tax < Decimal::ZERO || tax > tax_limit {
        return Ok(Vec::new()); // Domain validation returns the canonical document errors.
    }

    let base_code = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let base = tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
            &[&tenant.id, &base_code],
        )
        .await?;
    let Some(base) = base else {
        return Ok(vec![format!(
            "Tenant base currency {base_code} is missing from its currency catalog"
        )]);
    };
    let base_id: Uuid = base.get(0);

    let (currency_id, exchange_rate, rate_date) = if matches!(entity, "credit_note" | "debit_note")
    {
        let (field, table) = if entity == "credit_note" {
            ("invoice", "accounting__invoice")
        } else {
            ("bill", "accounting__bill")
        };
        let Some(source_id) = document
            .get(field)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(Vec::new());
        };
        let source = tx
            .query_opt(
                &format!("SELECT currency, exchange_rate::text, exchange_rate_date, issue_date FROM {table} WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('draft', 'void') FOR SHARE"),
                &[&tenant.id, &source_id],
            )
            .await?;
        let Some(source) = source else {
            return Ok(vec![
                "Adjustment note requires a posted source document".into(),
            ]);
        };
        let currency_id: Option<Uuid> = source.get(0);
        let exchange_rate = database_amount(&source, 1)?;
        let rate_date: Option<chrono::NaiveDate> = source.get(2);
        let issue_date: Option<chrono::NaiveDate> = source.get(3);
        let currency_id = currency_id.unwrap_or(base_id);
        let Some(exchange_rate) =
            exchange_rate.or_else(|| (currency_id == base_id).then_some(Decimal::ONE))
        else {
            return Ok(vec![
                "Source document has no currency conversion snapshot".into(),
            ]);
        };
        let rate_date = rate_date
            .or(issue_date)
            .unwrap_or_else(|| chrono::Utc::now().date_naive());
        (currency_id, exchange_rate, rate_date)
    } else {
        let currency_id = match document
            .get("currency")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            Some(currency_id) => currency_id,
            None if document.get("currency").is_none_or(Value::is_null) => base_id,
            None => {
                return Ok(vec![
                    "Document currency must reference a valid tenant currency".into(),
                ]);
            }
        };
        let source = document.get("source").and_then(Value::as_str);
        if entity == "bill" && source == Some("purchase_order") && currency_id != base_id {
            return Ok(vec![
                "Purchase-order bills must use the tenant base currency because purchase orders are denominated in base currency".into(),
            ]);
        }
        let currency_exists = tx
            .query_opt(
                "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &currency_id],
            )
            .await?
            .is_some();
        if !currency_exists {
            return Ok(vec![
                "Document currency does not belong to this tenant".into(),
            ]);
        }
        let issue_date = match document
            .get("issue_date")
            .and_then(Value::as_str)
            .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        {
            Some(date) => date,
            None => {
                let today = chrono::Utc::now().date_naive();
                document.insert("issue_date".into(), Value::String(today.to_string()));
                today
            }
        };
        if currency_id == base_id {
            (currency_id, Decimal::ONE, issue_date)
        } else {
            let rate = tx
                .query_opt(
                    "SELECT rate::text, effective_date FROM master_data__currency_rate WHERE tenant_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4 ORDER BY effective_date DESC, created_at DESC LIMIT 1 FOR SHARE",
                    &[&tenant.id, &currency_id, &base_id, &issue_date],
                )
                .await?;
            let Some(rate) = rate else {
                return Ok(vec![format!(
                    "No rate exists to convert this currency to {base_code} on {issue_date}"
                )]);
            };
            (
                currency_id,
                database_amount(&rate, 0)?.ok_or_else(|| {
                    ApiError::validation(
                        "accounting.currency",
                        vec!["Exchange rate is missing".into()],
                    )
                })?,
                rate.get(1),
            )
        }
    };

    if exchange_rate <= Decimal::ZERO {
        return Ok(vec![
            "Document exchange rate must be greater than zero".into(),
        ]);
    }
    let Some(base_total) = total.checked_mul(exchange_rate).map(round_currency) else {
        return Ok(conversion_error(
            "Converted document totals exceed the supported money range",
        ));
    };
    let Some(base_tax_total) = tax.checked_mul(exchange_rate).map(round_currency) else {
        return Ok(conversion_error(
            "Converted document totals exceed the supported money range",
        ));
    };
    let (Some(exchange_rate), Some(base_total), Some(base_tax_total)) = (
        amount_value(exchange_rate),
        amount_value(base_total),
        amount_value(base_tax_total),
    ) else {
        return Ok(conversion_error(
            "Converted document totals exceed the supported money range",
        ));
    };
    document.insert("currency".into(), Value::String(currency_id.to_string()));
    document.insert("exchange_rate".into(), exchange_rate);
    document.insert(
        "exchange_rate_date".into(),
        Value::String(rate_date.to_string()),
    );
    document.insert("base_total".into(), base_total);
    document.insert("base_tax_total".into(), base_tax_total);
    document.insert(
        "tax_total".into(),
        amount_value(tax).expect("validated Decimal"),
    );
    Ok(Vec::new())
}

pub async fn prepare_payment_currency(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(payment_amount) = amount(document, "amount") else {
        return Ok(Vec::new());
    };
    let base_code = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let Some(base_row) = tx
        .query_opt(
            "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
            &[&tenant.id, &base_code],
        )
        .await?
    else {
        return Ok(vec![format!(
            "Tenant base currency {base_code} is missing from its currency catalog"
        )]);
    };
    let base_id: Uuid = base_row.get(0);
    let invoice_id = document
        .get("invoice")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let bill_id = document
        .get("bill")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let linked_document = match (invoice_id, bill_id) {
        (Some(_), Some(_)) => {
            return Ok(vec![
                "Payment cannot settle both an invoice and a bill".into(),
            ]);
        }
        (Some(id), None) => Some(("accounting__invoice", id)),
        (None, Some(id)) => Some(("accounting__bill", id)),
        (None, None) => None,
    };

    let (currency_id, applied_rate) = if let Some((table, id)) = linked_document {
        let source = tx
            .query_opt(
                &format!("SELECT currency, exchange_rate::text, status FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"),
                &[&tenant.id, &id],
            )
            .await?;
        let Some(source) = source else {
            return Ok(vec![
                "Payment source document was not found in this tenant".into(),
            ]);
        };
        let source_currency: Option<Uuid> = source.get(0);
        let source_rate = database_amount(&source, 1)?;
        let status: String = source.get(2);
        if matches!(status.as_str(), "draft" | "void") {
            return Ok(vec![
                "Payment can only settle a posted source document".into(),
            ]);
        }
        let source_currency = source_currency.unwrap_or(base_id);
        let Some(source_rate) =
            source_rate.or_else(|| (source_currency == base_id).then_some(Decimal::ONE))
        else {
            return Ok(vec![
                "Source document has no currency conversion snapshot".into(),
            ]);
        };
        (source_currency, source_rate)
    } else {
        (base_id, Decimal::ONE)
    };
    if applied_rate <= Decimal::ZERO {
        return Ok(vec![
            "Source document exchange rate must be greater than zero".into(),
        ]);
    }

    if let Some(requested) = document
        .get("currency")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        && requested != currency_id
    {
        return Ok(vec![
            "Payment currency must match its source document currency".into(),
        ]);
    }
    let payment_date = match document.get("payment_date") {
        Some(Value::String(value)) => match chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
            Ok(date) => date,
            Err(_) => return Ok(vec!["Payment date must use YYYY-MM-DD".into()]),
        },
        Some(_) => return Ok(vec!["Payment date must use YYYY-MM-DD".into()]),
        None => {
            let today = chrono::Utc::now().date_naive();
            document.insert("payment_date".into(), Value::String(today.to_string()));
            today
        }
    };
    let (exchange_rate, rate_date): (Decimal, chrono::NaiveDate) = if currency_id == base_id {
        (Decimal::ONE, payment_date)
    } else {
        let rate = tx
            .query_opt(
                "SELECT rate::text, effective_date FROM master_data__currency_rate WHERE tenant_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4 ORDER BY effective_date DESC, created_at DESC LIMIT 1 FOR SHARE",
                &[&tenant.id, &currency_id, &base_id, &payment_date],
            )
            .await?;
        let Some(rate) = rate else {
            return Ok(vec![format!(
                "No rate exists to convert this payment to {base_code} on {payment_date}"
            )]);
        };
        (
            database_amount(&rate, 0)?.ok_or_else(|| {
                ApiError::validation(
                    "accounting.currency",
                    vec!["Exchange rate is missing".into()],
                )
            })?,
            rate.get(1),
        )
    };
    if exchange_rate <= Decimal::ZERO {
        return Ok(vec![
            "Payment exchange rate must be greater than zero".into(),
        ]);
    }
    let tax = amount(document, "tax_amount").unwrap_or(Decimal::ZERO);
    let Some(base_amount) = payment_amount
        .checked_mul(exchange_rate)
        .map(round_currency)
    else {
        return Ok(conversion_error(
            "Converted payment amount exceeds the supported money range",
        ));
    };
    let Some(applied_base_amount) = payment_amount.checked_mul(applied_rate).map(round_currency)
    else {
        return Ok(conversion_error(
            "Converted payment amount exceeds the supported money range",
        ));
    };
    let Some(base_tax_amount) = tax.checked_mul(exchange_rate).map(round_currency) else {
        return Ok(conversion_error(
            "Converted payment amount exceeds the supported money range",
        ));
    };
    let (Some(exchange_rate), Some(base_amount), Some(applied_base_amount), Some(base_tax_amount)) = (
        amount_value(exchange_rate),
        amount_value(base_amount),
        amount_value(applied_base_amount),
        amount_value(base_tax_amount),
    ) else {
        return Ok(conversion_error(
            "Converted payment amount exceeds the supported money range",
        ));
    };
    document.insert("currency".into(), Value::String(currency_id.to_string()));
    document.insert("exchange_rate".into(), exchange_rate);
    document.insert(
        "exchange_rate_date".into(),
        Value::String(rate_date.to_string()),
    );
    document.insert("base_amount".into(), base_amount);
    document.insert("applied_base_amount".into(), applied_base_amount);
    document.insert("base_tax_amount".into(), base_tax_amount);
    Ok(Vec::new())
}
