//! Payroll event orchestration.
#[path = "application/calculation.rs"]
mod calculation;
#[path = "application/contributions.rs"]
mod contributions;
#[path = "application/overtime.rs"]
mod overtime;
#[path = "application/tax.rs"]
mod tax;
use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use calculation::calculate_from_attendance;
use chrono::{Datelike, NaiveDate};
pub(super) use contributions::{calculate_contributions, load_contribution_policy};
pub(super) use overtime::calculate_overtime_pay;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
pub(super) use tax::{calculate_income_tax, load_tax_policy};
use uuid::Uuid;

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if handle_hrm_source_change(tx, tenant, event_type, document).await? {
        return Ok(true);
    }
    if event_type == "payroll.payroll_run.calculated" {
        return calculate_from_attendance(kernel, tx, tenant, document, event_id, depth).await;
    }
    if event_type != "payroll.payslip.created" {
        return Ok(false);
    }
    let Some(run_id) = document
        .get("run")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(false);
    };
    let Some(net) = document.get("net").and_then(money::decimal) else {
        return Ok(false);
    };
    let Some(run) = tx
        .query_opt(
            "SELECT id, COALESCE(total_net, 0)::text FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &run_id],
        )
        .await?
    else {
        return Ok(false);
    };
    let run_id: Uuid = run.get(0);
    let current_text: String = run.get(1);
    let Some(current) = money::decimal_str(&current_text) else {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec!["Stored payroll run total is not a valid decimal amount".into()],
        ));
    };
    let Some(total_net) = current.checked_add(net).and_then(money::json_number) else {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec!["Payroll net total exceeds supported financial limits".into()],
        ));
    };
    let entity = kernel.ent(tenant, "payroll.payroll_run")?;
    let mut patch = Map::new();
    patch.insert("total_net".into(), total_net);
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &run_id.to_string(),
            patch,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

async fn handle_hrm_source_change(
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
) -> R<bool> {
    let relevant = matches!(
        event_type,
        "hrm.attendance.created"
            | "hrm.attendance.updated"
            | "hrm.attendance.removed"
            | "hrm.leave_request.approved"
            | "hrm.employee.created"
            | "hrm.employee.updated"
            | "hrm.employee.terminated"
    );
    if !relevant {
        return Ok(false);
    }
    if !tenant.has_module("payroll") {
        return Ok(true);
    }
    let employee = document
        .get("employee")
        .or_else(|| document.get("id"))
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let employee = match employee {
        Some(employee) => employee,
        None => return Ok(true),
    };

    let blocked = match event_type {
        "hrm.attendance.created" | "hrm.attendance.updated" | "hrm.attendance.removed" => {
            let Some(month) = document
                .get("date")
                .and_then(Value::as_str)
                .and_then(|date| {
                    NaiveDate::parse_from_str(date.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
                })
                .map(|date| date.format("%Y-%m").to_string())
            else {
                return Ok(true);
            };
            tx.query_opt(
                "SELECT 1 FROM payroll__payroll_run r WHERE r.tenant_id = $1 AND r.period = $2 AND r.status = 'draft' AND EXISTS (SELECT 1 FROM payroll__payslip s WHERE s.tenant_id = r.tenant_id AND s.run = r.id) LIMIT 1",
                &[&tenant.id, &month],
            )
            .await?
            .is_some()
        }
        "hrm.leave_request.approved" => {
            let parse = |field: &str| {
                document
                    .get(field)
                    .and_then(Value::as_str)
                    .and_then(|date| {
                        NaiveDate::parse_from_str(date.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
                    })
            };
            let (Some(start), Some(end)) = (parse("start_date"), parse("end_date")) else {
                return Ok(true);
            };
            tx.query_opt(
                "SELECT 1 FROM payroll__payroll_run r WHERE r.tenant_id = $1 AND r.period BETWEEN $2 AND $3 AND r.status = 'draft' AND EXISTS (SELECT 1 FROM payroll__payslip s WHERE s.tenant_id = r.tenant_id AND s.run = r.id) LIMIT 1",
                &[&tenant.id, &start.format("%Y-%m").to_string(), &end.format("%Y-%m").to_string()],
            )
            .await?
            .is_some()
        }
        "hrm.employee.created" => {
            let month = document
                .get("hire_date")
                .and_then(Value::as_str)
                .and_then(|date| {
                    NaiveDate::parse_from_str(date.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
                })
                .unwrap_or_else(|| tenant.business_today())
                .format("%Y-%m")
                .to_string();
            tx.query_opt(
                "SELECT 1 FROM payroll__payroll_run r WHERE r.tenant_id = $1 AND r.period = $2 AND r.status = 'draft' AND EXISTS (SELECT 1 FROM payroll__payslip s WHERE s.tenant_id = r.tenant_id AND s.run = r.id) LIMIT 1",
                &[&tenant.id, &month],
            )
            .await?
            .is_some()
        }
        "hrm.employee.updated" | "hrm.employee.terminated" => {
            let draft_payslip = tx
                .query_opt(
                    "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = $2 AND r.status = 'draft' LIMIT 1",
                    &[&tenant.id, &employee],
                )
                .await?
                .is_some();
            let invalid_overtime = tx
                .query_opt(
                    "SELECT 1 FROM payroll__overtime_entry o JOIN hrm__employee e ON e.tenant_id = o.tenant_id AND e.id = o.employee WHERE o.tenant_id = $1 AND o.employee = $2 AND o.status IN ('submitted', 'approved') AND ((e.hire_date IS NOT NULL AND o.date < e.hire_date) OR (e.termination_date IS NOT NULL AND o.date > e.termination_date)) LIMIT 1",
                    &[&tenant.id, &employee],
                )
                .await?
                .is_some();
            draft_payslip || invalid_overtime
        }
        _ => false,
    };
    if blocked {
        return Err(crate::error::ApiError::validation(
            "payroll.payroll_run",
            vec!["Không thể thay đổi dữ liệu nhân sự trong kỳ khi bảng lương đã tính còn ở trạng thái nháp; hãy hủy bảng nháp và tính lại".into()],
        ));
    }
    Ok(true)
}
