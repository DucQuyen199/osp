//! Tenant-scoped subcontract progress claim and cumulative value checks.
use super::parse_id;
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use serde_json::Value;

pub(super) async fn validate_claim(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(subcontract) = parse_id(document, "subcontract") else {
        return Ok(vec!["Hồ sơ nghiệm thu cần hợp đồng thầu phụ hợp lệ".into()]);
    };
    let Some(vendor) = parse_id(document, "vendor") else {
        return Ok(vec!["Hồ sơ nghiệm thu cần nhà thầu hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT vendor, value::text, status FROM construction__subcontract WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &subcontract],
    ).await? else {
        return Ok(vec!["Hợp đồng thầu phụ không tồn tại trong doanh nghiệp".into()]);
    };
    let contract_vendor: uuid::Uuid = row.get(0);
    let contract_value: String = row.get(1);
    let contract_status: String = row.get(2);
    let mut errors = Vec::new();
    if !matches!(contract_status.as_str(), "signed" | "completed") {
        errors.push("Chỉ lập hồ sơ trên hợp đồng thầu phụ đã ký".into());
    }
    if contract_vendor != vendor {
        errors.push("Nhà thầu trên hồ sơ phải trùng với hợp đồng".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            &[&tenant.id, &vendor],
        )
        .await?
        .is_none()
    {
        errors.push("Nhà thầu không tồn tại trong doanh nghiệp".into());
    }
    if action == "approved" {
        let contract_value = money::decimal_str(&contract_value).ok_or_else(|| {
            ApiError::validation(
                "construction.subcontract.value",
                vec!["Giá trị hợp đồng không hợp lệ".into()],
            )
        })?;
        let claim_id = parse_id(document, "id");
        let approved_text: String = tx.query_one_row(
            "SELECT COALESCE(sum(amount),0)::text FROM construction__progress_claim WHERE tenant_id=$1 AND subcontract=$2 AND status='approved' AND ($3::uuid IS NULL OR id<>$3)",
            &[&tenant.id, &subcontract, &claim_id],
        ).await?.get(0);
        let approved = money::decimal_str(&approved_text).ok_or_else(|| {
            ApiError::validation(
                "construction.progress_claim.approved_total",
                vec!["Tổng nghiệm thu đã duyệt không hợp lệ".into()],
            )
        })?;
        let amount = document
            .get("amount")
            .and_then(money::decimal)
            .ok_or_else(|| {
                ApiError::validation(
                    "construction.progress_claim.amount",
                    vec!["Giá trị nghiệm thu không hợp lệ".into()],
                )
            })?;
        let total = approved.checked_add(amount).ok_or_else(|| {
            ApiError::validation(
                "construction.progress_claim.amount",
                vec!["Tổng giá trị nghiệm thu vượt giới hạn".into()],
            )
        })?;
        if total > contract_value {
            errors.push(format!(
                "Lũy kế hồ sơ được duyệt vượt giá trị hợp đồng ({contract_value:.2})"
            ));
        }
    }
    Ok(errors)
}
