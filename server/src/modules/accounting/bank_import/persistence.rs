use super::model::{BankAccountIdentity, BankLine, validation};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use uuid::Uuid;

fn deterministic_reference(statement_id: Uuid, line: &BankLine, format: &str) -> String {
    let source = format!(
        "{}|{}|{}|{}|{}|{}",
        statement_id,
        line.row,
        line.date,
        line.direction,
        line.amount.normalize(),
        line.description.as_deref().unwrap_or_default()
    );
    format!(
        "{format}-{}",
        hex::encode(Sha256::digest(source.as_bytes()))
    )
}

fn identical(existing: &tokio_postgres::Row, line: &BankLine) -> R<bool> {
    let date: NaiveDate = existing.get(0);
    let description: Option<String> = existing.get(1);
    let direction: String = existing.get(2);
    let amount: String = existing.get(3);
    let amount = crate::money::decimal_str(&amount).ok_or_else(|| {
        validation("Stored bank statement amount exceeds the supported decimal range")
    })?;
    Ok(date == line.date
        && description.as_deref() == line.description.as_deref()
        && direction == line.direction
        && crate::money::within_tolerance(amount, line.amount, Decimal::new(1, 4)))
}

pub(super) async fn import_lines(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: Uuid,
    lines: Vec<BankLine>,
    identity: Option<BankAccountIdentity>,
    reference_format: &str,
    row_label: &str,
) -> R<Value> {
    let entity = kernel.ent(tenant, "accounting.bank_statement_line")?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let base_currency = tenant
        .setting_str("baseCurrency")
        .unwrap_or("VND")
        .to_ascii_uppercase();
    let statement = tx
        .query_opt(
            "SELECT statement.status, statement.start_date, statement.end_date, upper(COALESCE(currency.code, $3)), account.kind, account.bank_account_id, account.bank_iban, account.casso_bank_account_id FROM accounting__bank_statement statement LEFT JOIN master_data__currency currency ON currency.tenant_id = statement.tenant_id AND currency.id = statement.currency JOIN accounting__account account ON account.tenant_id = statement.tenant_id AND account.id = statement.account WHERE statement.tenant_id = $1 AND statement.id = $2 FOR UPDATE OF statement, account",
            &[&tenant.id, &statement_id, &base_currency],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Bank statement not found for this tenant"))?;
    let status: String = statement.get(0);
    let start: NaiveDate = statement.get(1);
    let end: NaiveDate = statement.get(2);
    let statement_currency: String = statement.get(3);
    if let Some(identity) = identity {
        let kind: Option<String> = statement.get(4);
        if kind.as_deref() != Some("asset") {
            return Err(validation(
                "Bank imports require a statement linked to an asset account",
            ));
        }
        let expected: Option<String> = match &identity {
            BankAccountIdentity::AccountId(_) => statement.get(5),
            BankAccountIdentity::Iban(_) => statement.get(6),
            BankAccountIdentity::Casso(_) => statement.get(7),
        };
        let expected = expected
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| validation("Configure the matching bank identifier on the selected ledger account before importing this file"))?;
        let (actual, matches) = match &identity {
            BankAccountIdentity::AccountId(actual) => {
                (actual.as_str(), actual.trim() == expected.trim())
            }
            BankAccountIdentity::Iban(actual) => {
                let normalize = |value: &str| {
                    value
                        .chars()
                        .filter(|character| !character.is_ascii_whitespace())
                        .flat_map(char::to_uppercase)
                        .collect::<String>()
                };
                let matches = normalize(actual) == normalize(&expected);
                (actual.as_str(), matches)
            }
            BankAccountIdentity::Casso(actual) => {
                (actual.as_str(), actual.trim() == expected.trim())
            }
        };
        if !matches {
            return Err(validation(format!(
                "Imported bank account identifier {actual} does not match the identifier configured on the selected ledger account"
            )));
        }
    }
    if status != "draft" {
        return Err(ApiError::new(
            409,
            "STATEMENT_NOT_DRAFT",
            "Only draft bank statements accept imported lines",
        ));
    }

    let mut seen = HashMap::<String, BankLine>::new();
    let mut imported = 0_usize;
    let mut skipped = 0_usize;
    let mut line_ids = Vec::new();
    for line in lines {
        if line.date < start || line.date > end {
            return Err(validation(format!(
                "{row_label} {}: transaction date is outside the statement period",
                line.row,
            )));
        }
        if line
            .currency
            .as_deref()
            .is_some_and(|currency| currency != statement_currency)
        {
            return Err(validation(format!(
                "{row_label} {}: transaction currency does not match the bank statement currency {statement_currency}",
                line.row,
            )));
        }
        let reference = if line.reference.is_empty() {
            deterministic_reference(statement_id, &line, reference_format)
        } else {
            line.reference.clone()
        };
        if let Some(prior) = seen.get(&reference) {
            if prior.date == line.date
                && prior.description == line.description
                && prior.direction == line.direction
                && crate::money::within_tolerance(prior.amount, line.amount, Decimal::new(1, 4))
            {
                skipped += 1;
                continue;
            }
            return Err(validation(format!(
                "{row_label} {}: reference {reference} is repeated with different transaction data",
                line.row,
            )));
        }
        seen.insert(
            reference.clone(),
            BankLine {
                reference: reference.clone(),
                ..line.clone()
            },
        );
        if let Some(existing) = tx
            .query_opt(
                "SELECT transaction_date, description, direction, amount::text FROM accounting__bank_statement_line WHERE tenant_id = $1 AND statement = $2 AND reference = $3 FOR UPDATE",
                &[&tenant.id, &statement_id, &reference],
            )
            .await?
        {
            if identical(&existing, &line)? {
                skipped += 1;
                continue;
            }
            return Err(validation(format!(
                "{row_label} {}: reference {reference} already exists with different transaction data",
                line.row,
            )));
        }
        let mut data = Map::new();
        data.insert("statement".into(), json!(statement_id));
        data.insert("transaction_date".into(), json!(line.date));
        data.insert("reference".into(), json!(reference));
        data.insert("direction".into(), json!(line.direction));
        data.insert(
            "amount".into(),
            crate::money::json_number(line.amount).ok_or_else(|| {
                validation(format!(
                    "{row_label} amount exceeds the supported financial range"
                ))
            })?,
        );
        if let Some(description) = line.description {
            data.insert("description".into(), json!(description));
        }
        let created = kernel
            .create_in(&tx, actor, tenant, &entity, data, &Opts::top())
            .await?;
        if let Some(id) = created.get("id").and_then(Value::as_str) {
            line_ids.push(id.to_owned());
        }
        imported += 1;
    }
    tx.commit().await?;
    Ok(
        json!({ "statementId": statement_id, "imported": imported, "skipped": skipped, "lineIds": line_ids }),
    )
}
