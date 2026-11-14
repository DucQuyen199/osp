use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub(super) async fn account_id(tx: &Tx<'_>, tenant: &Tenant, code: &str) -> R<Uuid> {
    tx.query_opt(
        "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = $2",
        &[&tenant.id, &code],
    )
    .await?
    .map(|row| row.get(0))
    .ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.posting",
            vec![format!("Required accounting account {code} is missing")],
        )
    })
}

pub(in crate::modules::accounting) async fn ensure_account(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    code: &str,
    name: &str,
    kind: &str,
) -> R<Uuid> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("{}:account:{code}", tenant.id)],
    )
    .await?;
    if let Some(row) = tx
        .query_opt(
            "SELECT id, kind FROM accounting__account WHERE tenant_id = $1 AND code = $2 FOR UPDATE",
            &[&tenant.id, &code],
        )
        .await?
    {
        let account_id: Uuid = row.get(0);
        let existing_kind: String = row.get(1);
        if existing_kind != kind {
            return Err(crate::error::ApiError::validation(
                "accounting.account",
                vec![format!("Account {code} must have kind {kind}")],
            ));
        }
        return Ok(account_id);
    }
    let entity = kernel.ent(tenant, "accounting.account")?;
    let mut data = Map::new();
    data.insert("code".into(), Value::String(code.into()));
    data.insert("name".into(), Value::String(name.into()));
    data.insert("kind".into(), Value::String(kind.into()));
    let created = kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &Opts::silent_top(),
        )
        .await?;
    created["id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| crate::error::ApiError::internal("Created account has no valid id"))
}

pub(super) async fn tax_payable_account_id(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
) -> R<Uuid> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!("{}:account:3331", tenant.id)],
    )
    .await?;
    if let Some(row) = tx
        .query_opt(
            "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = '3331'",
            &[&tenant.id],
        )
        .await?
    {
        return Ok(row.get(0));
    }
    let entity = kernel.ent(tenant, "accounting.account")?;
    let mut data = Map::new();
    data.insert("code".into(), Value::String("3331".into()));
    data.insert(
        "name".into(),
        Value::String("Thuế giá trị gia tăng phải nộp".into()),
    );
    data.insert("kind".into(), Value::String("liability".into()));
    let account = kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &Opts::silent_top(),
        )
        .await?;
    account["id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            crate::error::ApiError::internal("Created tax payable account has no valid id")
        })
}
