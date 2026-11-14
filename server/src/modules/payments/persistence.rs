use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

/// Enforce provider idempotency under a transaction-scoped advisory lock.
pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "payment_txn" && action == "succeeded" {
        let party = document
            .get("party")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let invoice = document
            .get("invoice")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let bill = document
            .get("bill")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let linked = match (party, invoice, bill) {
            (Some(party), Some(invoice), None) => Some((
                party,
                invoice,
                "accounting__invoice",
                "party",
                "hóa đơn bán",
            )),
            (Some(party), None, Some(bill)) => {
                Some((party, bill, "accounting__bill", "supplier", "hóa đơn mua"))
            }
            _ => None,
        };
        let Some((party, document_id, table, party_column, label)) = linked else {
            return Ok(vec![
                "Giao dịch cần đúng một hóa đơn và đối tác hợp lệ".into(),
            ]);
        };
        let sql = format!(
            "SELECT {party_column} FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"
        );
        let owner = tx.query_opt(&sql, &[&tenant.id, &document_id]).await?;
        if !owner.is_some_and(|row| row.get::<_, Uuid>(0) == party) {
            return Ok(vec![format!(
                "{label} không tồn tại trong doanh nghiệp hoặc không thuộc đúng đối tác"
            )]);
        }
    }
    if entity != "payment_txn" || !matches!(action, "created" | "updated" | "succeeded") {
        return Ok(Vec::new());
    }
    let (Some(provider), Some(reference)) = (
        document.get("provider").and_then(Value::as_str),
        document
            .get("reference")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|reference| !reference.is_empty()),
    ) else {
        return Ok(Vec::new());
    };
    let key = format!("payments:{}:{}:{}", tenant.id, provider, reference);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&key],
    )
    .await?;
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let duplicate = if let Some(id) = id {
        tx.query_opt(
            "SELECT id FROM payments__payment_txn WHERE tenant_id = $1 AND provider = $2 AND reference = $3 AND id <> $4 LIMIT 1",
            &[&tenant.id, &provider, &reference, &id],
        )
        .await?
    } else {
        tx.query_opt(
            "SELECT id FROM payments__payment_txn WHERE tenant_id = $1 AND provider = $2 AND reference = $3 LIMIT 1",
            &[&tenant.id, &provider, &reference],
        )
        .await?
    };
    Ok(if duplicate.is_some() {
        vec!["Mã tham chiếu này đã được ghi nhận cho nhà cung cấp trong doanh nghiệp".into()]
    } else {
        Vec::new()
    })
}
