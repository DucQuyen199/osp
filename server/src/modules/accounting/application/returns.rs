use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub(super) async fn create_return_note(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event: &Value,
    event_id: Uuid,
    depth: u32,
    purchase: bool,
) -> R<()> {
    let source_id = event
        .get(if purchase {
            "purchase_order"
        } else {
            "sales_order"
        })
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                if purchase {
                    "purchasing.purchase_return.dispatched"
                } else {
                    "sales.sales_return.received"
                },
                vec!["Returned document requires a valid source order".into()],
            )
        })?;
    let (table, note_entity, foreign_key, source_kind) = if purchase {
        (
            "accounting__bill",
            "accounting.debit_note",
            "bill",
            "purchase_return",
        )
    } else {
        (
            "accounting__invoice",
            "accounting.credit_note",
            "invoice",
            "sales_return",
        )
    };
    let source_key = source_id.to_string();
    let source_document = if purchase {
        if let Some(invoice_id) = event.get("supplier_invoice").and_then(Value::as_str) {
            tx.query_opt(
                "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND supplier_invoice_id=$3 AND status IN ('posted','partially_paid','partially_settled','paid','settled') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
                &[&tenant.id, &source_key, &invoice_id],
            ).await?
        } else {
            tx.query_opt(
                "SELECT id FROM accounting__bill WHERE tenant_id=$1 AND source='purchase_order' AND source_id=$2 AND supplier_invoice_id IS NULL AND status IN ('posted','partially_paid','partially_settled','paid','settled') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
                &[&tenant.id, &source_key],
            ).await?
        }
    } else {
        let lookup_sql = format!(
            "SELECT id FROM {table} WHERE tenant_id=$1 AND source='sales_order' AND source_id=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE"
        );
        tx.query_opt(&lookup_sql, &[&tenant.id, &source_key])
            .await?
    };
    let Some(source_document) = source_document else {
        return Err(crate::error::ApiError::validation(
            if purchase {
                "purchasing.purchase_return.dispatched"
            } else {
                "sales.sales_return.received"
            },
            vec!["Matching posted accounting source document was not found".into()],
        ));
    };
    let source_document_id: Uuid = source_document.get(0);
    let mut note = Map::new();
    note.insert(
        foreign_key.into(),
        Value::String(source_document_id.to_string()),
    );
    note.insert(
        "total".into(),
        event.get("total").cloned().unwrap_or(Value::Null),
    );
    for field in ["tax_total", "lines"] {
        if let Some(value) = event.get(field).filter(|value| !value.is_null()) {
            note.insert(field.into(), value.clone());
        }
    }
    if purchase {
        if let Some(department) = event.get("department").filter(|value| !value.is_null()) {
            note.insert("department".into(), department.clone());
        }
    }
    note.insert("source".into(), Value::String(source_kind.into()));
    note.insert(
        "source_id".into(),
        event.get("id").cloned().ok_or_else(|| {
            crate::error::ApiError::validation(
                "accounting.return_note",
                vec!["Return document requires an id".into()],
            )
        })?,
    );
    let entity = kernel.ent(tenant, note_entity)?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let created = kernel
        .create_in(tx, &Actor::System, tenant, &entity, note, &opts)
        .await?;
    let id = created["id"].as_str().ok_or_else(|| {
        crate::error::ApiError::internal("Created accounting return note has no id")
    })?;
    kernel
        .act_in(tx, &Actor::System, tenant, &entity, id, "posted", &opts)
        .await?;
    Ok(())
}
