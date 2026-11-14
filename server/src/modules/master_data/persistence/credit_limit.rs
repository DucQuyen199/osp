//! Credit exposure validation against posted tenant receivables.
use super::parse_id;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) async fn validate_credit_limit(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
    errors: &mut Vec<String>,
) -> R<()> {
    if action != "updated"
        || document.get("credit_limit").is_none_or(Value::is_null)
        || !tenant.has_module("accounting")
    {
        return Ok(());
    }
    let Some(party_id) = parse_id(document, "id") else {
        errors.push("Cannot identify the party to validate its credit exposure".into());
        return Ok(());
    };
    let credit_limit = document
        .get("credit_limit")
        .and_then(money::decimal)
        .unwrap_or_default();
    let outstanding_text: String = tx
        .query_opt(
            "SELECT COALESCE(SUM(GREATEST(COALESCE(i.base_total, i.total) - COALESCE((SELECT SUM(COALESCE(p.applied_base_amount, p.amount)) FROM accounting__payment p WHERE p.tenant_id = i.tenant_id AND p.invoice = i.id), 0) - COALESCE((SELECT SUM(COALESCE(c.base_total, c.total)) FROM accounting__credit_note c WHERE c.tenant_id = i.tenant_id AND c.invoice = i.id AND c.status = 'posted'), 0), 0)), 0)::text FROM accounting__invoice i WHERE i.tenant_id = $1 AND i.party = $2 AND i.status NOT IN ('draft', 'void')",
            &[&tenant.id, &party_id],
        )
        .await?
        .map(|row| row.get(0))
        .unwrap_or_else(|| "0".into());
    let outstanding = money::decimal_str(&outstanding_text)
        .ok_or_else(|| ApiError::internal("invalid outstanding receivable amount"))?;
    if credit_limit
        .checked_add(Decimal::new(5, 3))
        .is_some_and(|limit_with_tolerance| limit_with_tolerance < outstanding)
    {
        errors.push(format!(
            "Credit limit cannot be reduced to {credit_limit:.2}; current receivables are {outstanding:.2}"
        ));
    }
    Ok(())
}
