//! Project-like charity program budget guard.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate_program(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(program_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Updated charity program requires a valid id".into()]);
    };
    // Serialize budget changes with approvals/payments, which lock this same
    // program row before checking the committed disbursement total.
    if tx
        .query_opt(
            "SELECT id FROM charity__program WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &program_id],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Charity program was not found in this tenant".into()]);
    }
    let committed_text: String = tx
        .query_one_row(
            "SELECT COALESCE(SUM(amount), 0)::text FROM charity__disbursement WHERE tenant_id = $1 AND program = $2 AND status IN ('approved', 'paid')",
            &[&tenant.id, &program_id],
        )
        .await?
        .get(0);
    let committed = money::decimal_str(&committed_text).ok_or_else(|| {
        ApiError::validation(
            "charity.program.committed",
            vec!["Committed disbursements are not a valid decimal value".into()],
        )
    })?;
    if let Some(budget) = document.get("budget").and_then(money::decimal)
        && committed
            .checked_sub(budget)
            .is_some_and(|excess| excess > Decimal::new(5, 3))
    {
        return Ok(vec![format!(
            "Program budget cannot be reduced below its approved and paid disbursements ({committed:.2})"
        )]);
    }
    Ok(Vec::new())
}
