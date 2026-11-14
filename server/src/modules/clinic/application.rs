//! Derive patient identity for encounters from tenant-owned patient records.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::{Map, Value};
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity != "encounter" {
        return Ok(Vec::new());
    }
    let Some(patient) = document
        .get("patient")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Lượt khám cần hồ sơ bệnh nhân hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT party FROM clinic__patient WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &patient],
        )
        .await?
    else {
        return Ok(vec![
            "Hồ sơ bệnh nhân không tồn tại trong doanh nghiệp".into(),
        ]);
    };
    let party: Uuid = row.get(0);
    document.insert("party".into(), Value::String(party.to_string()));
    Ok(Vec::new())
}
