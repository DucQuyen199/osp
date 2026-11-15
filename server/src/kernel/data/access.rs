use super::shared::*;

impl Kernel {
    // ───────────────────── Chuyển đổi bản ghi <-> hàng DB ─────────────────────

    /// JSON để nạp vào bảng bằng jsonb_populate_record: cột đúng kiểu + custom (trường mở rộng).
    pub(super) fn db_object(&self, t: &Tenant, ent: &Ent, rec: &Obj) -> Value {
        let mut o = serde_json::Map::new();
        o.insert("tenant_id".into(), json!(t.id));
        o.insert("id".into(), rec["id"].clone());
        o.insert("created_at".into(), rec["createdAt"].clone());
        o.insert("updated_at".into(), rec["updatedAt"].clone());
        let mut custom = serde_json::Map::new();
        for (k, v) in rec {
            if ["id", "createdAt", "updatedAt"].contains(&k.as_str()) {
                continue;
            }
            if ent.is_typed(k) {
                o.insert(k.clone(), v.clone());
            } else {
                custom.insert(k.clone(), v.clone());
            }
        }
        o.insert("custom".into(), Value::Object(custom));
        Value::Object(o)
    }

    pub(crate) async fn get_row(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        qname: &str,
        id: &str,
    ) -> R<Option<Obj>> {
        let Ok(uid) = Uuid::parse_str(id) else {
            return Ok(None);
        };
        let row = tx
            .query_opt(&self.sql_for(qname).select_one, &[&t.id, &uid])
            .await?;
        Ok(row.and_then(|r| match normalize_row(r.get::<_, Value>(0)) {
            Value::Object(o) => Some(o),
            _ => None,
        }))
    }

    // ───────────────────── Điểm vào công khai (mở giao dịch) ─────────────────────

    pub async fn create(&self, actor: &Actor, t: &Tenant, qname: &str, data: Obj) -> R<Value> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.create"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let out = self
            .create_in(&tx, actor, t, &ent, data, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(crate::modules::integration_hub::redact_document(
            qname.strip_prefix("integration-hub.").unwrap_or_default(),
            out,
        ))
    }

    pub async fn update(
        &self,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        id: &str,
        patch: Obj,
    ) -> R<Value> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.update"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let out = self
            .update_in(&tx, actor, t, &ent, id, patch, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(crate::modules::integration_hub::redact_document(
            qname.strip_prefix("integration-hub.").unwrap_or_default(),
            out,
        ))
    }

    pub async fn act(
        &self,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        id: &str,
        action: &str,
    ) -> R<Value> {
        let ent = self.ent(t, qname)?;
        let tr = ent.def.states.as_ref().and_then(|s| s.actions.get(action));
        if tr.is_none() {
            return Err(ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            ));
        }
        self.authorize(t, actor, &format!("{qname}.{action}"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let out = self
            .act_in(&tx, actor, t, &ent, id, action, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(crate::modules::integration_hub::redact_document(
            qname.strip_prefix("integration-hub.").unwrap_or_default(),
            out,
        ))
    }

    pub async fn update_and_act(
        &self,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        id: &str,
        action: &str,
        patch: Obj,
    ) -> R<Value> {
        let ent = self.ent(t, qname)?;
        if !ent
            .def
            .states
            .as_ref()
            .is_some_and(|states| states.actions.contains_key(action))
        {
            return Err(ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            ));
        }
        self.authorize(t, actor, &format!("{qname}.update"))?;
        self.authorize(t, actor, &format!("{qname}.{action}"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        self.update_in(&tx, actor, t, &ent, id, patch, &Opts::top())
            .await?;
        let out = self
            .act_in(&tx, actor, t, &ent, id, action, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(crate::modules::integration_hub::redact_document(
            qname.strip_prefix("integration-hub.").unwrap_or_default(),
            out,
        ))
    }

    pub async fn remove(&self, actor: &Actor, t: &Tenant, qname: &str, id: &str) -> R<()> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.delete"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        self.remove_in(&tx, actor, t, &ent, id, &Opts::top())
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn get(&self, actor: &Actor, t: &Tenant, qname: &str, id: &str) -> R<Value> {
        self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.read"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        self.get_row(&tx, t, qname, id)
            .await?
            .map(|document| {
                crate::modules::integration_hub::redact_document(
                    qname.strip_prefix("integration-hub.").unwrap_or_default(),
                    Value::Object(document),
                )
            })
            .ok_or_else(|| ApiError::not_found(format!("Không tìm thấy {qname} {id}")))
    }
}
