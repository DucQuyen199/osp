//! Holiday calendar and department hierarchy persistence rules.
use crate::{db::Tx, error::R, kernel::Tenant};
use chrono::{Datelike, NaiveDate};
use serde_json::Value;

pub(super) async fn validate(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "holiday" && matches!(action, "created" | "updated" | "removed") {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
            .unwrap_or(uuid::Uuid::nil());
        let old_date = if action == "updated" || action == "removed" {
            tx.query_opt(
                "SELECT date FROM hrm__holiday WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &id],
            )
            .await?
            .map(|row| row.get::<_, NaiveDate>(0))
        } else {
            None
        };
        let new_date = if action == "removed" {
            None
        } else {
            document
                .get("date")
                .and_then(Value::as_str)
                .and_then(|value| {
                    NaiveDate::parse_from_str(value.get(..10).unwrap_or(""), "%Y-%m-%d").ok()
                })
        };
        if action != "removed" && new_date.is_none() {
            return Ok(vec!["Ngày lễ cần ngày hợp lệ".into()]);
        }
        let periods: std::collections::BTreeSet<String> = old_date
            .into_iter()
            .chain(new_date)
            .map(|date| format!("{:04}-{:02}", date.year(), date.month()))
            .collect();
        for period in &periods {
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&format!("payroll-calendar:{}:{period}", tenant.id)],
            )
            .await?;
        }
        for period in &periods {
            if tx
                .query_opt(
                    "SELECT 1 FROM payroll__payslip p JOIN payroll__payroll_run r ON r.tenant_id = p.tenant_id AND r.id = p.run WHERE p.tenant_id = $1 AND r.period = $2 LIMIT 1",
                    &[&tenant.id, period],
                )
                .await?
                .is_some()
            {
                return Ok(vec![format!("Không thể thay đổi ngày lễ trong kỳ {period} đã có phiếu lương")]);
            }
        }
        if let Some(date) = new_date
            && tx
                .query_opt(
                    "SELECT 1 FROM hrm__holiday WHERE tenant_id = $1 AND date = $2 AND id <> $3 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &date, &id],
                )
                .await?
                .is_some()
        {
            return Ok(vec!["Doanh nghiệp đã có ngày lễ khai báo cho ngày này".into()]);
        }
        return Ok(Vec::new());
    }
    if entity == "department" && matches!(action, "created" | "updated") {
        let Some(parent) = document
            .get("parent_department")
            .and_then(Value::as_str)
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
        else {
            return Ok(Vec::new());
        };
        let lock_key = format!("hrm:department-tree:{}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| uuid::Uuid::parse_str(value).ok());
        if id == Some(parent) {
            return Ok(vec!["Phòng ban không thể là cấp trên của chính nó".into()]);
        }
        if tx
            .query_opt(
                "SELECT 1 FROM hrm__department WHERE tenant_id = $1 AND id = $2 LIMIT 1",
                &[&tenant.id, &parent],
            )
            .await?
            .is_none()
        {
            return Ok(vec![
                "Phòng ban cấp trên không thuộc doanh nghiệp này".into(),
            ]);
        }
        if let Some(id) = id {
            let cycle = tx
                .query_opt(
                    "WITH RECURSIVE ancestors(id) AS (SELECT $2::uuid UNION SELECT d.parent_department FROM hrm__department d JOIN ancestors a ON d.id = a.id WHERE d.tenant_id = $1 AND d.parent_department IS NOT NULL) SELECT 1 FROM ancestors WHERE id = $3 LIMIT 1",
                    &[&tenant.id, &parent, &id],
                )
                .await?
                .is_some();
            if cycle {
                return Ok(vec![
                    "Không thể chuyển phòng ban vào nhánh con của chính nó".into(),
                ]);
            }
        }
        return Ok(Vec::new());
    }
    if entity == "department" && action == "removed" {
        let id = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| uuid::Uuid::parse_str(value).ok());
        if let Some(id) = id {
            let selector = serde_json::json!([{ "department": id.to_string() }]);
            if tx
                .query_opt(
                    "SELECT 1 FROM (SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1 AND lines @> $2 UNION ALL SELECT 1 FROM hrm__department WHERE tenant_id = $1 AND parent_department = $3 UNION ALL SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND department = $3 UNION ALL SELECT 1 FROM hrm__position WHERE tenant_id = $1 AND department = $3) used_by LIMIT 1",
                    &[&tenant.id, &selector, &id],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Department referenced by an employee, position, child department, or accounting journal must be retained".into(),
                ]);
            }
        }
        return Ok(Vec::new());
    }
    Ok(Vec::new())
}
