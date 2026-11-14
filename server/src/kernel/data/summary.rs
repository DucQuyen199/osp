use super::shared::*;

impl Kernel {
    pub async fn summary(&self, actor: &Actor, t: &Tenant) -> R<Value> {
        let quote = crate::schema::quote;
        let mut parts = Vec::new();
        for id in &t.modules {
            let Some(m) = self.reg.modules.get(id) else {
                continue;
            };
            for e in &m.entities {
                let q = format!("{}.{}", m.id, e.name);
                if self.can(t, actor, &format!("{q}.read")) {
                    parts.push(format!(
                        "SELECT '{q}' AS q, count(*) AS n FROM {} WHERE tenant_id = $1",
                        quote(&crate::defs::table_name(&m.id, &e.name))
                    ));
                }
            }
        }
        let mut out = serde_json::Map::new();
        if parts.is_empty() {
            return Ok(Value::Object(out));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        for r in tx.query(&parts.join(" UNION ALL "), &[&t.id]).await? {
            out.insert(r.get::<_, String>(0), json!(r.get::<_, i64>(1)));
        }
        Ok(Value::Object(out))
    }

    pub(crate) async fn apply_seeds(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        owner: &str,
        seeds: &[crate::defs::SeedSpec],
    ) -> R<()> {
        for s in seeds {
            let q = self.reg.qualify(owner, &s.entity);
            let ent = self.ent(t, &q)?;
            let data = s.data.as_object().cloned().unwrap_or_default();
            self.create_in(tx, &Actor::System, t, &ent, data, &Opts::silent_top())
                .await?;
        }
        Ok(())
    }

    pub fn add_ext_field_check(&self, t: &Tenant, qname: &str, f: &FieldDef) -> R<()> {
        let ent = self.ent(t, qname)?;
        if ent.field(&f.name).is_some()
            || ["id", "createdAt", "updatedAt", "tenant_id", "custom"].contains(&f.name.as_str())
        {
            return Err(ApiError::new(
                409,
                "FIELD_EXISTS",
                format!("Trường \"{}\" đã có trên {qname}", f.name),
            ));
        }
        if f.ty == "ref"
            && f.reference
                .as_deref()
                .and_then(|r| self.reg.entity(r))
                .is_none()
        {
            return Err(ApiError::new(
                422,
                "BAD_REF",
                format!(
                    "ref tới {} không tồn tại",
                    f.reference.clone().unwrap_or_default()
                ),
            ));
        }
        Ok(())
    }
}
