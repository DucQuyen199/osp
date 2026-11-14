//! Shared types and low-level helpers for the kernel data layer.
pub(super) use crate::db::Tx;
pub(super) use crate::defs::{Constraint, FieldDef};
pub(super) use crate::error::{ApiError, R};
pub(super) use crate::expr::{Scope, decimal_value, eval_expr_decimal};
pub(super) use crate::kernel::{Actor, Ent, Kernel, Obj, Opts, Tenant};
pub(super) use crate::money;
pub(super) use async_recursion::async_recursion;
pub(super) use chrono::{DateTime, NaiveDate, Utc};
pub(super) use serde_json::{Value, json};
pub(super) use tokio_postgres::types::ToSql;
pub(super) use uuid::Uuid;

#[derive(Clone)]
pub struct ListQuery {
    pub filter: Vec<(String, String)>,
    pub limit: i64,
    pub offset: i64,
    pub q: Option<String>,
    pub sort: Option<String>,
    pub desc: bool,
}

pub(super) type BoxParam = Box<dyn ToSql + Sync + Send>;

pub(super) fn as_refs(params: &[BoxParam]) -> Vec<&(dyn ToSql + Sync)> {
    params
        .iter()
        .map(|param| &**param as &(dyn ToSql + Sync))
        .collect()
}

pub(super) fn is_ident(value: &str) -> bool {
    !value.is_empty()
        && value.len() < 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
        && !value.chars().next().unwrap().is_ascii_digit()
}

/// Normalize database timestamps to the API's camelCase field names.
pub fn normalize_row(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        if let Some(created_at) = object.remove("created_at") {
            object.insert("createdAt".into(), created_at);
        }
        if let Some(updated_at) = object.remove("updated_at") {
            object.insert("updatedAt".into(), updated_at);
        }
    }
    value
}

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
