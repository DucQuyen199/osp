use super::super::shared::*;
use std::collections::HashSet;

impl Kernel {
    /// Apply one state transition to a bounded set of records atomically.
    pub async fn act_bulk(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        qname: &str,
        action: &str,
        ids: Vec<String>,
    ) -> R<Value> {
        const MAX_BULK_RECORDS: usize = 100;

        if ids.is_empty() || ids.len() > MAX_BULK_RECORDS {
            return Err(ApiError::new(
                422,
                "INVALID_BULK_SIZE",
                format!("Chọn từ 1 đến {MAX_BULK_RECORDS} bản ghi"),
            ));
        }

        let mut unique = HashSet::with_capacity(ids.len());
        for id in &ids {
            let canonical_id = Uuid::parse_str(id)
                .map_err(|_| ApiError::new(422, "INVALID_ID", format!("ID không hợp lệ: {id}")))?;
            if !unique.insert(canonical_id) {
                return Err(ApiError::new(
                    422,
                    "DUPLICATE_ID",
                    "Danh sách không được chứa ID trùng lặp",
                ));
            }
        }

        let ent = self.ent(tenant, qname)?;
        let states = ent.def.states.as_ref().ok_or_else(|| {
            ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            )
        })?;
        if !states.actions.contains_key(action) {
            return Err(ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            ));
        }
        self.authorize(tenant, actor, &format!("{qname}.{action}"))?;

        // Stable lock order prevents two overlapping batches from deadlocking.
        let mut ordered_ids = ids;
        ordered_ids.sort_unstable();

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let mut records = Vec::with_capacity(ordered_ids.len());
        for id in &ordered_ids {
            records.push(
                self.act_in(&tx, actor, tenant, &ent, id, action, &Opts::top())
                    .await?,
            );
        }
        tx.commit().await?;

        Ok(json!({ "action": action, "count": records.len(), "items": records }))
    }
}
