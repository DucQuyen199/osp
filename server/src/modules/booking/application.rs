//! Booking document preparation and service-default application.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use chrono::{DateTime, Duration};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn optional_decimal_column(
    row: &tokio_postgres::Row,
    column: usize,
    field: &str,
) -> R<Option<Decimal>> {
    let value: Option<String> = row.get(column);
    value
        .map(|value| {
            money::decimal_str(&value).ok_or_else(|| {
                crate::error::ApiError::validation(
                    "booking",
                    vec![format!("Stored booking {field} is not a valid decimal")],
                )
            })
        })
        .transpose()
}

/// Apply service defaults and snapshot the resulting end time and price before
/// the booking is stored. A supplied price remains a negotiated price.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity != "booking" {
        return Ok(Vec::new());
    }
    let Some(start_text) = document.get("starts_at").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let Ok(start) = DateTime::parse_from_rfc3339(start_text) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    if let Some(service_id) = document
        .get("service")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    {
        let service = tx
            .query_opt(
                "SELECT duration_min::text, price::text FROM booking__service WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &service_id],
            )
            .await?;
        if let Some(service) = service {
            let duration = optional_decimal_column(&service, 0, "service duration")?;
            let price = optional_decimal_column(&service, 1, "service price")?;
            if document.get("ends_at").and_then(Value::as_str).is_none() {
                if let Some(minutes) = duration.filter(|value| *value > Decimal::ZERO) {
                    let millis = minutes
                        .checked_mul(Decimal::from(60_000))
                        .map(|value| {
                            value.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                        })
                        .and_then(|value| value.to_i64());
                    if let Some(millis) = millis {
                        if let Some(end) = start.checked_add_signed(Duration::milliseconds(millis))
                        {
                            document.insert("ends_at".into(), json!(end.to_rfc3339()));
                        } else {
                            errors.push("Thời lượng dịch vụ vượt giới hạn ngày hợp lệ".into());
                        }
                    } else {
                        errors.push("Thời lượng dịch vụ vượt giới hạn hợp lệ".into());
                    }
                }
            }
            if document.get("price").and_then(money::decimal).is_none() {
                if let Some(price) = price.filter(|value| *value >= Decimal::ZERO) {
                    let price = money::json_number(price).ok_or_else(|| {
                        crate::error::ApiError::validation(
                            "booking",
                            vec!["Service price exceeds the supported decimal range".into()],
                        )
                    })?;
                    document.insert("price".into(), price);
                }
            }
        }
    }
    if document.get("ends_at").and_then(Value::as_str).is_none() {
        errors.push("Cần chọn thời gian kết thúc hoặc dịch vụ có thời lượng hợp lệ".into());
    }
    Ok(errors)
}
