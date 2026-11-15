//! Saved BI report execution and CSV export use cases.
use super::super::shared::*;

const MAX_BI_REPORT_EXPORT_ROWS: i64 = 50_000;
const BI_REPORT_EXPORT_PAGE_SIZE: i64 = 1_000;

impl Kernel {
    fn checked_bi_report_query(
        &self,
        t: &Tenant,
        query: &Value,
    ) -> R<(String, ListQuery, Option<crate::modules::bi::AggregateSpec>)> {
        let (source, report_query) = crate::modules::bi::report_query(query)
            .map_err(|errors| ApiError::validation("bi.report", errors))?;
        let aggregate = crate::modules::bi::aggregate_spec(query)
            .map_err(|errors| ApiError::validation("bi.report", errors))?;
        let source_ent = self.ent(t, &source)?;
        if aggregate.is_none() {
            if let Some(sort) = report_query.sort.as_deref() {
                if source_ent.field(sort).is_none() {
                    return Err(ApiError::validation(
                        "bi.report",
                        vec![format!("Unknown report sort field: {sort}")],
                    ));
                }
            }
        }
        if let Some((field, _)) = report_query
            .filter
            .iter()
            .find(|(field, _)| field != "id" && source_ent.field(field).is_none())
        {
            return Err(ApiError::validation(
                "bi.report",
                vec![format!("Unknown report filter field: {field}")],
            ));
        }
        if aggregate.is_some()
            && report_query.offset > 0
            && aggregate
                .as_ref()
                .is_some_and(|aggregate| aggregate.group_by.is_none())
        {
            return Err(ApiError::validation(
                "bi.report",
                vec!["An ungrouped aggregate report cannot have an offset".into()],
            ));
        }
        if let Some(sort) = report_query.sort.as_deref() {
            if aggregate.is_some() && !matches!(sort, "group" | "value") {
                return Err(ApiError::validation(
                    "bi.report",
                    vec!["Aggregate report sort must be group or value".into()],
                ));
            }
        }
        Ok((source, report_query, aggregate))
    }

    async fn query_bi_report_page(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        source: &str,
        query: &ListQuery,
        aggregate: Option<&crate::modules::bi::AggregateSpec>,
    ) -> R<Value> {
        if let Some(aggregate) = aggregate {
            self.aggregate_bi_report_in_tx(
                tx,
                actor,
                t,
                source,
                &query.filter,
                query.q.as_deref(),
                aggregate,
                query,
            )
            .await
        } else {
            let ent = self.ent(t, source)?;
            self.authorize(t, actor, &format!("{}.read", ent.qname()))?;
            let (mut items, total) = self.query_rows(tx, t, &ent, query).await?;
            if let Some(entity) = ent.qname().strip_prefix("integration-hub.") {
                items = items
                    .into_iter()
                    .map(|item| crate::modules::integration_hub::redact_document(entity, item))
                    .collect();
            }
            Ok(json!({ "items": items, "total": total }))
        }
    }

    pub async fn run_bi_report(&self, actor: &Actor, t: &Tenant, report_id: &str) -> R<Value> {
        let report = self.get(actor, t, "bi.report", report_id).await?;
        let Some(query) = report.get("query").filter(|query| !query.is_null()) else {
            return Err(ApiError::validation(
                "bi.report",
                vec!["Report has no saved query definition".into()],
            ));
        };
        let (source, report_query, aggregate) = self.checked_bi_report_query(t, query)?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let data = self
            .query_bi_report_page(&tx, actor, t, &source, &report_query, aggregate.as_ref())
            .await?;
        tx.commit().await?;
        Ok(json!({
            "reportId": report_id,
            "name": report.get("name"),
            "source": source,
            "items": data.get("items"),
            "total": data.get("total")
        }))
    }

    pub async fn list_bi_report_runs(
        &self,
        actor: &Actor,
        t: &Tenant,
        report_id: &str,
    ) -> R<Value> {
        let report = self.get(actor, t, "bi.report", report_id).await?;
        if let Some(source) = report
            .get("query")
            .and_then(|query| query.get("source"))
            .and_then(Value::as_str)
        {
            let source = self.ent(t, source)?;
            self.authorize(t, actor, &format!("{}.read", source.qname()))?;
        }
        let report_id = Uuid::parse_str(report_id).map_err(|_| ApiError::not_found("BI report"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let items = tx.query_json(
            "SELECT jsonb_build_object('id', id::text, 'report', report::text, 'runAt', run_at, 'rowCount', row_count, 'result', result, 'status', status) FROM bi__report_run WHERE tenant_id=$1 AND report=$2 ORDER BY run_at DESC, id DESC LIMIT 50",
            &[&t.id, &report_id],
        ).await?;
        tx.commit().await?;
        Ok(json!({ "items": items, "total": items.len() }))
    }

    /// Export all matching rows from a saved report, irrespective of its display page.
    pub async fn export_bi_report_csv(
        &self,
        actor: &Actor,
        t: &Tenant,
        report_id: &str,
    ) -> R<String> {
        let report = self.get(actor, t, "bi.report", report_id).await?;
        let Some(query) = report.get("query").filter(|query| !query.is_null()) else {
            return Err(ApiError::validation(
                "bi.report",
                vec!["Report has no saved query definition".into()],
            ));
        };
        let (source, mut report_query, aggregate) = self.checked_bi_report_query(t, query)?;
        report_query.limit = BI_REPORT_EXPORT_PAGE_SIZE;
        report_query.offset = 0;

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin_snapshot(&mut conn, &t.id).await?;
        let data = self
            .query_bi_report_page(&tx, actor, t, &source, &report_query, aggregate.as_ref())
            .await?;
        let total = data.get("total").and_then(Value::as_i64).unwrap_or(0);
        if total > MAX_BI_REPORT_EXPORT_ROWS {
            return Err(ApiError::new(
                422,
                "EXPORT_LIMIT",
                format!("BI report exports are limited to {MAX_BI_REPORT_EXPORT_ROWS} rows"),
            ));
        }
        let mut rows = data
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut offset = rows.len() as i64;
        while offset < total {
            let mut page = report_query.clone();
            page.offset = offset;
            let data = self
                .query_bi_report_page(&tx, actor, t, &source, &page, aggregate.as_ref())
                .await?;
            let next = data
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if next.is_empty() {
                return Err(ApiError::internal(
                    "BI report export returned fewer rows than its snapshot total",
                ));
            }
            offset += next.len() as i64;
            rows.extend(next);
        }
        if rows.len() as i64 != total {
            return Err(ApiError::internal(
                "BI report export row count does not match its snapshot total",
            ));
        }

        let csv = if aggregate.is_some() {
            crate::kernel::io::report_rows_to_csv(&["group", "value"], &rows)
        } else {
            let source_ent = self.ent(t, &source)?;
            let fields: Vec<&FieldDef> = source_ent.fields().collect();
            crate::kernel::io::to_csv(&fields, &rows)
        };
        drop(tx);
        drop(conn);
        self.audit_raw_ro(t, actor, "export", &format!("bi.report:{report_id}"))
            .await?;
        Ok(csv)
    }
}
