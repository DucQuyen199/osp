//! Normalize events and snapshot the published ticket price for each reservation.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::{Duration, SecondsFormat, Utc};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value};
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.ticket",
            vec![format!("Stored event {field} is not a valid decimal")],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.ticket",
            vec!["Ticket amount exceeds the supported decimal range".into()],
        )
    })
}

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "event" {
        trim(document, &["name", "venue"]);
        if document
            .get("reservation_minutes")
            .is_none_or(Value::is_null)
        {
            document.insert("reservation_minutes".into(), Value::from(15));
        }
        let tax_value = document.get("ticket_tax").and_then(Value::as_str);
        let tax = tax_value.and_then(|id| Uuid::parse_str(id).ok());
        if tax_value.is_some() && tax.is_none() {
            return Ok(vec!["Thuế vé cần tham chiếu danh mục thuế hợp lệ".into()]);
        }
        if let Some(tax) = tax {
            let Some(row) = tx
                .query_opt(
                    "SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &tax],
                )
                .await?
            else {
                return Ok(vec!["Không tìm thấy thuế vé trong doanh nghiệp".into()]);
            };
            document.insert("ticket_tax_name".into(), Value::String(row.get(0)));
            document.insert(
                "ticket_tax_rate".into(),
                decimal_json(decimal_column(&row, 1, "tax rate")?)?,
            );
        } else {
            document.insert("ticket_tax_name".into(), Value::String("No tax".into()));
            document.insert("ticket_tax_rate".into(), Value::from(0));
        }
        return Ok(Vec::new());
    }
    if entity != "ticket" {
        return Ok(Vec::new());
    }
    trim(document, &["refund_reason"]);
    if !document.contains_key("id") {
        document.insert(
            "ticket_code".into(),
            Value::String(Uuid::new_v4().simple().to_string().to_ascii_uppercase()),
        );
    }
    let Some(event) = document
        .get("event")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Vé cần sự kiện hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT ticket_price::text, COALESCE(ticket_tax_rate, 0)::text, COALESCE(ticket_tax_name, 'No tax'), COALESCE(reservation_minutes, 15)::int FROM events__event WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &event],
        )
        .await?
    else {
        return Ok(vec!["Sự kiện không tồn tại trong doanh nghiệp".into()]);
    };
    let price = decimal_column(&row, 0, "ticket price")?;
    let tax_rate = decimal_column(&row, 1, "ticket tax rate")?;
    let tax_name: String = row.get(2);
    let reservation_minutes: i32 = row.get(3);
    let tax_fraction = tax_rate.checked_div(Decimal::from(100)).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.ticket",
            vec!["Ticket tax rate exceeds the supported decimal range".into()],
        )
    })?;
    let divisor = Decimal::ONE.checked_add(tax_fraction).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.ticket",
            vec!["Ticket tax rate exceeds the supported decimal range".into()],
        )
    })?;
    let net_amount = price
        .checked_div(divisor)
        .map(|value| value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "event_management.ticket",
                vec!["Ticket net amount exceeds the supported decimal range".into()],
            )
        })?;
    let tax_amount = price.checked_sub(net_amount).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.ticket",
            vec!["Ticket tax amount exceeds the supported decimal range".into()],
        )
    })?;
    document.insert("price".into(), decimal_json(price)?);
    document.insert("tax_rate".into(), decimal_json(tax_rate)?);
    document.insert("tax_name".into(), Value::String(tax_name));
    document.insert("net_amount".into(), decimal_json(net_amount)?);
    document.insert("tax_amount".into(), decimal_json(tax_amount)?);
    if !document.contains_key("id") {
        let Some(expires_at) =
            Utc::now().checked_add_signed(Duration::minutes(i64::from(reservation_minutes)))
        else {
            return Ok(vec!["Thời hạn giữ vé không hợp lệ".into()]);
        };
        document.insert(
            "reservation_expires_at".into(),
            Value::String(expires_at.to_rfc3339_opts(SecondsFormat::Millis, true)),
        );
    }
    Ok(Vec::new())
}

fn trim(document: &mut Map<String, Value>, fields: &[&str]) {
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value));
        }
    }
}
