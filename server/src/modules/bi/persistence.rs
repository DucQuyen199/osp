//! Tenant-scoped BI names and dashboard-to-report links.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if action == "removed" && entity == "report" {
        if let Some(id) = document.get("id").and_then(Value::as_str) {
            if tx.query_opt(
                "SELECT id FROM bi__dashboard d WHERE d.tenant_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.widgets, '[]'::jsonb)) w WHERE w->>'report' = $2) LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                return Ok(vec!["A report referenced by a dashboard widget cannot be deleted".into()]);
            }
            if tx
                .query_opt(
                    "SELECT id FROM bi__kpi WHERE tenant_id = $1 AND report = $2 LIMIT 1",
                    &[&tenant.id, &Uuid::parse_str(id).ok()],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "A report referenced by a KPI cannot be deleted".into(),
                ]);
            }
            if tx
                .query_opt(
                    "SELECT id FROM bi__report_run WHERE tenant_id = $1 AND report = $2 LIMIT 1",
                    &[&tenant.id, &Uuid::parse_str(id).ok()],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "A report with saved execution history cannot be deleted".into(),
                ]);
            }
        }
        return Ok(Vec::new());
    }
    if action == "removed" || !matches!(entity, "dashboard" | "report" | "kpi") {
        return Ok(Vec::new());
    }
    let table = format!("bi__{entity}");
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    if let Some(name) = document.get("name").and_then(Value::as_str) {
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended('bi.record-name:' || $1::text || ':' || $2 || ':' || lower(btrim($3)), 0))",
            &[&tenant.id, &entity, &name],
        )
        .await?;
        let sql = format!(
            "SELECT id FROM {table} WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1"
        );
        if tx
            .query_opt(&sql, &[&tenant.id, &name.trim(), &id])
            .await?
            .is_some()
        {
            return Ok(vec![
                "A BI record with this name already exists in the tenant".into(),
            ]);
        }
    }
    if entity == "dashboard" {
        if let Some(widgets) = document.get("widgets").and_then(Value::as_array) {
            for widget in widgets {
                if widget.get("type").and_then(Value::as_str) == Some("kpi") {
                    let Some(kpi_id) = widget
                        .get("kpi")
                        .and_then(Value::as_str)
                        .and_then(|id| Uuid::parse_str(id).ok())
                    else {
                        return Ok(vec![
                            "Dashboard KPI widgets must reference a valid KPI id".into(),
                        ]);
                    };
                    if tx
                        .query_opt(
                            "SELECT id FROM bi__kpi WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &kpi_id],
                        )
                        .await?
                        .is_none()
                    {
                        return Ok(vec!["Dashboard KPI does not exist in this tenant".into()]);
                    }
                    continue;
                }
                let Some(report) = widget
                    .get("report")
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok())
                else {
                    return Ok(vec![
                        "Dashboard widgets must reference a valid tenant report".into(),
                    ]);
                };
                let Some(report_row) = tx
                    .query_opt(
                        "SELECT query FROM bi__report WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &report],
                    )
                    .await?
                else {
                    return Ok(vec![
                        "Dashboard widget report does not exist in this tenant".into(),
                    ]);
                };
                let Some(query) = report_row.get::<_, Option<Value>>(0) else {
                    return Ok(vec![
                        "Dashboard widgets can only reference reports with a saved query".into(),
                    ]);
                };
                if crate::modules::bi::report_query(&query).is_err() {
                    return Ok(vec![
                        "Dashboard widget report has an invalid saved query".into(),
                    ]);
                }
                let aggregate = crate::modules::bi::aggregate_spec(&query).ok().flatten();
                let widget_type = widget
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let chart_matches_query = match widget_type {
                    "table" => true,
                    "number" => aggregate
                        .as_ref()
                        .is_some_and(|aggregate| aggregate.group_by.is_none()),
                    "line" | "bar" | "pie" => aggregate
                        .as_ref()
                        .is_some_and(|aggregate| aggregate.group_by.is_some()),
                    _ => false,
                };
                if !chart_matches_query {
                    return Ok(vec![format!(
                        "Dashboard widget type {widget_type} does not match its saved report query"
                    )]);
                }
            }
        }
    } else if entity == "kpi" {
        let Some(report_id) = document
            .get("report")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(vec!["KPI must reference a valid tenant report".into()]);
        };
        let Some(report_row) = tx
            .query_opt(
                "SELECT query FROM bi__report WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &report_id],
            )
            .await?
        else {
            return Ok(vec!["KPI report does not exist in this tenant".into()]);
        };
        let query: Option<Value> = report_row.get(0);
        let valid_aggregate = query.is_some_and(|query| {
            crate::modules::bi::report_query(&query).is_ok()
                && crate::modules::bi::aggregate_spec(&query)
                    .ok()
                    .flatten()
                    .is_some_and(|aggregate| aggregate.group_by.is_none())
        });
        if !valid_aggregate {
            return Ok(vec![
                "KPI report must use a valid ungrouped aggregate query".into(),
            ]);
        }
    } else if entity == "report" && action == "updated" {
        if let Some(report_id) = id {
            let referenced = tx
                .query_opt(
                    "SELECT id FROM bi__kpi WHERE tenant_id = $1 AND report = $2 LIMIT 1",
                    &[&tenant.id, &report_id],
                )
                .await?
                .is_some();
            if referenced {
                let query = document.get("query").filter(|query| !query.is_null());
                let valid_aggregate = query.is_some_and(|query| {
                    crate::modules::bi::report_query(query).is_ok()
                        && crate::modules::bi::aggregate_spec(query)
                            .ok()
                            .flatten()
                            .is_some_and(|aggregate| aggregate.group_by.is_none())
                });
                if !valid_aggregate {
                    return Ok(vec![
                        "A report referenced by a KPI must remain an ungrouped aggregate".into(),
                    ]);
                }
            }
        }
    }
    Ok(Vec::new())
}
