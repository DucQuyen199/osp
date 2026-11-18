use super::{camt053, csv, persistence};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::NaiveDate;
use serde_json::Value;
use uuid::Uuid;

pub async fn import_statement_csv(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    csv_text: &str,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let lines = csv::parse_csv(csv_text)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        lines,
        None,
        "CSV",
        "CSV row",
    )
    .await
}

pub async fn import_statement_camt053(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    xml_text: &str,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let parsed = camt053::parse(xml_text)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        parsed.lines,
        Some(parsed.identity),
        "CAMT053",
        "CAMT.053 entry",
    )
    .await
}

pub async fn import_statement_casso(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    payload: &Value,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let parsed = super::casso::parse(payload)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        parsed.lines,
        Some(parsed.identity),
        "CASSO",
        "Casso transaction",
    )
    .await
}

pub async fn sync_statement_casso(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    connector_id: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    kernel.ent(tenant, "integration-hub.connector")?;
    kernel.authorize(tenant, actor, "integration-hub.connector.read")?;
    let connector_id = Uuid::parse_str(connector_id).map_err(|_| {
        ApiError::validation(
            "integration-hub.connector",
            vec!["Invalid connector id".into()],
        )
    })?;

    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
    let statement = tx
        .query_opt(
            "SELECT statement.status, statement.start_date, statement.end_date, account.code, account.kind, account.casso_bank_account_id FROM accounting__bank_statement statement JOIN accounting__account account ON account.tenant_id = statement.tenant_id AND account.id = statement.account WHERE statement.tenant_id = $1 AND statement.id = $2",
            &[&tenant.id, &statement_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Bank statement not found for this tenant"))?;
    let status: String = statement.get(0);
    let start: NaiveDate = statement.get(1);
    let end: NaiveDate = statement.get(2);
    let account_code: String = statement.get(3);
    let account_kind: String = statement.get(4);
    let expected_account: Option<String> = statement.get(5);
    if status != "draft" {
        return Err(ApiError::new(
            409,
            "STATEMENT_NOT_DRAFT",
            "Only draft bank statements accept imported lines",
        ));
    }
    if account_kind != "asset"
        || !account_code
            .strip_prefix("112")
            .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(ApiError::validation(
            "accounting.bank_statement",
            vec!["Casso feed requires a bank asset account in chart group 112".into()],
        ));
    }
    let expected_account = expected_account
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::validation("accounting.account", vec!["Configure casso_bank_account_id on the ledger account linked to this statement".into()]))?;
    let parse_date = |value: Option<&str>, fallback: NaiveDate, field: &str| -> R<NaiveDate> {
        match value {
            Some(value) => NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                ApiError::validation(
                    "accounting.bank_statement",
                    vec![format!("{field} must use YYYY-MM-DD")],
                )
            }),
            None => Ok(fallback),
        }
    };
    let from = parse_date(from_date, start, "fromDate")?;
    let to = parse_date(to_date, end, "toDate")?;
    if from > to || from < start || to > end {
        return Err(ApiError::validation("accounting.bank_statement", vec!["Casso sync dates must be within the selected statement period and fromDate must not be after toDate".into()]));
    }
    let connector = tx
        .query_opt(
            "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND enabled = true",
            &[&tenant.id, &connector_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Enabled Casso connector not found for this tenant"))?;
    let config: Option<Value> = connector.get(0);
    let config = config
        .filter(|config| config.get("adapter").and_then(Value::as_str) == Some("casso_bank_feed"))
        .ok_or_else(|| {
            ApiError::validation(
                "integration-hub.connector",
                vec!["Selected connector is not a Casso bank feed".into()],
            )
        })?;
    tx.commit().await?;

    let parsed = super::casso_feed::fetch(&config, from, to, &expected_account).await?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        parsed.lines,
        Some(parsed.identity),
        "CASSO",
        "Casso transaction",
    )
    .await
}

fn authorize_import(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
) -> R<Uuid> {
    let statement_id = Uuid::parse_str(statement_id)
        .map_err(|_| ApiError::new(422, "INVALID_STATEMENT", "Invalid bank statement id"))?;
    kernel.ent(tenant, "accounting.bank_statement_line")?;
    kernel.authorize(tenant, actor, "accounting.bank_statement_line.create")?;
    Ok(statement_id)
}
