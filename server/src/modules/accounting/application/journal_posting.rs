use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

pub(super) fn journal_line_decimal(account: Uuid, debit: Decimal, credit: Decimal) -> R<Value> {
    let (Some(debit), Some(credit)) = (money::json_number(debit), money::json_number(credit))
    else {
        return Err(crate::error::ApiError::validation(
            "accounting.journal_entry",
            vec!["Journal line exceeds the supported financial range".into()],
        ));
    };
    Ok(serde_json::json!({ "account": account, "debit": debit, "credit": credit }))
}

pub(super) fn journal_line_decimal_with_department(
    account: Uuid,
    debit: Decimal,
    credit: Decimal,
    department: Option<Uuid>,
) -> R<Value> {
    let mut line = journal_line_decimal(account, debit, credit)?;
    if let Some(department) = department {
        line["department"] = Value::String(department.to_string());
    }
    Ok(line)
}

pub(super) async fn create_posted_journal_decimal(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_id: Uuid,
    depth: u32,
    memo: &str,
    amount: Decimal,
    source: &str,
    source_id: &str,
    lines: Vec<Value>,
) -> R<()> {
    create_posted_journal_decimal_at(
        kernel, tx, tenant, event_id, depth, memo, amount, source, source_id, lines, None,
    )
    .await
}

pub(super) async fn create_posted_journal_decimal_at(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_id: Uuid,
    depth: u32,
    memo: &str,
    amount: Decimal,
    source: &str,
    source_id: &str,
    lines: Vec<Value>,
    posting_date: Option<&str>,
) -> R<()> {
    if amount <= Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            "accounting.posting",
            vec!["Journal amount must be positive".into()],
        ));
    }
    let amount = money::json_number(amount).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.posting",
            vec!["Journal amount exceeds the supported financial range".into()],
        )
    })?;
    create_posted_journal_at_value(
        kernel,
        tx,
        tenant,
        event_id,
        depth,
        memo,
        amount,
        source,
        source_id,
        lines,
        posting_date,
    )
    .await
}

pub(super) async fn create_posted_journal_at_value(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_id: Uuid,
    depth: u32,
    memo: &str,
    amount: Value,
    source: &str,
    source_id: &str,
    lines: Vec<Value>,
    posting_date: Option<&str>,
) -> R<()> {
    let entity = kernel.ent(tenant, "accounting.journal_entry")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let mut data = Map::new();
    data.insert("memo".into(), Value::String(memo.into()));
    data.insert("amount".into(), amount);
    data.insert(
        "posting_date".into(),
        Value::String(
            posting_date
                .map(str::to_owned)
                .unwrap_or_else(|| tenant.business_today().to_string()),
        ),
    );
    data.insert("source".into(), Value::String(source.into()));
    data.insert("source_id".into(), Value::String(source_id.into()));
    data.insert("lines".into(), Value::Array(lines));
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!(
            "accounting.journal-source:{}:{}:{}",
            tenant.id, source, source_id
        )],
    )
    .await?;
    if let Some(row) = tx
        .query_opt(
            "SELECT id, status FROM accounting__journal_entry WHERE tenant_id = $1 AND source = $2 AND source_id = $3 ORDER BY created_at, id LIMIT 1 FOR UPDATE",
            &[&tenant.id, &source, &source_id],
        )
        .await?
    {
        let id: Uuid = row.get(0);
        let status: String = row.get(1);
        if status == "posted" {
            return Ok(());
        }
        if status != "draft" {
            return Err(crate::error::ApiError::validation(
                "accounting.journal_entry",
                vec!["A journal entry already exists for this source in a terminal state".into()],
            ));
        }
        kernel
            .update_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id.to_string(),
                data,
                &opts,
            )
            .await?;
        kernel
            .act_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                &id.to_string(),
                "posted",
                &opts,
            )
            .await?;
        return Ok(());
    }
    let entry = kernel
        .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
        .await?;
    let entry_id = entry["id"]
        .as_str()
        .ok_or_else(|| crate::error::ApiError::internal("Created accounting journal has no id"))?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            entry_id,
            "posted",
            &opts,
        )
        .await?;
    Ok(())
}
