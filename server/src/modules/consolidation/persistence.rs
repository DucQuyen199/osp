//! Tenant-scoped existence checks and concurrency locks for group membership.

use crate::{db::Tx, error::R};
use uuid::Uuid;

pub(super) async fn lock_group(tx: &Tx<'_>, tenant_id: &str, group_id: Uuid) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT id FROM consolidation__company_group WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            &[&tenant_id, &group_id],
        )
        .await?
        .is_some())
}

pub(super) async fn has_open_membership(
    tx: &Tx<'_>,
    tenant_id: &str,
    group_id: Uuid,
    member_tenant_id: &str,
) -> R<bool> {
    Ok(tx
        .query_opt(
            "SELECT id FROM consolidation__member WHERE tenant_id=$1 AND \"group\"=$2 AND member_tenant_id=$3 AND status IN ('invited','active') LIMIT 1",
            &[&tenant_id, &group_id, &member_tenant_id],
        )
        .await?
        .is_some())
}
