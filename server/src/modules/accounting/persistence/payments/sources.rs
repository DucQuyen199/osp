use super::super::database_amount;
use super::shared::{amount, amounts_match};
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let payment_method = document.get("method").and_then(Value::as_str);
    if document.get("source").and_then(Value::as_str) == Some("expense_claim") {
        if !tenant.has_module("expense") {
            errors.push("Module chi phí chưa được bật cho doanh nghiệp".into());
            return Ok(errors);
        }
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|v| Uuid::parse_str(v).ok());
        let claim = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT total::text FROM expense__expense_claim WHERE tenant_id = $1 AND id = $2 AND status = 'paid' FOR UPDATE",
                        &[&tenant.id, &source_id],
                    )
                    .await?
        } else {
            None
        };
        let matches_claim = if let Some(row) = claim {
            let total = database_amount(&row, 0)?;
            amount(document, "amount").is_some_and(|value| amounts_match(value, total))
        } else {
            false
        };
        if !matches_claim {
            errors.push("Payment hoàn ứng phải khớp với phiếu chi đã thanh toán".into());
        } else if let Some(source_id) = source_id {
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx.query_opt(
                        "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'expense_claim' AND source_id = $2 AND id <> $3 LIMIT 1",
                        &[&tenant.id, &source_id.to_string(), &payment_id],
                    ).await?.is_some() {
                        errors.push("Phiếu chi đã có payment; không thể ghi nhận thanh toán lần hai".into());
                    }
        }
    }
    if document.get("source").and_then(Value::as_str) == Some("payroll_run") {
        if !tenant.has_module("payroll") {
            errors.push("Module tính lương chưa được bật cho doanh nghiệp".into());
            return Ok(errors);
        }
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let run = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT total_net::text FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 AND status = 'paid' FOR UPDATE",
                        &[&tenant.id, &source_id],
                    )
                    .await?
        } else {
            None
        };
        let matches_run = if let Some(row) = run {
            let total = database_amount(&row, 0)?;
            amount(document, "amount").is_some_and(|paid| amounts_match(paid, total))
        } else {
            false
        };
        if !matches_run {
            errors.push("Payment trả lương phải khớp với bảng lương đã trả".into());
        } else if let Some(source_id) = source_id {
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx.query_opt(
                        "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'payroll_run' AND source_id = $2 AND id <> $3 LIMIT 1",
                        &[&tenant.id, &source_id.to_string(), &payment_id],
                    ).await?.is_some() {
                        errors.push("Bảng lương đã có payment; không thể ghi nhận thanh toán lần hai".into());
                    }
        }
    }
    if document.get("source").and_then(Value::as_str) == Some("payroll_contribution_remittance") {
        if !tenant.has_module("payroll") {
            errors.push("Payroll must be enabled to record contribution remittances".into());
            return Ok(errors);
        }
        let source_id = document
            .get("source_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let remittance = if let Some(source_id) = source_id {
            tx.query_opt(
                        "SELECT remittance.amount::text, remittance.payment_date, remittance.payment_method, policy.liability_account FROM payroll__contribution_remittance remittance JOIN payroll__contribution_policy policy ON policy.tenant_id = remittance.tenant_id AND policy.id = remittance.policy WHERE remittance.tenant_id = $1 AND remittance.id = $2 AND remittance.status = 'paid' FOR UPDATE OF remittance",
                        &[&tenant.id, &source_id],
                    )
                    .await?
        } else {
            None
        };
        let Some(remittance) = remittance else {
            errors.push(
                "Contribution payment must reference a paid remittance in this tenant".into(),
            );
            return Ok(errors);
        };
        let expected_amount = database_amount(&remittance, 0)?;
        let expected_date: Option<chrono::NaiveDate> = remittance.get(1);
        let expected_method: Option<String> = remittance.get(2);
        let liability_account: Uuid = remittance.get(3);
        if !amount(document, "amount").is_some_and(|value| amounts_match(value, expected_amount))
            || payment_method != expected_method.as_deref()
            || document
                .get("payment_date")
                .and_then(Value::as_str)
                .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                != expected_date
        {
            errors.push(
                "Payment amount, method and date must match its approved contribution remittance"
                    .into(),
            );
        }
        if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'payroll_contribution_remittance' AND source_id = $2 AND id <> $3 LIMIT 1",
                        &[&tenant.id, &source_id.unwrap().to_string(), &document.get("id").and_then(Value::as_str).and_then(|value| Uuid::parse_str(value).ok()).unwrap_or(Uuid::nil())],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Contribution remittance already has an accounting payment".into());
                }
        if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND id = $2 AND kind = 'liability' LIMIT 1",
                        &[&tenant.id, &liability_account],
                    )
                    .await?
                    .is_none()
                {
                    errors.push("Contribution policy liability account must remain a tenant liability account".into());
                }
    }
    if let Some(source) = document.get("source").and_then(Value::as_str) {
        let source_spec = match source {
            "pos_order" => Some(("pos__pos_order", "Đơn POS")),
            "table_order" => Some(("restaurant__table_order", "order nhà hàng")),
            _ => None,
        };
        if let Some((table, label)) = source_spec {
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let Some(source_id) = source_id else {
                errors.push(format!("Payment từ {label} cần mã chứng từ nguồn hợp lệ"));
                return Ok(errors);
            };
            let sql = format!(
                "SELECT total::text, method, party, status FROM {table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE"
            );
            let order = tx.query_opt(&sql, &[&tenant.id, &source_id]).await?;
            let Some(order) = order else {
                errors.push(format!("Không tìm thấy {label} trong tenant"));
                return Ok(errors);
            };
            let total = database_amount(&order, 0)?;
            let method: Option<String> = order.get(1);
            let party: Option<Uuid> = order.get(2);
            let status: String = order.get(3);
            if status != "completed" {
                errors.push(format!("Chỉ được ghi payment cho {label} đã hoàn tất"));
            }
            if !amount(document, "amount").is_some_and(|value| amounts_match(value, total)) {
                errors.push(format!("Số tiền payment phải khớp tổng của {label}"));
            }
            if payment_method != method.as_deref() {
                errors.push(format!("Phương thức payment phải khớp với {label}"));
            }
            if document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                != party
            {
                errors.push(format!("Đối tác payment phải khớp với {label}"));
            }
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx.query_opt(
                        "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = $2 AND source_id = $3 AND id <> $4 LIMIT 1",
                        &[&tenant.id, &source, &source_id.to_string(), &payment_id],
                    ).await?.is_some() {
                        errors.push(format!("{label} đã có payment; không thể ghi nhận lần hai"));
                    }
        }
        if source == "donation" {
            if !tenant.has_module("charity") {
                errors.push("Cần bật module từ thiện để ghi nhận payment quyên góp".into());
                return Ok(errors);
            }
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let Some(source_id) = source_id else {
                errors.push("Payment quyên góp cần mã chứng từ nguồn hợp lệ".into());
                return Ok(errors);
            };
            let donation = tx
                        .query_opt(
                            "SELECT donor, amount::text, method, status FROM charity__donation WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                            &[&tenant.id, &source_id],
                        )
                        .await?;
            let Some(donation) = donation else {
                errors.push("Không tìm thấy khoản quyên góp trong doanh nghiệp".into());
                return Ok(errors);
            };
            let donor: Uuid = donation.get(0);
            let donation_amount = database_amount(&donation, 1)?;
            let donation_method: Option<String> = donation.get(2);
            let donation_status: String = donation.get(3);
            if donation_status != "received" {
                errors.push("Chỉ ghi payment cho khoản quyên góp đã nhận".into());
            }
            if !amount(document, "amount")
                .is_some_and(|value| amounts_match(value, donation_amount))
            {
                errors.push("Số tiền payment phải khớp khoản quyên góp".into());
            }
            if payment_method != donation_method.as_deref() {
                errors.push("Phương thức payment phải khớp khoản quyên góp".into());
            }
            if !matches!(
                donation_method.as_deref(),
                Some("cash" | "card" | "transfer" | "ewallet" | "bank")
            ) {
                errors.push("Khoản quyên góp cần phương thức thu tiền hợp lệ".into());
            }
            if document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                != Some(donor)
            {
                errors.push("Đối tác payment phải trùng với người quyên góp".into());
            }
            let payment_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .unwrap_or(Uuid::nil());
            if tx.query_opt(
                        "SELECT 1 FROM accounting__payment WHERE tenant_id = $1 AND source = 'donation' AND source_id = $2 AND id <> $3 LIMIT 1",
                        &[&tenant.id, &source_id.to_string(), &payment_id],
                    ).await?.is_some() {
                        errors.push("Khoản quyên góp đã có payment; không thể ghi nhận lần hai".into());
                    }
        }
    }
    Ok(errors)
}
