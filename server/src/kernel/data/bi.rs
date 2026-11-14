use super::shared::*;

mod reports;

impl Kernel {
    pub async fn aggregate_bi_report(
        &self,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        filters: &[(String, String)],
        search: Option<&str>,
        spec: &crate::modules::bi::AggregateSpec,
        page: &ListQuery,
    ) -> R<Value> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.read"))?;
        let error = |message: String| ApiError::validation("bi.report", vec![message]);
        let group_by = spec.group_by.as_deref();
        if let Some(field) = group_by {
            if !ent.is_typed(field) {
                return Err(error(format!("Unknown aggregate group field: {field}")));
            }
        }
        let aggregate_field = if let Some(field) = spec.field.as_deref() {
            let Some(definition) = ent.def.field(field) else {
                return Err(error(format!("Unknown aggregate field: {field}")));
            };
            if spec.operation != "count" && !matches!(definition.ty.as_str(), "number" | "money") {
                return Err(error(format!(
                    "Aggregate {} requires a numeric field",
                    spec.operation
                )));
            }
            Some(field)
        } else {
            None
        };
        let mut params: Vec<BoxParam> = vec![Box::new(t.id.clone())];
        let mut conditions = vec!["t.tenant_id = $1".to_string()];
        for (field, value) in filters {
            if field != "id" && !ent.is_typed(field) {
                return Err(error(format!("Unknown report filter field: {field}")));
            }
            params.push(Box::new(value.clone()));
            let index = params.len();
            let column = if field == "id" {
                "t.id".to_string()
            } else {
                format!("t.{}", crate::schema::quote(field))
            };
            conditions.push(format!("{column}::text = ${index}"));
        }
        if let Some(search) = search.filter(|search| !search.trim().is_empty()) {
            let like = format!(
                "%{}%",
                search
                    .trim()
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            let columns: Vec<String> = ent
                .def
                .fields
                .iter()
                .filter(|field| ["string", "text", "enum"].contains(&field.ty.as_str()))
                .map(|field| {
                    format!(
                        "t.{} ILIKE ${}",
                        crate::schema::quote(&field.name),
                        params.len() + 1
                    )
                })
                .collect();
            if !columns.is_empty() {
                params.push(Box::new(like));
                conditions.push(format!("({})", columns.join(" OR ")));
            }
        }
        let table = crate::schema::quote(&ent.def.table());
        let where_sql = conditions.join(" AND ");
        let aggregate_sql = match (spec.operation.as_str(), aggregate_field) {
            ("count", Some(field)) => format!("COUNT(t.{})", crate::schema::quote(field)),
            ("count", None) => "COUNT(*)".to_string(),
            ("sum", Some(field)) => format!("SUM(t.{})", crate::schema::quote(field)),
            ("avg", Some(field)) => format!("AVG(t.{})", crate::schema::quote(field)),
            ("min", Some(field)) => format!("MIN(t.{})", crate::schema::quote(field)),
            ("max", Some(field)) => format!("MAX(t.{})", crate::schema::quote(field)),
            _ => return Err(error("Invalid aggregate operation or field".into())),
        };
        let group_sql = group_by.map(|field| format!("t.{}", crate::schema::quote(field)));
        let mut row_params = params;
        let (sql, count_sql) = if let Some(group_sql) = &group_sql {
            let grouped = format!(
                "SELECT {group_sql} AS group_value, {aggregate_sql} AS aggregate_value FROM {table} t WHERE {where_sql} GROUP BY {group_sql}"
            );
            row_params.push(Box::new(page.limit));
            let limit_index = row_params.len();
            row_params.push(Box::new(page.offset));
            let offset_index = row_params.len();
            let order = if page.sort.as_deref() == Some("value") {
                "aggregate_value"
            } else {
                "group_value"
            };
            let direction = if page.desc { "DESC" } else { "ASC" };
            (
                format!(
                    "SELECT jsonb_build_object('group', group_value, 'value', aggregate_value) FROM ({grouped}) aggregate_rows ORDER BY {order} {direction} LIMIT ${limit_index} OFFSET ${offset_index}"
                ),
                Some(format!(
                    "SELECT COUNT(*)::bigint FROM ({grouped}) aggregate_rows"
                )),
            )
        } else {
            (
                format!(
                    "SELECT jsonb_build_object('value', {aggregate_sql}) FROM {table} t WHERE {where_sql}"
                ),
                None,
            )
        };
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let total = if let Some(count_sql) = count_sql {
            tx.query_one_row(&count_sql, &as_refs(&row_params[..row_params.len() - 2]))
                .await?
                .get(0)
        } else {
            1_i64
        };
        let items = tx.query_json(&sql, &as_refs(&row_params)).await?;
        Ok(json!({ "items": items, "total": total }))
    }
}
