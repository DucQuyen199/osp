//! Lending schedule creation inside the loan disbursement transaction.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::domain;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if event_type != "lending.loan.disbursed" {
        return Ok(false);
    }
    let loan_id = parse_id(document, "id")
        .ok_or_else(|| ApiError::validation(event_type, vec!["Khoản vay cần mã hợp lệ".into()]))?;
    let principal = document
        .get("principal")
        .and_then(money::decimal)
        .ok_or_else(|| {
            ApiError::validation(event_type, vec!["Khoản vay thiếu số tiền gốc".into()])
        })?;
    let rate = document
        .get("rate")
        .and_then(money::decimal)
        .ok_or_else(|| {
            ApiError::validation(event_type, vec!["Khoản vay thiếu lãi suất năm".into()])
        })?;
    let months = document
        .get("term_months")
        .and_then(money::decimal)
        .filter(|value| {
            value.fract() == Decimal::ZERO && (Decimal::ONE..=Decimal::from(600)).contains(value)
        })
        .and_then(|value| value.to_u32())
        .ok_or_else(|| {
            ApiError::validation(event_type, vec!["Kỳ hạn khoản vay không hợp lệ".into()])
        })?;
    let party = parse_id(document, "party").ok_or_else(|| {
        ApiError::validation(event_type, vec!["Khoản vay cần người vay hợp lệ".into()])
    })?;
    let installments =
        domain::installment_components(principal, rate, months).ok_or_else(|| {
            ApiError::validation(event_type, vec!["Không tính được lịch trả nợ".into()])
        })?;

    let existing: Vec<Option<i32>> = tx
        .query(
            "SELECT installment_no::int FROM lending__repayment WHERE tenant_id = $1 AND loan = $2 ORDER BY installment_no FOR UPDATE",
            &[&tenant.id, &loan_id],
        )
        .await?
        .into_iter()
        .map(|row| row.get(0))
        .collect();
    let complete_schedule = existing.len() == months as usize
        && existing
            .iter()
            .enumerate()
            .all(|(index, sequence)| *sequence == Some(index as i32 + 1));
    if complete_schedule {
        return Ok(true);
    }
    if !existing.is_empty() {
        return Err(ApiError::validation(
            event_type,
            vec!["Lịch trả nợ hiện có không đầy đủ; cần đối soát trước khi giải ngân lại".into()],
        ));
    }

    let dates = document
        .get("first_due_date")
        .and_then(Value::as_str)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .and_then(|first_due_date| domain::due_dates_from_first(first_due_date, months))
        // Older loan records predate contractual first due dates. Keep those
        // disbursements working with the former one-month-from-disbursement rule.
        .or_else(|| domain::due_dates(tenant.business_today(), months))
        .ok_or_else(|| ApiError::internal("Could not calculate monthly due dates"))?;
    let entity = kernel.ent(tenant, "lending.repayment")?;
    for (index, ((amount, principal_component, interest_component), due_date)) in
        installments.into_iter().zip(dates).enumerate()
    {
        let mut data = Map::new();
        data.insert("loan".into(), json!(loan_id));
        data.insert("party".into(), json!(party));
        data.insert(
            "amount".into(),
            money::json_number(amount).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Installment exceeds the supported decimal range".into()],
                )
            })?,
        );
        data.insert(
            "principal_component".into(),
            money::json_number(principal_component).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Principal installment exceeds the supported decimal range".into()],
                )
            })?,
        );
        data.insert(
            "interest_component".into(),
            money::json_number(interest_component).ok_or_else(|| {
                ApiError::validation(
                    event_type,
                    vec!["Interest installment exceeds the supported decimal range".into()],
                )
            })?,
        );
        data.insert("legacy_schedule".into(), json!(false));
        data.insert("installment_no".into(), json!(index + 1));
        data.insert(
            "due_date".into(),
            json!(due_date.format("%Y-%m-%d").to_string()),
        );
        kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &entity,
                data,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
    }
    Ok(true)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
