use super::{camt053, csv, ofx, persistence};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::NaiveDate;
use serde_json::{Value, json};
use url::Url;
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

pub async fn import_statement_ofx(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    ofx_text: &str,
) -> R<Value> {
    let statement_id = authorize_import(kernel, actor, tenant, statement_id)?;
    let parsed = ofx::parse(ofx_text)?;
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        parsed.lines,
        Some(parsed.identity),
        "OFX",
        "OFX transaction",
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
    if parsed.lines.iter().any(|line| line.currency.is_none()) {
        return Err(ApiError::validation(
            "accounting.bank_statement_line",
            vec!["Casso payload does not include currency. Use a Casso connector with currency_code configured, or include currency on every transaction.".into()],
        ));
    }
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
    sync_statement_feed(
        kernel,
        actor,
        tenant,
        statement_id,
        connector_id,
        from_date,
        to_date,
        "casso_bank_feed",
        "casso",
    )
    .await
}

pub async fn sync_statement_sepay(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    connector_id: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> R<Value> {
    sync_statement_feed(
        kernel,
        actor,
        tenant,
        statement_id,
        connector_id,
        from_date,
        to_date,
        "sepay_bank_feed",
        "sepay",
    )
    .await
}

pub async fn sync_statement_plaid(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    connector_id: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> R<Value> {
    sync_statement_feed(
        kernel,
        actor,
        tenant,
        statement_id,
        connector_id,
        from_date,
        to_date,
        "plaid_bank_feed",
        "plaid",
    )
    .await
}

pub async fn sync_statement_salt_edge(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    connector_id: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> R<Value> {
    sync_statement_feed(
        kernel,
        actor,
        tenant,
        statement_id,
        connector_id,
        from_date,
        to_date,
        "salt_edge_bank_feed",
        "salt_edge",
    )
    .await
}

pub async fn create_salt_edge_connect_url(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
    return_to: &str,
) -> R<Value> {
    let connector_id = authorize_salt_edge_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    validate_salt_edge_return_url(return_to)?;
    let mut config = read_salt_edge_config(kernel, tenant, connector_id, true).await?;
    if config
        .get("connection_id")
        .and_then(Value::as_str)
        .is_some()
    {
        return Err(ApiError::new(
            409,
            "BANK_PROVIDER_ALREADY_LINKED",
            "This Salt Edge connector is already linked",
        ));
    }
    if config.get("customer_id").and_then(Value::as_str).is_none() {
        let customer_identifier = format!("osp-{}-{}", tenant.id, connector_id);
        let customer_id =
            super::salt_edge_feed::create_customer(&config, &customer_identifier).await?;
        let mut conn = kernel.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let updated = tx.execute(
            "UPDATE integration_hub__connector SET config = jsonb_set(config, '{customer_id}', to_jsonb($3::text), true), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND enabled = true AND config->>'adapter' = 'salt_edge_bank_feed' AND COALESCE(config->>'customer_id', '') = ''",
            &[&tenant.id, &connector_id, &customer_id],
        ).await?;
        if updated != 1 {
            return Err(ApiError::new(
                409,
                "CONNECTOR_CHANGED_DURING_LINK",
                "The Salt Edge connector changed while preparing the connection; refresh and try again",
            ));
        }
        kernel
            .audit(
                &tx,
                tenant,
                actor,
                "integration-hub.connector.salt_edge_customer_created",
                &connector_id.to_string(),
                None,
            )
            .await?;
        tx.commit().await?;
        config["customer_id"] = json!(customer_id);
    }
    let to = chrono::Utc::now().date_naive();
    let from = to - chrono::Duration::days(90);
    let connect_url =
        super::salt_edge_feed::create_connect_url(&config, return_to, from, to).await?;
    Ok(json!({ "connectUrl": connect_url }))
}

pub async fn complete_salt_edge_link(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
    connection_id: &str,
) -> R<Value> {
    let connector_id = authorize_salt_edge_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    if connection_id.trim().is_empty()
        || connection_id.len() > 32
        || !connection_id.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ApiError::validation(
            "integration-hub.connector",
            vec!["Salt Edge connection_id is invalid".into()],
        ));
    }
    let config = read_salt_edge_config(kernel, tenant, connector_id, true).await?;
    if let Some(existing) = config.get("connection_id").and_then(Value::as_str) {
        if existing == connection_id {
            return Ok(json!({ "connectionId": existing, "linked": true }));
        }
        return Err(ApiError::new(
            409,
            "BANK_PROVIDER_ALREADY_LINKED",
            "This Salt Edge connector is already linked",
        ));
    }
    super::salt_edge_feed::verify_connection(&config, connection_id).await?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let updated = tx.execute(
        "UPDATE integration_hub__connector SET config = jsonb_set(config, '{connection_id}', to_jsonb($3::text), true), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND enabled = true AND config->>'adapter' = 'salt_edge_bank_feed' AND COALESCE(config->>'connection_id', '') = ''",
        &[&tenant.id, &connector_id, &connection_id],
    ).await?;
    if updated != 1 {
        return Err(ApiError::new(
            409,
            "CONNECTOR_CHANGED_DURING_LINK",
            "The Salt Edge connector changed while the bank was being linked; refresh and try again",
        ));
    }
    kernel
        .audit(
            &tx,
            tenant,
            actor,
            "integration-hub.connector.salt_edge_linked",
            &connector_id.to_string(),
            Some(format!("Salt Edge connection {connection_id} linked")),
        )
        .await?;
    tx.commit().await?;
    Ok(json!({ "connectionId": connection_id, "linked": true }))
}

pub async fn list_salt_edge_accounts(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Value> {
    let connector_id = authorize_salt_edge_connector(kernel, actor, tenant, connector_id).await?;
    let config = read_salt_edge_config(kernel, tenant, connector_id, true).await?;
    super::salt_edge_feed::list_accounts(&config).await
}

pub async fn disconnect_salt_edge(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Value> {
    let connector_id = authorize_salt_edge_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    let config = read_salt_edge_config(kernel, tenant, connector_id, false).await?;
    if config
        .get("connection_id")
        .and_then(Value::as_str)
        .is_none()
    {
        return Ok(json!({ "disconnected": true }));
    }
    super::salt_edge_feed::remove_connection(&config).await?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let updated = tx.execute(
        "UPDATE integration_hub__connector SET config = config - 'connection_id', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND config->>'adapter' = 'salt_edge_bank_feed'",
        &[&tenant.id, &connector_id],
    ).await?;
    if updated != 1 {
        return Err(ApiError::new(
            409,
            "CONNECTOR_CHANGED_DURING_DISCONNECT",
            "The Salt Edge connector changed while disconnecting; refresh to confirm its state",
        ));
    }
    kernel
        .audit(
            &tx,
            tenant,
            actor,
            "integration-hub.connector.salt_edge_disconnected",
            &connector_id.to_string(),
            None,
        )
        .await?;
    tx.commit().await?;
    Ok(json!({ "disconnected": true }))
}

async fn authorize_salt_edge_connector(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Uuid> {
    kernel.ent(tenant, "integration-hub.connector")?;
    kernel.authorize(tenant, actor, "integration-hub.connector.read")?;
    Uuid::parse_str(connector_id).map_err(|_| {
        ApiError::validation(
            "integration-hub.connector",
            vec!["Invalid connector id".into()],
        )
    })
}

async fn read_salt_edge_config(
    kernel: &Kernel,
    tenant: &Tenant,
    connector_id: Uuid,
    require_enabled: bool,
) -> R<Value> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
    let row = tx.query_opt(
        "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND ($3 = false OR enabled = true)",
        &[&tenant.id, &connector_id, &require_enabled],
    ).await?.ok_or_else(|| ApiError::not_found("Enabled Salt Edge connector not found for this tenant"))?;
    let config: Option<Value> = row.get(0);
    let config = config
        .filter(|value| value.get("adapter").and_then(Value::as_str) == Some("salt_edge_bank_feed"))
        .ok_or_else(|| {
            ApiError::validation(
                "integration-hub.connector",
                vec!["Selected connector is not a Salt Edge bank feed".into()],
            )
        })?;
    tx.commit().await?;
    Ok(config)
}

fn validate_salt_edge_return_url(return_to: &str) -> R<()> {
    let configured = std::env::var("OSP_PUBLIC_URL").unwrap_or_default();
    let public = Url::parse(&configured).map_err(|_| {
        ApiError::validation(
            "integration-hub.connector",
            vec!["Server must configure OSP_PUBLIC_URL before starting Salt Edge Connect".into()],
        )
    })?;
    let candidate = Url::parse(return_to).map_err(|_| {
        ApiError::validation(
            "integration-hub.connector",
            vec!["returnTo must be an absolute URL".into()],
        )
    })?;
    let same_origin = public.scheme() == "https"
        && candidate.scheme() == "https"
        && public.host_str() == candidate.host_str()
        && public.port_or_known_default() == candidate.port_or_known_default()
        && candidate.username().is_empty()
        && candidate.password().is_none()
        && candidate.fragment().is_none();
    if !same_origin || return_to.len() > 2048 {
        return Err(ApiError::validation("integration-hub.connector", vec!["Salt Edge returnTo must use the HTTPS OSP_PUBLIC_URL origin and cannot contain credentials".into()]));
    }
    Ok(())
}

pub async fn create_plaid_link_token(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Value> {
    let connector_id = authorize_plaid_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    let config = read_connector_config(kernel, tenant, connector_id, true).await?;
    if config.get("item_id").and_then(Value::as_str).is_some() {
        return Err(ApiError::new(
            409,
            "BANK_PROVIDER_ALREADY_LINKED",
            "This Plaid connector is already linked; create a new connector to link another bank Item",
        ));
    }
    let client_user_id = format!("{}:{}", tenant.id, actor.user_id());
    let link_token = super::plaid_feed::create_link_token(&config, &client_user_id).await?;
    Ok(json!({ "linkToken": link_token }))
}

pub async fn list_plaid_accounts(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Value> {
    let connector_id = authorize_plaid_connector(kernel, actor, tenant, connector_id).await?;
    let config = read_connector_config(kernel, tenant, connector_id, true).await?;
    super::plaid_feed::list_accounts(&config).await
}

pub async fn disconnect_plaid(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Value> {
    let connector_id = authorize_plaid_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    let config = read_connector_config(kernel, tenant, connector_id, false).await?;
    if config.get("access_token").and_then(Value::as_str).is_none() {
        return Ok(json!({ "disconnected": true }));
    }
    super::plaid_feed::remove_item(&config).await?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let updated = tx
        .execute(
            "UPDATE integration_hub__connector SET config = config - 'access_token' - 'item_id', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND config->>'adapter' = 'plaid_bank_feed'",
            &[&tenant.id, &connector_id],
        )
        .await?;
    if updated != 1 {
        return Err(ApiError::new(
            409,
            "CONNECTOR_CHANGED_DURING_DISCONNECT",
            "The Plaid connector changed while disconnecting; refresh to confirm its state",
        ));
    }
    kernel
        .audit(
            &tx,
            tenant,
            actor,
            "integration-hub.connector.plaid_disconnected",
            &connector_id.to_string(),
            None,
        )
        .await?;
    tx.commit().await?;
    Ok(json!({ "disconnected": true }))
}

pub async fn complete_plaid_link(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
    public_token: &str,
) -> R<Value> {
    let connector_id = authorize_plaid_connector(kernel, actor, tenant, connector_id).await?;
    kernel.authorize(tenant, actor, "integration-hub.connector.update")?;
    if public_token.trim().is_empty()
        || public_token.len() > 2048
        || public_token.chars().any(char::is_control)
    {
        return Err(ApiError::validation(
            "integration-hub.connector",
            vec!["Plaid public_token is invalid".into()],
        ));
    }
    let config = read_connector_config(kernel, tenant, connector_id, true).await?;
    if config.get("access_token").and_then(Value::as_str).is_some() {
        return Err(ApiError::new(
            409,
            "BANK_PROVIDER_ALREADY_LINKED",
            "This Plaid connector is already linked",
        ));
    }
    let (access_token, item_id) =
        super::plaid_feed::exchange_public_token(&config, public_token).await?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let updated = tx
        .execute(
            "UPDATE integration_hub__connector SET config = jsonb_set(jsonb_set(config, '{access_token}', to_jsonb($3::text), true), '{item_id}', to_jsonb($4::text), true), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND enabled = true AND config->>'adapter' = 'plaid_bank_feed' AND COALESCE(config->>'access_token', '') = ''",
            &[&tenant.id, &connector_id, &access_token, &item_id],
        )
        .await?;
    if updated != 1 {
        return Err(ApiError::new(
            409,
            "CONNECTOR_CHANGED_DURING_LINK",
            "The Plaid connector changed while the bank was being linked; refresh and try again",
        ));
    }
    kernel
        .audit(
            &tx,
            tenant,
            actor,
            "integration-hub.connector.plaid_linked",
            &connector_id.to_string(),
            Some(format!("Plaid Item {item_id} linked")),
        )
        .await?;
    tx.commit().await?;
    Ok(json!({ "itemId": item_id, "linked": true }))
}

async fn authorize_plaid_connector(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    connector_id: &str,
) -> R<Uuid> {
    kernel.ent(tenant, "integration-hub.connector")?;
    kernel.authorize(tenant, actor, "integration-hub.connector.read")?;
    Uuid::parse_str(connector_id).map_err(|_| {
        ApiError::validation(
            "integration-hub.connector",
            vec!["Invalid connector id".into()],
        )
    })
}

async fn read_connector_config(
    kernel: &Kernel,
    tenant: &Tenant,
    connector_id: Uuid,
    require_enabled: bool,
) -> R<Value> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
    let row = tx
        .query_opt(
            "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND ($3 = false OR enabled = true)",
            &[&tenant.id, &connector_id, &require_enabled],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Enabled Plaid connector not found for this tenant"))?;
    let config: Option<Value> = row.get(0);
    let config = config
        .filter(|value| value.get("adapter").and_then(Value::as_str) == Some("plaid_bank_feed"))
        .ok_or_else(|| {
            ApiError::validation(
                "integration-hub.connector",
                vec!["Selected connector is not a Plaid bank feed".into()],
            )
        })?;
    tx.commit().await?;
    Ok(config)
}

async fn sync_statement_feed(
    kernel: &Kernel,
    actor: &Actor,
    tenant: &Tenant,
    statement_id: &str,
    connector_id: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
    adapter: &'static str,
    provider: &'static str,
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
            "SELECT statement.status, statement.start_date, statement.end_date, account.code, account.kind, account.bank_account_id, account.casso_bank_account_id FROM accounting__bank_statement statement JOIN accounting__account account ON account.tenant_id = statement.tenant_id AND account.id = statement.account WHERE statement.tenant_id = $1 AND statement.id = $2",
            &[&tenant.id, &statement_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("Bank statement not found for this tenant"))?;
    let status: String = statement.get(0);
    let start: NaiveDate = statement.get(1);
    let end: NaiveDate = statement.get(2);
    let account_code: String = statement.get(3);
    let account_kind: String = statement.get(4);
    let expected_account: Option<String> = if provider == "casso" {
        statement.get(6)
    } else {
        statement.get(5)
    };
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
            vec![format!(
                "{provider} feed requires a bank asset account in chart group 112"
            )],
        ));
    }
    let expected_account = expected_account
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::validation("accounting.account", vec![if provider == "casso" { "Configure casso_bank_account_id on the ledger account linked to this statement" } else { "Configure bank_account_id on the ledger account linked to this statement" }.into()]))?;
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
        return Err(ApiError::validation(
            "accounting.bank_statement",
            vec![format!(
                "{provider} sync dates must be within the selected statement period and fromDate must not be after toDate"
            )],
        ));
    }
    let connector = tx
        .query_opt(
            "SELECT config FROM integration_hub__connector WHERE tenant_id = $1 AND id = $2 AND enabled = true",
            &[&tenant.id, &connector_id],
        )
        .await?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Enabled {provider} connector not found for this tenant"
            ))
        })?;
    let config: Option<Value> = connector.get(0);
    let config = config
        .filter(|config| config.get("adapter").and_then(Value::as_str) == Some(adapter))
        .ok_or_else(|| {
            ApiError::validation(
                "integration-hub.connector",
                vec![format!("Selected connector is not a {provider} bank feed")],
            )
        })?;
    tx.commit().await?;

    let mut parsed = match provider {
        "casso" => super::casso_feed::fetch(&config, from, to, &expected_account).await?,
        "sepay" => super::sepay_feed::fetch(&config, from, to, &expected_account).await?,
        "salt_edge" => super::salt_edge_feed::fetch(&config, from, to, &expected_account).await?,
        _ => super::plaid_feed::fetch(&config, from, to, &expected_account).await?,
    };
    if matches!(provider, "casso" | "sepay") {
        let currency = configured_bank_feed_currency(&config, provider)?;
        for line in &mut parsed.lines {
            line.currency = Some(currency.clone());
        }
    }
    persistence::import_lines(
        kernel,
        actor,
        tenant,
        statement_id,
        parsed.lines,
        Some(parsed.identity),
        match provider {
            "casso" => "CASSO",
            "sepay" => "SEPAY",
            "salt_edge" => "SALTEDGE",
            _ => "PLAID",
        },
        match provider {
            "casso" => "Casso transaction",
            "sepay" => "SePay transaction",
            "salt_edge" => "Salt Edge transaction",
            _ => "Plaid transaction",
        },
    )
    .await
}

pub(super) fn configured_bank_feed_currency(config: &Value, provider: &str) -> R<String> {
    let currency = config
        .get("currency_code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|currency| {
            currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_alphabetic())
        })
        .ok_or_else(|| {
            ApiError::validation(
                "integration-hub.connector",
                vec![format!(
                    "Configure a valid ISO currency_code on the {provider} connector"
                )],
            )
        })?;
    Ok(currency.to_ascii_uppercase())
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
