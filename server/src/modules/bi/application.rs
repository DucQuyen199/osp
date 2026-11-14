//! Normalize BI definitions and translate saved filters to the generic tenant list API.
use crate::kernel::data::ListQuery;
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
pub struct AggregateSpec {
    pub operation: String,
    pub field: Option<String>,
    pub group_by: Option<String>,
}

pub fn aggregate_spec(query: &Value) -> Result<Option<AggregateSpec>, Vec<String>> {
    let Some(query) = query.as_object() else {
        return Err(vec!["Report query must be a JSON object".into()]);
    };
    let Some(aggregate) = query.get("aggregate") else {
        if query.contains_key("group_by") {
            return Err(vec!["group_by requires an aggregate operation".into()]);
        }
        return Ok(None);
    };
    let Some(aggregate) = aggregate.as_object() else {
        return Err(vec!["Report aggregate must be an object".into()]);
    };
    let Some(operation) = aggregate.get("operation").and_then(Value::as_str) else {
        return Err(vec!["Report aggregate requires an operation".into()]);
    };
    if !matches!(operation, "count" | "sum" | "avg" | "min" | "max") {
        return Err(vec!["Report aggregate operation is not supported".into()]);
    }
    for key in aggregate.keys() {
        if !matches!(key.as_str(), "operation" | "field") {
            return Err(vec![format!("Unsupported aggregate option: {key}")]);
        }
    }
    let field = aggregate
        .get("field")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if operation != "count" && field.is_none() {
        return Err(vec![format!("{operation} aggregate requires a field")]);
    }
    if aggregate
        .get("field")
        .is_some_and(|field| !field.is_null() && !field.is_string())
    {
        return Err(vec!["Aggregate field must be a field name".into()]);
    }
    let group_by = query
        .get("group_by")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if query
        .get("group_by")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(vec!["group_by must be a field name".into()]);
    }
    Ok(Some(AggregateSpec {
        operation: operation.to_owned(),
        field,
        group_by,
    }))
}

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) -> Vec<String> {
    let field = match entity {
        "dashboard" | "report" | "kpi" => "name",
        _ => return Vec::new(),
    };
    let mut errors = Vec::new();
    if let Some(value) = document
        .get(field)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_owned())
    {
        document.insert(field.into(), Value::String(value.clone()));
        if value.is_empty() {
            errors.push("Name cannot be empty".into());
        }
    }
    errors
}

pub fn report_query(query: &Value) -> Result<(String, ListQuery), Vec<String>> {
    let Some(query) = query.as_object() else {
        return Err(vec!["Report query must be a JSON object".into()]);
    };
    let Some(source) = query.get("source").and_then(Value::as_str) else {
        return Err(vec![
            "Report query must specify a source such as sales.sales_order".into(),
        ]);
    };
    let mut errors = Vec::new();
    for key in query.keys() {
        if !matches!(
            key.as_str(),
            "source"
                | "filters"
                | "search"
                | "sort"
                | "direction"
                | "limit"
                | "offset"
                | "aggregate"
                | "group_by"
        ) {
            errors.push(format!("Unsupported report query option: {key}"));
        }
    }
    let valid_qname = source.split_once('.').is_some_and(|(module, entity)| {
        !module.is_empty()
            && !entity.is_empty()
            && module
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
            && entity
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
    });
    if !valid_qname {
        errors.push("Report source must be a module.entity name".into());
    }
    let mut filter = Vec::new();
    if let Some(filters) = query.get("filters") {
        if let Some(filters) = filters.as_object() {
            if filters.len() > 20 {
                errors.push("A report can have at most 20 filters".into());
            }
            for (field, value) in filters {
                let value = if let Some(value) = value.as_str() {
                    value.to_owned()
                } else if let Some(value) = value.as_bool() {
                    value.to_string()
                } else if value.is_number() {
                    value.to_string()
                } else {
                    errors.push(format!(
                        "Filter {field} must be a string, number, or boolean"
                    ));
                    continue;
                };
                filter.push((field.clone(), value));
            }
        } else if !filters.is_null() {
            errors.push("Report filters must be a JSON object".into());
        }
    }
    let limit = query.get("limit").and_then(Value::as_i64).unwrap_or(100);
    let offset = query.get("offset").and_then(Value::as_i64).unwrap_or(0);
    if !(1..=1000).contains(&limit) {
        errors.push("Report limit must be between 1 and 1000".into());
    }
    if offset < 0 {
        errors.push("Report offset cannot be negative".into());
    }
    let direction = query
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or("asc");
    if !matches!(direction, "asc" | "desc") {
        errors.push("Report direction must be asc or desc".into());
    }
    if query
        .get("sort")
        .is_some_and(|sort| !sort.is_null() && !sort.is_string())
    {
        errors.push("Report sort must be a field name".into());
    }
    if query
        .get("search")
        .is_some_and(|search| !search.is_null() && !search.is_string())
    {
        errors.push("Report search must be text".into());
    }
    let aggregate = match aggregate_spec(&Value::Object(query.clone())) {
        Ok(aggregate) => aggregate,
        Err(aggregate_errors) => {
            errors.extend(aggregate_errors);
            None
        }
    };
    if aggregate.is_some()
        && query
            .get("sort")
            .and_then(Value::as_str)
            .is_some_and(|sort| !matches!(sort, "group" | "value"))
    {
        errors.push("Aggregate report sort must be group or value".into());
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok((
        source.to_owned(),
        ListQuery {
            filter,
            limit,
            offset,
            q: query
                .get("search")
                .and_then(Value::as_str)
                .map(str::to_owned),
            sort: query.get("sort").and_then(Value::as_str).map(str::to_owned),
            desc: direction == "desc",
        },
    ))
}
