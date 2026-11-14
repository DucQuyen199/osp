//! Tenant-scoped project and BOQ persistence rules.
use super::{parse_id, project_row};
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub(super) async fn validate_boq(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(project) = parse_id(document, "project") else {
        return Ok(vec!["BOQ cần tham chiếu dự án hợp lệ".into()]);
    };
    let Some((status, _)) = project_row(tx, tenant, project).await? else {
        return Ok(vec![
            "Dự án của BOQ không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    if (matches!(action, "created" | "updated") && !matches!(status.as_str(), "planned" | "active"))
        || (action == "removed" && status != "planned")
    {
        return Ok(vec!["BOQ chỉ được thêm/sửa trong dự án dự kiến hoặc đang hoạt động và chỉ xóa trước khi bắt đầu".into()]);
    }
    Ok(Vec::new())
}
