//! Tenant-scoped subcontract validation and project budget locking.
use super::{parse_id, project_row};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;

pub(super) async fn validate_subcontract(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(project) = parse_id(document, "project") else {
        return Ok(vec!["Hợp đồng thầu phụ cần dự án hợp lệ".into()]);
    };
    let Some(vendor) = parse_id(document, "vendor") else {
        return Ok(vec!["Hợp đồng thầu phụ cần nhà cung cấp hợp lệ".into()]);
    };
    let mut errors = Vec::new();
    let Some((project_status, budget)) = project_row(tx, tenant, project).await? else {
        return Ok(vec![
            "Dự án của hợp đồng không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    if !matches!(project_status.as_str(), "planned" | "active")
        && matches!(action, "created" | "updated" | "signed")
    {
        errors.push("Chỉ được tạo hoặc ký hợp đồng trong dự án dự kiến/đang hoạt động".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &vendor],
        )
        .await?
        .is_none()
    {
        errors.push("Nhà thầu phụ không tồn tại trong doanh nghiệp".into());
    }
    if action == "signed" {
        if project_status != "active" {
            errors.push("Chỉ ký hợp đồng trong dự án đang hoạt động".into());
        }
        if let Some(budget) = budget.filter(|budget| *budget >= Decimal::ZERO) {
            let id = parse_id(document, "id");
            let committed_text: String = tx.query_one_row(
                "SELECT COALESCE(sum(value), 0)::text FROM construction__subcontract WHERE tenant_id = $1 AND project = $2 AND status IN ('signed', 'completed') AND ($3::uuid IS NULL OR id <> $3)",
                &[&tenant.id, &project, &id],
            ).await?.get(0);
            let committed = money::decimal_str(&committed_text).ok_or_else(|| {
                ApiError::validation(
                    "construction.subcontract.committed",
                    vec!["Committed subcontract total is not a valid decimal value".into()],
                )
            })?;
            let amount = document
                .get("value")
                .and_then(money::decimal)
                .ok_or_else(|| {
                    ApiError::validation(
                        "construction.subcontract.value",
                        vec!["Subcontract value is not a valid decimal value".into()],
                    )
                })?;
            let committed_total = committed.checked_add(amount).ok_or_else(|| {
                ApiError::validation(
                    "construction.subcontract.committed",
                    vec!["Committed subcontract total exceeds the supported decimal range".into()],
                )
            })?;
            let budget_limit = budget.checked_add(Decimal::new(5, 3)).ok_or_else(|| {
                ApiError::validation(
                    "construction.project.budget",
                    vec!["Project budget exceeds the supported decimal range".into()],
                )
            })?;
            if committed_total > budget_limit {
                errors.push(format!(
                    "Tổng hợp đồng thầu phụ vượt ngân sách dự án ({budget:.2})"
                ));
            }
        }
    }
    if action == "completed" && !matches!(project_status.as_str(), "active" | "done") {
        errors.push("Không thể hoàn tất thầu phụ khi dự án đã hủy hoặc chưa bắt đầu".into());
    }
    Ok(errors)
}
