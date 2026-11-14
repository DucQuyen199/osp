//! Tenant-scoped payroll consistency and approval checks.
use super::application::{
    calculate_contributions, calculate_income_tax, calculate_overtime_pay,
    load_contribution_policy, load_tax_policy,
};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;
use uuid::Uuid;

#[path = "persistence/calculation.rs"]
mod calculation;
#[path = "persistence/payslips.rs"]
mod payslips;

#[path = "persistence/policy_records.rs"]
mod policy_records;
#[path = "persistence/setup_records.rs"]
mod setup_records;

fn decimal_field(document: &Value, field: &str) -> Option<Decimal> {
    money::decimal(document.get(field)?)
}

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "payroll.persistence",
            vec![format!(
                "Stored payroll {field} exceeds the supported decimal range"
            )],
        )
    })
}

fn payroll_amount_error() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "payroll.payslip",
        vec!["Calculated payroll amount exceeds the supported decimal range".into()],
    )
}

async fn counted_paid_days(
    tx: &Tx<'_>,
    tenant: &Tenant,
    employee: Uuid,
    first_day: NaiveDate,
    next_month: NaiveDate,
    hours_per_day: &str,
    working_weekdays_json: &str,
) -> R<(Decimal, Decimal)> {
    let row = tx
        .query_one_row(
            "WITH work_calendar AS ( \
               SELECT work_day.work_date::date AS work_date, CASE WHEN ws.id IS NULL THEN $6::numeric \
                 ELSE EXTRACT(EPOCH FROM (ws.end_at - ws.start_at))::numeric / 3600 - COALESCE(ws.break_minutes, 0)::numeric / 60 END AS expected_hours \
               FROM generate_series($3::date, $4::date - 1, interval '1 day') AS work_day(work_date) \
               LEFT JOIN hrm__work_schedule_entry ws ON ws.tenant_id = $1 AND ws.employee = $2 AND ws.work_date = work_day.work_date::date \
               WHERE (ws.id IS NULL AND EXTRACT(ISODOW FROM work_day.work_date)::int IN (SELECT value::int FROM jsonb_array_elements_text($5::jsonb) AS selected(value))) \
                 OR (ws.id IS NOT NULL AND ws.is_working) \
             ), counted_days AS ( \
               SELECT a.date AS work_date, LEAST(1::numeric, GREATEST(0::numeric, round( \
                 EXTRACT(EPOCH FROM (a.check_out - a.check_in))::numeric / 3600 / cal.expected_hours, 6 \
               ))) AS day_fraction FROM work_calendar cal JOIN hrm__attendance a ON a.tenant_id = $1 AND a.employee = $2 AND a.date = cal.work_date \
               JOIN hrm__employee e ON e.tenant_id = a.tenant_id AND e.id = a.employee \
               WHERE a.date >= COALESCE(e.hire_date, $3) AND a.date <= COALESCE(e.termination_date, $4 - 1) AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL \
               UNION ALL \
               SELECT leave_day.work_date::date, CASE WHEN lr.partial_day IN ('morning', 'afternoon') THEN 0.5 ELSE 1 END::numeric \
               FROM hrm__leave_request lr JOIN hrm__employee e ON e.tenant_id = lr.tenant_id AND e.id = lr.employee \
               CROSS JOIN LATERAL generate_series( \
                 GREATEST(lr.start_date, $3::date, COALESCE(e.hire_date, $3::date))::timestamp, \
                 LEAST(lr.end_date, $4::date - 1, COALESCE(e.termination_date, $4::date - 1))::timestamp, interval '1 day' \
               ) AS leave_day(work_date) \
               WHERE lr.tenant_id = $1 AND lr.employee = $2 AND lr.status = 'approved' \
                 AND COALESCE(lr.pay_treatment, CASE WHEN lr.kind = 'unpaid' THEN 'unpaid' ELSE 'paid' END) = 'paid' \
                 AND lr.start_date < $4 AND lr.end_date >= $3 AND EXISTS (SELECT 1 FROM work_calendar cal WHERE cal.work_date = leave_day.work_date::date) \
               UNION ALL \
               SELECT h.date AS work_date, 1::numeric AS day_fraction FROM hrm__holiday h \
               JOIN hrm__employee e ON e.tenant_id = h.tenant_id \
               JOIN work_calendar cal ON cal.work_date = h.date \
               WHERE h.tenant_id = $1 AND e.id = $2 AND h.date >= $3 AND h.date < $4 \
                 AND h.date >= COALESCE(e.hire_date, $3) AND h.date <= COALESCE(e.termination_date, $4 - 1) \
                 AND h.pay_treatment = 'paid' \
             ), per_day AS (SELECT work_date, LEAST(1::numeric, round(sum(day_fraction), 6)) AS day_fraction FROM counted_days GROUP BY work_date) \
             SELECT round(COALESCE((SELECT sum(day_fraction) FROM per_day), 0), 6)::text, (SELECT count(*)::text FROM work_calendar)",
            &[
                &tenant.id,
                &employee,
                &first_day,
                &next_month,
                &working_weekdays_json,
                &hours_per_day,
            ],
        )
        .await?;
    Ok((
        decimal_column(&row, 0, "paid days")?,
        decimal_column(&row, 1, "working days")?,
    ))
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    if let Some(errors) =
        policy_records::validate_policy_records(tx, tenant, entity, action, document).await?
    {
        return Ok(errors);
    }
    if let Some(errors) =
        setup_records::validate_setup_records(tx, tenant, entity, action, document).await?
    {
        return Ok(errors);
    }
    match (entity, action) {
        ("payroll_run", "calculated") => {
            return calculation::validate_calculated(tx, tenant, document).await;
        }
        ("payslip", "created") => return payslips::validate_created(tx, tenant, document).await,
        ("payroll_run", "submitted") => {
            let Some(run) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Khong xac dinh duoc bang luong can gui duyet".into()]);
            };
            // Use the same lock as payslip creation so its count cannot change
            // between submission and the state transition.
            tx.query_opt(
                "SELECT id FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &run],
            )
            .await?;
            let row = tx
                .query_one_row(
                    "SELECT count(*), COALESCE(sum(net), 0)::text FROM payroll__payslip WHERE tenant_id = $1 AND run = $2",
                    &[&tenant.id, &run],
                )
                .await?;
            let count: i64 = row.get(0);
            let sum = decimal_column(&row, 1, "payslip net total")?;
            let total = decimal_field(document, "total_net").unwrap_or(Decimal::ZERO);
            if count == 0
                || sum <= Decimal::ZERO
                || !money::within_tolerance(sum, total, Decimal::new(5, 3))
            {
                errors.push("Bang luong phai co it nhat mot phieu va tong thuc nhan duong truoc khi gui duyet".into());
            }
        }
        ("payroll_run", "approved") => {
            let Some(run) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(vec!["Không xác định được bảng lương cần duyệt".into()]);
            };
            if !tenant.has_module("accounting") {
                errors
                    .push("Phai bat module accounting de ghi nhan chi phi va cong no luong".into());
            } else {
                for code in ["642", "334"] {
                    if tx.query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    ).await?.is_none() {
                        errors.push(format!("Thieu tai khoan ke toan {code}"));
                    }
                }
            }
            if tenant.has_module("workflow-approval")
                && tx
                    .query_opt(
                        "SELECT 1 FROM workflow_approval__approval_request WHERE tenant_id = $1 AND entity = 'payroll.payroll_run' AND record_id = $2 AND status = 'approved' LIMIT 1",
                        &[&tenant.id, &run.to_string()],
                    )
                    .await?
                    .is_none()
            {
                errors.push("Chỉ được duyệt bảng lương sau khi yêu cầu phê duyệt chung đã được chấp thuận".into());
            }
            let row = tx
                .query_one_row(
                    "SELECT count(*), COALESCE(sum(net), 0)::text FROM payroll__payslip WHERE tenant_id = $1 AND run = $2",
                    &[&tenant.id, &run],
                )
                .await?;
            let count: i64 = row.get(0);
            let sum = decimal_column(&row, 1, "payslip net total")?;
            let total = decimal_field(document, "total_net").unwrap_or(Decimal::ZERO);
            if count == 0 || !money::within_tolerance(sum, total, Decimal::new(5, 3)) {
                errors.push(
                    "Tổng bảng lương phải khớp với tổng phiếu lương và có ít nhất một phiếu".into(),
                );
            }
        }
        ("payroll_run", "paid") => {
            if !tenant.has_module("accounting") {
                errors.push("Phai bat module accounting de ghi nhan payment tra luong".into());
            } else {
                let code = if document.get("payment_method").and_then(Value::as_str) == Some("bank")
                {
                    "112"
                } else {
                    "111"
                };
                if tx.query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&tenant.id, &code],
                ).await?.is_none() {
                    errors.push(format!("Thiếu tài khoản kế toán {code} để trả lương"));
                }
            }
        }
        ("payroll_run", "removed") => {
            if let Some(run) = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            {
                if tx
                    .query_opt(
                        "SELECT 1 FROM payroll__payslip WHERE tenant_id = $1 AND run = $2 LIMIT 1",
                        &[&tenant.id, &run],
                    )
                    .await?
                    .is_some()
                {
                    errors.push(
                        "Không thể xóa bảng lương còn phiếu lương; hãy giữ hồ sơ và hủy bảng nháp"
                            .into(),
                    );
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
