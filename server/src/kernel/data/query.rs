use super::shared::*;

impl Kernel {
    pub async fn list(&self, actor: &Actor, t: &Tenant, qname: &str, q: &ListQuery) -> R<Value> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.read"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let (items, total) = self.query_rows(&tx, t, &ent, q).await?;
        Ok(json!({ "items": items, "total": total }))
    }

    pub(crate) async fn query_rows(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        q: &ListQuery,
    ) -> R<(Vec<Value>, i64)> {
        let quote = crate::schema::quote;
        let tbl = quote(&ent.def.table());
        let mut params: Vec<BoxParam> = vec![Box::new(t.id.clone())];
        let mut wh = vec!["t.tenant_id = $1".to_string()];
        for (k, v) in &q.filter {
            let range_filter = [
                ("__gte", ">="),
                ("__gt", ">"),
                ("__lte", "<="),
                ("__lt", "<"),
            ]
            .iter()
            .find_map(|(suffix, operator)| k.strip_suffix(suffix).map(|field| (field, operator)));
            if let Some((field, operator)) = range_filter {
                if is_ident(field)
                    && ent
                        .field(field)
                        .is_some_and(|definition| definition.ty == "date")
                    && NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
                {
                    params.push(Box::new(v.clone()));
                    wh.push(format!(
                        "t.{} {operator} ${}::date",
                        quote(field),
                        params.len()
                    ));
                } else {
                    wh.push("false".into());
                }
            } else if k == "id" {
                params.push(Box::new(v.clone()));
                wh.push(format!("t.id::text = ${}", params.len()));
            } else if ent.is_typed(k) {
                params.push(Box::new(v.clone()));
                wh.push(format!("t.{}::text = ${}", quote(k), params.len()));
            } else if ent.field(k).is_some() && is_ident(k) {
                params.push(Box::new(k.clone()));
                params.push(Box::new(v.clone()));
                wh.push(format!(
                    "t.custom->>${} = ${}",
                    params.len() - 1,
                    params.len()
                ));
            } else {
                wh.push("false".into());
            }
        }
        if let Some(text) = q.q.as_ref().filter(|s| !s.trim().is_empty()) {
            let like = format!(
                "%{}%",
                text.trim()
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            params.push(Box::new(like));
            let n = params.len();
            let cols: Vec<String> = ent
                .def
                .fields
                .iter()
                .filter(|f| ["string", "text", "enum"].contains(&f.ty.as_str()))
                .map(|f| format!("t.{} ILIKE ${n}", quote(&f.name)))
                .collect();
            if !cols.is_empty() {
                wh.push(format!("({})", cols.join(" OR ")));
            }
        }
        let where_sql = wh.join(" AND ");
        let order_col = match q.sort.as_deref() {
            Some("createdAt") | None => "t.created_at".to_string(),
            Some("updatedAt") => "t.updated_at".to_string(),
            Some(s) if ent.is_typed(s) => format!("t.{}", quote(s)),
            _ => "t.created_at".to_string(),
        };
        let dir = if q.desc { "DESC" } else { "ASC" };

        let total: i64 = tx
            .query_opt(
                &format!("SELECT count(*) FROM {tbl} t WHERE {where_sql}"),
                &as_refs(&params),
            )
            .await?
            .map(|r| r.get(0))
            .unwrap_or(0);
        let limit = q.limit.clamp(1, 1000);
        let offset = q.offset.max(0);
        params.push(Box::new(limit));
        params.push(Box::new(offset));
        let sql = format!(
            "SELECT (to_jsonb(t) - 'tenant_id' - 'custom') || t.custom FROM {tbl} t WHERE {where_sql} ORDER BY {order_col} {dir}, t.id LIMIT ${} OFFSET ${}",
            params.len() - 1,
            params.len()
        );
        let items = tx
            .query_json(&sql, &as_refs(&params))
            .await?
            .into_iter()
            .map(normalize_row)
            .collect();
        Ok((items, total))
    }

    /// Tìm bản ghi đầu tiên khớp (so sánh chặt: giá trị trống nghĩa là trường phải trống). Dùng cho luật tích hợp.
    pub(crate) async fn find_first(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        m: &Obj,
    ) -> R<Option<Obj>> {
        let quote = crate::schema::quote;
        let tbl = quote(&ent.def.table());
        let mut params: Vec<BoxParam> = vec![Box::new(t.id.clone())];
        let mut wh = vec!["t.tenant_id = $1".to_string()];
        for (k, v) in m {
            let col = if k == "id" {
                "t.id::text".to_string()
            } else if ent.is_typed(k) {
                format!("t.{}::text", quote(k))
            } else if ent.field(k).is_some() {
                params.push(Box::new(k.clone()));
                format!("t.custom->>${}", params.len())
            } else {
                return Ok(None);
            };
            let s = match v {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            if s.is_empty() {
                wh.push(format!("{col} IS NULL"));
            } else {
                params.push(Box::new(s));
                wh.push(format!("{col} = ${}", params.len()));
            }
        }
        let sql = format!(
            "SELECT (to_jsonb(t) - 'tenant_id' - 'custom') || t.custom FROM {tbl} t WHERE {} ORDER BY t.created_at, t.id LIMIT 1",
            wh.join(" AND ")
        );
        let refs: Vec<&(dyn ToSql + Sync)> = params
            .iter()
            .map(|b| b.as_ref() as &(dyn ToSql + Sync))
            .collect();
        Ok(tx
            .query_json(&sql, &refs)
            .await?
            .into_iter()
            .next()
            .and_then(|v| match normalize_row(v) {
                Value::Object(o) => Some(o),
                _ => None,
            }))
    }
}
