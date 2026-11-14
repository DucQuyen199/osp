//! E-invoice issuance request tracking for posted accounting invoices.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::{domain, persistence};

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("einvoice") {
        return Ok(false);
    }
    if event_type != "accounting.invoice.posted" {
        return Ok(false);
    }
    let invoice = domain::posted_invoice_id(event_type, document).ok_or_else(|| {
        ApiError::validation(
            event_type,
            vec!["Sự kiện ghi sổ hóa đơn phải có mã UUID hợp lệ".into()],
        )
    })?;

    match persistence::lock_posted_invoice(tx, tenant, invoice).await? {
        Some(true) => return Ok(true),
        Some(false) => {}
        None => {
            return Err(ApiError::validation(
                event_type,
                vec![
                    "Chỉ có thể phát hành hóa đơn điện tử từ hóa đơn đã ghi sổ trong doanh nghiệp"
                        .into(),
                ],
            ));
        }
    }

    let mut data = Map::new();
    data.insert("invoice".into(), Value::String(invoice.to_string()));
    data.insert("request_payload".into(), document.clone());
    data.insert("attempts".into(), Value::Number(0.into()));
    data.insert("operation".into(), Value::String("issue".into()));
    let entity = kernel.ent(tenant, "einvoice.einvoice")?;
    kernel
        .create_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            data,
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}
