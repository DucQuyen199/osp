//! Payroll creation and adjustment approval checks.
use super::*;

pub(super) async fn validate_setup_records(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Option<Vec<String>>> {
    let mut errors = Vec::new();
    if entity == "payroll_run" && action == "created" {
        if let Some(period) = document.get("period").and_then(Value::as_str) {
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("payroll-calendar:{}:{period}", tenant.id)],
            )
            .await?;
            let id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .unwrap_or(Uuid::nil());
            if tx
                .query_opt(
                    "SELECT 1 FROM payroll__payroll_run WHERE tenant_id = $1 AND period = $2 AND status <> 'cancelled' AND id <> $3 LIMIT 1",
                    &[&tenant.id, &period, &id],
                )
                .await?
                .is_some()
            {
                return Ok(Some(vec!["A non-cancelled payroll run already exists for this month".into()]));
            }
        }
    }
    if entity == "payroll_adjustment" && action == "approved" {
        let Some(employee) = document
            .get("employee")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(Some(vec![
                "Payroll adjustment requires a valid employee".into(),
            ]));
        };
        let Some(period) = document.get("period").and_then(Value::as_str) else {
            return Ok(Some(vec![
                "Payroll adjustment requires a valid YYYY-MM period".into(),
            ]));
        };
        let Some(first_day) = NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d").ok()
        else {
            return Ok(Some(vec![
                "Payroll adjustment requires a valid YYYY-MM period".into(),
            ]));
        };
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&format!("payroll-calendar:{}:{period}", tenant.id)],
        )
        .await?;
        if document.get("kind").and_then(Value::as_str) == Some("deduction") {
            let Some(account) = document
                .get("account")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
            else {
                return Ok(Some(vec![
                    "Payroll deduction requires a valid accounting account".into(),
                ]));
            };
            let account_kind = tx
                .query_opt(
                    "SELECT kind FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &account],
                )
                .await?
                .map(|row| row.get::<_, String>(0));
            if !matches!(account_kind.as_deref(), Some("asset" | "liability")) {
                return Ok(Some(vec!["Payroll deduction account must be an asset or liability account in this tenant".into()]));
            }
        }
        let employee_row = tx
            .query_opt(
                "SELECT status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &employee],
            )
            .await?;
        if !employee_row.is_some_and(|row| row.get::<_, String>(0) == "active") {
            errors.push("Payroll adjustment can only be approved for an active employee".into());
        }
        let period = format!("{:04}-{:02}", first_day.year(), first_day.month());
        if tx
            .query_opt(
                "SELECT 1 FROM payroll__payslip s JOIN payroll__payroll_run r ON r.tenant_id = s.tenant_id AND r.id = s.run WHERE s.tenant_id = $1 AND s.employee = $2 AND r.period = $3 LIMIT 1",
                &[&tenant.id, &employee, &period],
            )
            .await?
            .is_some()
        {
            errors.push("Cancel the draft payroll run and recalculate before approving an adjustment for a period with payslips".into());
        }
        return Ok(Some(errors));
    }

    Ok(None)
}
