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
    let provider_code = provider_code(tenant);
    let mut request_payload = document.clone();
    if provider_code.as_deref() == Some("sepay") {
        enrich_sepay_invoice(tx, tenant, invoice, &mut request_payload).await?;
    }
    data.insert("request_payload".into(), request_payload);
    if let Some(provider) = provider_code {
        data.insert("provider".into(), Value::String(provider));
    }
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

/// Resolve the production worker's selected provider and persist it with the
/// immutable request so a later default change cannot reroute queued invoices.
fn provider_code(tenant: &Tenant) -> Option<String> {
    if let Some(provider) = tenant
        .setting_str("einvoiceProvider")
        .map(str::trim)
        .filter(|provider| !provider.is_empty())
    {
        return Some(provider.to_ascii_lowercase());
    }
    if let Some(provider) = std::env::var("OSP_EINVOICE_DEFAULT_PROVIDER")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    {
        return Some(provider);
    }
    if std::env::var("OSP_EINVOICE_ENDPOINT")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Some(
            std::env::var("OSP_EINVOICE_PROVIDER")
                .ok()
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "rest".into()),
        );
    }
    std::env::var("OSP_SEPAY_EINVOICE_CLIENT_ID")
        .is_ok()
        .then(|| "sepay".into())
}

/// Snapshot only verified buyer/product reference data into the durable job.
/// Tax values are copied from the posted invoice lines; they are never inferred.
async fn enrich_sepay_invoice(
    tx: &Tx<'_>,
    tenant: &Tenant,
    invoice_id: Uuid,
    request: &mut Value,
) -> R<()> {
    let buyer = tx
        .query_opt(
            "SELECT p.name, p.tax_code, p.address, p.email, p.phone, currency.code FROM accounting__invoice i JOIN master_data__party p ON p.tenant_id=i.tenant_id AND p.id=i.party LEFT JOIN master_data__currency currency ON currency.tenant_id=i.tenant_id AND currency.id=i.currency WHERE i.tenant_id=$1 AND i.id=$2",
            &[&tenant.id, &invoice_id],
        )
        .await?;
    if let Some(buyer) = buyer {
        let name: String = buyer.get(0);
        let tax_code: Option<String> = buyer.get(1);
        let address: Option<String> = buyer.get(2);
        let email: Option<String> = buyer.get(3);
        let phone: Option<String> = buyer.get(4);
        let currency: Option<String> = buyer.get(5);
        let mut buyer_data = serde_json::Map::new();
        buyer_data.insert("name".into(), Value::String(name));
        for (field, value) in [
            ("tax_code", tax_code),
            ("address", address),
            ("email", email),
            ("phone", phone),
        ] {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                buyer_data.insert(field.into(), Value::String(value));
            }
        }
        if let Some(request) = request.as_object_mut() {
            request.insert("buyer".into(), Value::Object(buyer_data));
            if let Some(currency) = currency {
                request.insert("currency_code".into(), Value::String(currency));
            }
        }
    }
    let invoice_tax_rate = request.get("tax_rate").cloned();
    let lines = request.get_mut("lines").and_then(Value::as_array_mut);
    if let Some(lines) = lines {
        for line in lines {
            let Some(object) = line.as_object_mut() else {
                continue;
            };
            let product_id = object
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let Some(product_id) = product_id {
                if let Some(product) = tx
                    .query_opt(
                        "SELECT name, sku, uom FROM master_data__product WHERE tenant_id=$1 AND id=$2",
                        &[&tenant.id, &product_id],
                    )
                    .await?
                {
                    let name: String = product.get(0);
                    let sku: Option<String> = product.get(1);
                    let uom: Option<Uuid> = product.get(2);
                    object.entry("item_name").or_insert(Value::String(name));
                    if let Some(sku) = sku.filter(|value| !value.trim().is_empty()) {
                        object.entry("item_code").or_insert(Value::String(sku));
                    }
                    if let Some(uom) = uom
                        && let Some(unit) = tx.query_opt(
                            "SELECT name FROM master_data__uom WHERE tenant_id=$1 AND id=$2",
                            &[&tenant.id, &uom],
                        ).await?
                    {
                        let name: String = unit.get(0);
                        object.entry("unit").or_insert(Value::String(name));
                    }
                }
            }
            if let Some(rate) = invoice_tax_rate.clone() {
                object.entry("tax_rate").or_insert(rate);
            }
        }
    }
    Ok(())
}
