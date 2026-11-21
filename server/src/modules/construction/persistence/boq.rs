//! Tenant-scoped project, BOQ revision, and baseline approval rules.
use super::{parse_id, project_row};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate_boq(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(project) = parse_id(document, "project") else {
        return Ok(vec!["BOQ cần tham chiếu dự án hợp lệ".into()]);
    };
    let Some((project_status, _)) = project_row(tx, tenant, project).await? else {
        return Ok(vec![
            "Dự án của BOQ không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    if matches!(action, "created" | "updated" | "approved")
        && !matches!(project_status.as_str(), "planned" | "active")
        || action == "removed" && project_status != "planned"
    {
        return Ok(vec![
            "BOQ chỉ được lập trong dự án dự kiến hoặc đang hoạt động và chỉ xóa trước khi bắt đầu"
                .into(),
        ]);
    }

    let Some(revision) = document
        .get("revision")
        .and_then(money::decimal)
        .filter(|value| {
            *value >= Decimal::ONE
                && value.fract() == Decimal::ZERO
                && *value <= Decimal::from(1000)
        })
    else {
        return Ok(vec!["BOQ cần số phiên bản nguyên dương".into()]);
    };
    let revision_text = revision.to_string();
    let id = parse_id(document, "id");
    let parent_id = parse_id(document, "supersedes");
    let current_status = document
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("draft");
    let mut errors = Vec::new();

    if action == "created" && current_status != "draft" {
        errors.push("BOQ mới phải bắt đầu ở trạng thái nháp".into());
    }
    if matches!(action, "created" | "updated") {
        if tx.query_opt(
            "SELECT id FROM construction__boq WHERE tenant_id=$1 AND project=$2 AND revision::numeric=$3::text::numeric AND ($4::uuid IS NULL OR id<>$4) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &project, &revision_text, &id],
        ).await?.is_some() {
            errors.push("Số phiên bản BOQ đã tồn tại trong công trình".into());
        }
        if tx.query_opt(
            "SELECT id FROM construction__boq WHERE tenant_id=$1 AND project=$2 AND status='draft' AND ($3::uuid IS NULL OR id<>$3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &project, &id],
        ).await?.is_some() {
            errors.push("Mỗi công trình chỉ có một bản BOQ điều chỉnh đang nháp".into());
        }
    }

    if action == "created" {
        match parent_id {
            None if revision != Decimal::ONE => {
                errors.push("BOQ gốc phải có phiên bản 1".into());
            }
            Some(parent) => {
                let prior = tx.query_opt(
                    "SELECT project, revision::text, status FROM construction__boq WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                    &[&tenant.id, &parent],
                ).await?;
                match prior {
                    Some(row) => {
                        let prior_project: Uuid = row.get(0);
                        let prior_revision: String = row.get(1);
                        let prior_status: String = row.get(2);
                        let expected =
                            money::decimal_str(&prior_revision).unwrap_or_default() + Decimal::ONE;
                        if prior_project != project
                            || prior_status != "approved"
                            || expected != revision
                        {
                            errors.push(
                                "Phiên bản điều chỉnh phải kế tiếp BOQ đang duyệt cùng công trình"
                                    .into(),
                            );
                        }
                    }
                    None => {
                        errors.push("BOQ gốc điều chỉnh không tồn tại trong doanh nghiệp".into())
                    }
                }
            }
            _ => {}
        }
    }

    if action == "approved" {
        let approved = tx.query_opt(
            "SELECT id FROM construction__boq WHERE tenant_id=$1 AND project=$2 AND status='approved' AND ($3::uuid IS NULL OR id<>$3) ORDER BY revision::numeric DESC LIMIT 1 FOR UPDATE",
            &[&tenant.id, &project, &id],
        ).await?;
        match (parent_id, approved) {
            (None, None) if revision == Decimal::ONE => {}
            (Some(parent), Some(row)) if row.get::<_, Uuid>(0) == parent => {}
            _ => errors.push(
                "Chỉ duyệt BOQ gốc đầu tiên hoặc phiên bản kế tiếp baseline hiện hành".into(),
            ),
        }
    }

    if action == "superseded" {
        let Some(current_id) = id else {
            return Ok(vec!["Không xác định được BOQ cần thay thế".into()]);
        };
        if tx.query_opt(
            "SELECT id FROM construction__boq WHERE tenant_id=$1 AND project=$2 AND supersedes=$3 AND status='approved' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &project, &current_id],
        ).await?.is_none() {
            errors.push("Chỉ thay thế BOQ sau khi phiên bản kế tiếp đã được duyệt".into());
        }
    }

    if matches!(action, "created" | "updated" | "approved")
        && let Some(items) = document.get("items").and_then(Value::as_array)
    {
        for item in items {
            let product_value = item.get("product").filter(|value| !value.is_null());
            let uom_value = item.get("uom").filter(|value| !value.is_null());
            if product_value.is_none() && uom_value.is_none() {
                continue;
            }
            let label = "Dòng vật tư BOQ";
            let Some(product_id) = product_value
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                errors.push(format!("{label} cần sản phẩm hợp lệ trong doanh nghiệp"));
                continue;
            };
            let Some(uom_id) = uom_value
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                errors.push(format!("{label} cần đơn vị đo hợp lệ"));
                continue;
            };
            let product = tx
                .query_opt(
                    "SELECT uom, active, kind FROM master_data__product WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                    &[&tenant.id, &product_id],
                )
                .await?;
            let Some(product) = product else {
                errors.push(format!(
                    "{label} có sản phẩm không tồn tại trong doanh nghiệp"
                ));
                continue;
            };
            if product.get::<_, Option<bool>>(1) == Some(false) {
                errors.push(format!("{label} có sản phẩm không hoạt động"));
            }
            let product_kind: Option<String> = product.get(2);
            if product_kind.as_deref().is_some_and(|kind| kind != "goods") {
                errors.push(format!("{label} chỉ được liên kết với sản phẩm hàng hóa"));
                continue;
            }
            let product_base_uom: Option<Uuid> = product.get(0);
            let Some(product_base_uom) = product_base_uom else {
                errors.push(format!("{label} sản phẩm chưa khai báo đơn vị gốc"));
                continue;
            };
            let unit = tx
                .query_opt(
                    "SELECT base_uom, ratio::text FROM master_data__uom WHERE tenant_id=$1 AND id=$2 FOR SHARE",
                    &[&tenant.id, &uom_id],
                )
                .await?;
            let Some(unit) = unit else {
                errors.push(format!(
                    "{label} có đơn vị không tồn tại trong doanh nghiệp"
                ));
                continue;
            };
            let base_uom: Option<Uuid> = unit.get(0);
            let root_uom = base_uom.unwrap_or(uom_id);
            let ratio_text: Option<String> = unit.get(1);
            let ratio_is_positive = match (base_uom, ratio_text.as_deref()) {
                (None, _) => true,
                (Some(_), Some(text)) => {
                    money::decimal_str(text).is_some_and(|ratio| ratio > Decimal::ZERO)
                }
                (Some(_), None) => false,
            };
            if root_uom != product_base_uom || !ratio_is_positive {
                errors.push(format!(
                    "{label} đơn vị phải quy đổi về đơn vị gốc của sản phẩm"
                ));
            }
        }
    }
    Ok(errors)
}
