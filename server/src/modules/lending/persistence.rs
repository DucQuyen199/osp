//! Tenant-scoped loan ownership, amortization, and repayment controls.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;
use uuid::Uuid;

use super::domain;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "lending.persistence",
            vec![format!("Stored loan {field} is not a valid decimal")],
        )
    })
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "loan" => validate_loan(tx, tenant, action, document).await,
        "repayment" => validate_repayment(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_loan(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let party = parse_id(document, "party");
    if let Some(party) = party {
        if tx
            .query_opt(
                "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &party],
            )
            .await?
            .is_none()
        {
            errors.push("Người vay không tồn tại trong doanh nghiệp".into());
        }
    } else {
        errors.push("Người vay phải là mã hợp lệ".into());
    }

    if matches!(action, "closed" | "defaulted") {
        let Some(loan_id) = parse_id(document, "id") else {
            return Ok(vec!["Không xác định được khoản vay".into()]);
        };
        let row = tx
            .query_opt(
                "SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE status <> 'paid')::int, COUNT(*) FILTER (WHERE status = 'overdue')::int FROM lending__repayment WHERE tenant_id = $1 AND loan = $2",
                &[&tenant.id, &loan_id],
            )
            .await?;
        let (count, unpaid, overdue) = row
            .map(|row| {
                (
                    row.get::<_, i32>(0),
                    row.get::<_, i32>(1),
                    row.get::<_, i32>(2),
                )
            })
            .unwrap_or_default();
        let loan_term = document
            .get("term_months")
            .and_then(money::decimal)
            .filter(|value| value.fract() == Decimal::ZERO)
            .and_then(|value| value.to_i32())
            .unwrap_or_default();
        match action {
            "closed" if count != loan_term || unpaid > 0 => {
                errors.push("Chỉ đóng khoản vay khi toàn bộ lịch trả nợ đã được thanh toán".into());
            }
            "defaulted" if overdue == 0 => {
                errors.push(
                    "Chỉ chuyển khoản vay sang nợ xấu khi có ít nhất một kỳ quá hạn chưa trả"
                        .into(),
                );
            }
            _ => {}
        }
    }
    Ok(errors)
}

async fn validate_repayment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(loan_id) = parse_id(document, "loan") else {
        return Ok(vec!["Kỳ trả nợ cần khoản vay hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT party, principal::text, rate::text, term_months::text, status FROM lending__loan WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &loan_id],
        )
        .await?
    else {
        return Ok(vec!["Khoản vay không tồn tại trong doanh nghiệp".into()]);
    };
    let loan_party: Uuid = row.get(0);
    let principal = decimal_column(&row, 1, "principal")?;
    let rate = decimal_column(&row, 2, "annual rate")?;
    let term = decimal_column(&row, 3, "term")?;
    let loan_status: String = row.get(4);
    let mut errors = Vec::new();
    if parse_id(document, "party") != Some(loan_party) {
        errors.push("Người trả nợ phải trùng người vay trên khoản vay".into());
    }
    if action == "created" && loan_status != "disbursed" {
        errors.push("Chỉ tạo lịch trả nợ cho khoản vay đã giải ngân".into());
    }
    if matches!(action, "paid" | "overdue")
        && !matches!(loan_status.as_str(), "disbursed" | "defaulted")
    {
        errors.push("Kỳ trả nợ chỉ được xử lý khi khoản vay đã giải ngân và chưa đóng".into());
    }
    if action == "paid" && loan_status == "closed" {
        errors.push("Không thể thu tiền cho khoản vay đã đóng".into());
    }

    let sequence = document
        .get("installment_no")
        .and_then(money::decimal)
        .filter(|value| value.fract() == Decimal::ZERO)
        .and_then(|value| value.to_u32());
    let legacy = document.get("legacy_schedule").and_then(Value::as_bool) == Some(true);
    let months =
        if term.fract() == Decimal::ZERO && (Decimal::ONE..=Decimal::from(600)).contains(&term) {
            term.to_u32().unwrap_or_default()
        } else {
            0
        };
    let Some(sequence) =
        sequence.filter(|sequence| *sequence >= 1 && (legacy || *sequence <= months))
    else {
        errors.push("Số thứ tự kỳ trả nợ nằm ngoài lịch khoản vay".into());
        return Ok(errors);
    };
    let expected = domain::installment_components(principal, rate, months)
        .and_then(|amounts| amounts.get((sequence - 1) as usize).copied());
    let amount = document.get("amount").and_then(money::decimal);
    let principal_component = document.get("principal_component").and_then(money::decimal);
    let interest_component = document.get("interest_component").and_then(money::decimal);
    let components_match = if legacy {
        amount
            .zip(principal_component.zip(interest_component))
            .is_some_and(|(amount, (principal, interest))| {
                principal
                    .checked_add(interest)
                    .is_some_and(|total| money::within_tolerance(amount, total, Decimal::new(5, 3)))
            })
    } else {
        expected
            .zip(amount)
            .zip(principal_component.zip(interest_component))
            .is_some_and(
                |(
                    ((expected_amount, expected_principal, expected_interest), actual_amount),
                    (actual_principal, actual_interest),
                )| {
                    money::within_tolerance(expected_amount, actual_amount, Decimal::new(5, 3))
                        && money::within_tolerance(
                            expected_principal,
                            actual_principal,
                            Decimal::new(5, 3),
                        )
                        && money::within_tolerance(
                            expected_interest,
                            actual_interest,
                            Decimal::new(5, 3),
                        )
                },
            )
    };
    if !components_match {
        errors.push("Số tiền kỳ trả phải khớp lịch khấu hao khoản vay đã duyệt".into());
    }

    let repayment_id = parse_id(document, "id");
    let sequence_number = sequence.to_string();
    if tx
        .query_opt(
            "SELECT id FROM lending__repayment WHERE tenant_id = $1 AND loan = $2 AND installment_no::numeric = $3::text::numeric AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &loan_id, &sequence_number, &repayment_id],
        )
        .await?
        .is_some()
    {
        errors.push("Số thứ tự kỳ trả đã tồn tại trong lịch khoản vay".into());
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
