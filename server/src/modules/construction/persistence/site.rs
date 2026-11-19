//! Tenant-scoped site and immutable diary-history checks.
use super::{parse_id, project_row};
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub(super) async fn validate_site(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let id = parse_id(document, "id");
    let project = parse_id(document, "project");
    let mut errors = Vec::new();
    if let Some(project) = project {
        match project_row(tx, tenant, project).await? {
            None => errors.push("Dự án công trường không tồn tại trong doanh nghiệp".into()),
            Some((status, _))
                if matches!(action, "created" | "updated")
                    && !matches!(status.as_str(), "planned" | "active") =>
            {
                errors
                    .push("Chỉ quản lý công trường trong dự án dự kiến hoặc đang hoạt động".into());
            }
            _ => {}
        }
    }
    let name = document
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let normalized_name: String = tx
        .query_opt("SELECT lower(btrim($1::text))", &[&name])
        .await?
        .ok_or_else(|| {
            crate::error::ApiError::internal("Unable to normalize construction site name")
        })?
        .get(0);
    let project_scope = project
        .map(|project| project.to_string())
        .unwrap_or_else(|| "unassigned".into());
    let lock_key = format!(
        "construction.site-name:{}:{}:{}",
        tenant.id, project_scope, normalized_name
    );
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    if tx.query_opt(
        "SELECT id FROM construction__site WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND project IS NOT DISTINCT FROM $3::uuid AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &name, &project, &id],
    ).await?.is_some() {
        errors.push("Tên công trường đã tồn tại trong cùng dự án".into());
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM construction__site_diary WHERE tenant_id = $1 AND site = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Công trường đã có nhật ký nên không thể xóa".into());
            }
        }
    }
    if action == "updated" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM construction__site_diary WHERE tenant_id = $1 AND site = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                if let Some(old) = tx.query_opt(
                    "SELECT project FROM construction__site WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                ).await? {
                    let old_project: Option<Uuid> = old.get(0);
                    if project != old_project {
                        errors.push("Không thể chuyển công trường sang dự án khác sau khi đã ghi nhật ký".into());
                    }
                }
            }
        }
    }
    Ok(errors)
}

pub(super) async fn validate_diary(
    tx: &Tx<'_>,
    tenant: &Tenant,
    _action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(site) = parse_id(document, "site") else {
        return Ok(vec!["Nhật ký cần công trường hợp lệ".into()]);
    };
    let Some(date) = document.get("date").and_then(Value::as_str) else {
        return Ok(vec!["Nhật ký cần ngày ghi nhận hợp lệ".into()]);
    };
    let Some(site_row) = tx.query_opt(
        "SELECT s.project, p.status FROM construction__site s LEFT JOIN project__project p ON p.tenant_id = s.tenant_id AND p.id = s.project WHERE s.tenant_id = $1 AND s.id = $2 FOR SHARE OF s",
        &[&tenant.id, &site],
    ).await? else {
        return Ok(vec!["Công trường không tồn tại trong doanh nghiệp".into()]);
    };
    let site_project: Option<Uuid> = site_row.get(0);
    let project_status: Option<String> = site_row.get(1);
    if site_project.is_some() && !matches!(project_status.as_deref(), Some("planned" | "active")) {
        return Ok(vec![
            "Không thể ghi nhật ký mới cho công trường thuộc dự án đã đóng".into(),
        ]);
    }
    let id = parse_id(document, "id");
    if tx.query_opt(
        "SELECT id FROM construction__site_diary WHERE tenant_id = $1 AND site = $2 AND date = $3::text::date AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &site, &date, &id],
    ).await?.is_some() {
        return Ok(vec!["Mỗi công trường chỉ có một nhật ký mỗi ngày".into()]);
    }
    Ok(Vec::new())
}
