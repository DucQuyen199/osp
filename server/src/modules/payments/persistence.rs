use crate::{db::Tx, error::R, kernel::Tenant, money};
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
    if entity == "payment_refund"
        && matches!(action, "created" | "updated" | "succeeded" | "failed")
    {
        return validate_refund(tx, tenant, action, document).await;
    }
    if entity == "payment_txn" && action == "refunded" {
        let Some(payment_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Payment transaction id is invalid".into()]);
        };
        let original_row = tx.query_opt(
            "SELECT amount::text FROM payments__payment_txn WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &payment_id],
        ).await?;
        let Some(original_row) = original_row else {
            return Ok(vec!["Payment transaction was not found".into()]);
        };
        let original_text: String = original_row.get(0);
        let original = money::decimal_str(&original_text).ok_or_else(|| {
            crate::error::ApiError::validation(
                "payments.payment_txn",
                vec!["Stored payment amount is invalid".into()],
            )
        })?;
        let refunded_row = tx.query_one_row(
            "SELECT COALESCE(SUM(amount::numeric), 0)::text FROM payments__payment_refund WHERE tenant_id = $1 AND payment_txn = $2 AND status = 'succeeded'",
            &[&tenant.id, &payment_id],
        ).await?;
        let refunded_text: String = refunded_row.get(0);
        let refunded = money::decimal_str(&refunded_text).ok_or_else(|| {
            crate::error::ApiError::validation(
                "payments.payment_refund",
                vec!["Stored refund total is invalid".into()],
            )
        })?;
        let was_partially_refunded =
            document.get("status").and_then(Value::as_str) == Some("partially_refunded");
        if (was_partially_refunded && refunded + rust_decimal::Decimal::new(1, 6) < original)
            || (!was_partially_refunded && refunded > rust_decimal::Decimal::new(1, 6))
        {
            return Ok(vec![
                "Use successful refund records to account for the remaining refund balance".into(),
            ]);
        }
    }
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

async fn validate_refund(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(payment_id) = document
        .get("payment_txn")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Refund requires a valid payment transaction".into()]);
    };
    let Some(payment) = tx
        .query_opt(
            "SELECT provider, status, amount::text FROM payments__payment_txn WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &payment_id],
        )
        .await?
    else {
        return Ok(vec!["Payment transaction was not found in this business".into()]);
    };
    let provider: String = payment.get(0);
    let payment_status: String = payment.get(1);
    let original_text: String = payment.get(2);
    let original = money::decimal_str(&original_text).ok_or_else(|| {
        crate::error::ApiError::validation(
            "payments.payment_refund",
            vec!["Stored payment amount is not a valid decimal".into()],
        )
    })?;
    if !matches!(payment_status.as_str(), "succeeded" | "partially_refunded") {
        return Ok(vec![
            "Only a successful, not fully refunded payment can be refunded".into(),
        ]);
    }
    if !matches!(action, "created" | "updated" | "succeeded") {
        return Ok(Vec::new());
    }
    let refund_id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if action == "succeeded" {
        let Some(reference) = document
            .get("reference")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|reference| !reference.is_empty())
        else {
            return Ok(vec!["Refund requires a provider refund reference".into()]);
        };
        let lock_key = format!("payments-refund:{}:{}:{}", tenant.id, provider, reference);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT refund.id FROM payments__payment_refund refund JOIN payments__payment_txn payment ON payment.tenant_id = refund.tenant_id AND payment.id = refund.payment_txn WHERE refund.tenant_id = $1 AND payment.provider = $2 AND refund.reference = $3 AND ($4::uuid IS NULL OR refund.id <> $4) LIMIT 1",
                &[&tenant.id, &provider, &reference, &refund_id],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["This provider refund reference has already been recorded".into()]);
        }
    }
    let sum_row = tx
        .query_one_row(
            "SELECT COALESCE(SUM(amount::numeric), 0)::text FROM payments__payment_refund WHERE tenant_id = $1 AND payment_txn = $2 AND status IN ('pending', 'succeeded') AND ($3::uuid IS NULL OR id <> $3)",
            &[&tenant.id, &payment_id, &refund_id],
        )
        .await?;
    let sum_text: String = sum_row.get(0);
    let already_refunded = money::decimal_str(&sum_text).ok_or_else(|| {
        crate::error::ApiError::validation(
            "payments.payment_refund",
            vec!["Stored refund amount is not a valid decimal".into()],
        )
    })?;
    let refund_amount = document
        .get("amount")
        .and_then(money::decimal)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "payments.payment_refund",
                vec!["Refund amount is not a valid decimal".into()],
            )
        })?;
    if already_refunded
        .checked_add(refund_amount)
        .is_none_or(|total| total > original + rust_decimal::Decimal::new(1, 6))
    {
        return Ok(vec![
            "Pending and successful refunds cannot exceed the original payment".into(),
        ]);
    }
    Ok(Vec::new())
}
