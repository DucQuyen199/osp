//! Tenant-scoped beneficiary, account, and budget checks for disbursements.
use super::PaymentSourceState;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn load_payment_source(
    tx: &Tx<'_>,
    tenant: &Tenant,
    disbursement_id: Uuid,
) -> R<PaymentSourceState> {
    let row = tx
        .query_opt(
            "SELECT d.amount::text, d.method, d.expense_account, b.party FROM charity__disbursement d JOIN charity__beneficiary b ON b.tenant_id = d.tenant_id AND b.id = d.beneficiary WHERE d.tenant_id = $1 AND d.id = $2 AND d.status = 'paid' FOR UPDATE OF d",
            &[&tenant.id, &disbursement_id],
        )
        .await?
        .ok_or_else(|| {
            ApiError::validation(
                "charity.disbursement.paid",
                vec!["Paid disbursement or beneficiary was not found in this tenant".into()],
            )
        })?;
    if tx
        .query_opt(
            "SELECT id FROM accounting__payment WHERE tenant_id = $1 AND source = 'charity_disbursement' AND source_id = $2 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &disbursement_id.to_string()],
        )
        .await?
        .is_some()
    {
        return Ok(PaymentSourceState::AlreadyPosted);
    }
    let amount_text: String = row.get(0);
    let amount = money::decimal_str(&amount_text).ok_or_else(|| {
        ApiError::validation(
            "charity.disbursement.paid",
            vec!["Disbursement amount is not a valid decimal value".into()],
        )
    })?;
    if amount <= Decimal::ZERO {
        return Err(ApiError::validation(
            "charity.disbursement.paid",
            vec!["Disbursement amount must be positive".into()],
        ));
    }
    Ok(PaymentSourceState::Ready {
        amount,
        method: row.get(1),
        expense_account: row.get(2),
        party: row.get(3),
    })
}

pub(super) async fn validate_disbursement(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let program = document
        .get("program")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let beneficiary = document
        .get("beneficiary")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let expense_account = document
        .get("expense_account")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let amount = document.get("amount").and_then(money::decimal);
    let lock_program = matches!(action, "approved" | "paid");

    let budget = if let Some(program) = program {
        let lock = if lock_program {
            " FOR UPDATE"
        } else {
            " FOR SHARE"
        };
        tx.query_opt(
            &format!(
                "SELECT budget::text FROM charity__program WHERE tenant_id = $1 AND id = $2{lock}"
            ),
            &[&tenant.id, &program],
        )
        .await?
        .map(|row| row.get::<_, Option<String>>(0))
        .flatten()
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                ApiError::validation(
                    "charity.program.budget",
                    vec!["Program budget is not a valid decimal value".into()],
                )
            })
        })
        .transpose()?
    } else {
        errors.push("Disbursement requires a valid program in this tenant".into());
        None
    };
    if program.is_some()
        && tx
            .query_opt(
                "SELECT id FROM charity__program WHERE tenant_id = $1 AND id = $2 LIMIT 1",
                &[&tenant.id, &program.unwrap()],
            )
            .await?
            .is_none()
    {
        errors.push("Disbursement program was not found in this tenant".into());
    }

    match (program, beneficiary) {
        (Some(program), Some(beneficiary))
            if tx
                .query_opt(
                    "SELECT id FROM charity__beneficiary WHERE tenant_id = $1 AND id = $2 AND program = $3 FOR SHARE",
                    &[&tenant.id, &beneficiary, &program],
                )
                .await?
                .is_some() => {}
        (Some(_), Some(_)) => errors.push(
            "Disbursement beneficiary must belong to the selected program in this tenant".into(),
        ),
        _ => errors.push("Disbursement requires a valid beneficiary in this tenant".into()),
    }

    match expense_account {
        Some(account)
            if tx
                .query_opt(
                    "SELECT id FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'expense' FOR SHARE",
                    &[&tenant.id, &account],
                )
                .await?
                .is_some() => {}
        _ => errors.push("Disbursement account must be an expense account in this tenant".into()),
    }

    if lock_program
        && let (Some(program), Some(amount)) = (program, amount)
        && amount > Decimal::ZERO
    {
        let current_id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let committed_text: String = tx
            .query_one_row(
                "SELECT COALESCE(SUM(amount), 0)::text FROM charity__disbursement WHERE tenant_id = $1 AND program = $2 AND status IN ('approved', 'paid') AND ($3::uuid IS NULL OR id <> $3)",
                &[&tenant.id, &program, &current_id],
            )
            .await?
            .get(0);
        let committed = money::decimal_str(&committed_text).ok_or_else(|| {
            ApiError::validation(
                "charity.program.committed",
                vec!["Committed disbursements are not a valid decimal value".into()],
            )
        })?;
        if let Some(budget) = budget
            && committed
                .checked_add(amount)
                .and_then(|total| total.checked_sub(budget))
                .is_none_or(|excess| excess > Decimal::new(5, 3))
        {
            errors.push(format!(
                "Disbursement would exceed the program budget ({budget:.2}); already approved or paid: {committed:.2}"
            ));
        }
    }
    Ok(errors)
}
