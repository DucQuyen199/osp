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

pub fn validate_action(_entity: &str, _action: &str, _document: &Value) -> Vec<String> {
    Vec::new()
}

pub fn validate_update(_entity: &str, _current: &Value, _patch: &Value) -> Vec<String> {
    Vec::new()
}

pub fn validate_remove(_entity: &str, _document: &Value) -> Vec<String> {
    Vec::new()
}
