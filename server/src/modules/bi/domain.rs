//! BI configuration invariants. Report definitions are data filters, never SQL.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if matches!(entity, "dashboard" | "report" | "kpi")
        && document
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
    {
        errors.push("Name is required".into());
    }
    match entity {
        "dashboard" => {
            if let Some(widgets) = document.get("widgets") {
                if !widgets.is_null() {
                    let Some(widgets) = widgets.as_array() else {
                        return vec!["Dashboard widgets must be a JSON array".into()];
                    };
                    if widgets.len() > 24 {
                        errors.push("A dashboard can have at most 24 widgets".into());
                    }
                    for (index, widget) in widgets.iter().enumerate() {
                        let Some(widget) = widget.as_object() else {
                            errors.push(format!("Dashboard widget {index} must be an object"));
                            continue;
                        };
                        let widget_type = widget.get("type").and_then(Value::as_str);
                        if widget_type == Some("kpi") {
                            if widget.get("kpi").and_then(Value::as_str).is_none() {
                                errors.push(format!(
                                    "Dashboard KPI widget {index} must reference a KPI id"
                                ));
                            }
                        } else if widget.get("report").and_then(Value::as_str).is_none() {
                            errors.push(format!(
                                "Dashboard widget {index} must reference a report id"
                            ));
                        }
                        if !widget
                            .get("type")
                            .and_then(Value::as_str)
                            .is_some_and(|kind| {
                                matches!(kind, "table" | "number" | "line" | "bar" | "pie" | "kpi")
                            })
                        {
                            errors
                                .push(format!("Dashboard widget {index} has an unsupported type"));
                        }
                    }
                }
            }
        }
        "report" => {
            if let Some(query) = document.get("query").filter(|query| !query.is_null()) {
                if let Err(query_errors) = crate::modules::bi::report_query(query) {
                    errors.extend(query_errors);
                }
            }
            if let Some(recipients) = document.get("email_recipients") {
                let Some(recipients) = recipients.as_array() else {
                    errors.push("Report email recipients must be a JSON array".into());
                    return errors;
                };
                if recipients.len() > 20 {
                    errors.push("A report can email at most 20 recipients".into());
                }
                let mut normalized = std::collections::HashSet::new();
                for recipient in recipients {
                    let Some(address) = recipient.as_str().map(str::trim) else {
                        errors.push("Report email recipients must be email addresses".into());
                        continue;
                    };
                    let mut parts = address.split('@');
                    let local = parts.next().unwrap_or_default();
                    let domain = parts.next().unwrap_or_default();
                    if local.is_empty()
                        || domain.is_empty()
                        || parts.next().is_some()
                        || !domain.contains('.')
                        || address.chars().any(char::is_whitespace)
                    {
                        errors.push(format!("Invalid report email recipient: {address}"));
                    } else if !normalized.insert(address.to_ascii_lowercase()) {
                        errors.push(format!("Duplicate report email recipient: {address}"));
                    }
                }
                if !recipients.is_empty()
                    && !matches!(
                        document.get("schedule").and_then(Value::as_str),
                        Some("daily" | "weekly")
                    )
                {
                    errors.push("Email delivery requires a daily or weekly report schedule".into());
                }
            }
        }
        "kpi" => {
            if document
                .get("report")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                errors.push("KPI must reference a saved aggregate report".into());
            }
            if let Some(formula) = document.get("formula").and_then(Value::as_str) {
                let formula = formula.trim().strip_prefix('=').unwrap_or(formula.trim());
                if formula.chars().count() > 500 {
                    errors.push("KPI formula is limited to 500 characters".into());
                } else if let Err(error) = crate::expr::validate_expr(formula) {
                    errors.push(format!("Invalid KPI formula: {error}"));
                }
            }
            if document.get("target").is_some_and(|value| !value.is_null())
                && !document
                    .get("target")
                    .and_then(money::decimal)
                    .is_some_and(|target| target >= Decimal::ZERO)
            {
                errors.push("KPI target must be zero or greater".into());
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity != "report" {
        return Vec::new();
    }
    match action {
        "scheduled"
            if !matches!(
                document.get("schedule").and_then(Value::as_str),
                Some("daily" | "weekly")
            ) =>
        {
            vec!["Choose a daily or weekly cadence before scheduling the report".into()]
        }
        "run_due" => {
            let due = document
                .get("next_run_at")
                .and_then(Value::as_str)
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
            if due.is_none_or(|value| value > chrono::Utc::now()) {
                vec!["A scheduled report can only run after its next run time".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "report"
        && current.get("schedule_status").and_then(Value::as_str) == Some("scheduled")
        && patch.get("schedule").is_some()
    {
        return vec!["Pause a scheduled report before changing its cadence".into()];
    }
    Vec::new()
}

pub fn validate_remove(_entity: &str, _document: &Value) -> Vec<String> {
    Vec::new()
}
