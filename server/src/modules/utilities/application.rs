//! Read calculation and bill snapshot preparation inside tenant transactions.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "utilities.meter_reading",
            vec![format!("Stored utility {field} is not a valid decimal")],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "utilities.meter_reading",
            vec!["Utility amount exceeds the supported decimal range".into()],
        )
    })
}

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    match entity {
        "meter_reading" => prepare_meter_reading(tx, tenant, document).await,
        "utility_bill" => prepare_utility_bill(tx, tenant, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn prepare_meter_reading(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(meter) = parse_id(document.get("meter")) else {
        return Ok(vec!["Chỉ số cần công tơ hợp lệ".into()]);
    };
    let Some(period) = document.get("period").and_then(Value::as_str) else {
        return Ok(vec!["Chỉ số cần kỳ YYYY-MM hợp lệ".into()]);
    };
    let reading = document
        .get("reading")
        .and_then(money::decimal)
        .filter(|value| *value >= Decimal::ZERO)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                "utilities.meter_reading",
                vec!["Chỉ số công tơ phải là số không âm".into()],
            )
        })?;
    let Some(meter_row) = tx
        .query_opt(
            "SELECT rate::text, COALESCE(opening_reading, 0)::text FROM utilities__meter WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &meter],
        )
        .await?
    else {
        return Ok(vec!["Công tơ không tồn tại trong doanh nghiệp".into()]);
    };
    let rate = decimal_column(&meter_row, 0, "meter rate")?;
    let opening_reading = decimal_column(&meter_row, 1, "opening reading")?;
    let previous = tx
        .query_opt(
            "SELECT reading::text FROM utilities__meter_reading WHERE tenant_id = $1 AND meter = $2 AND period < $3 ORDER BY period DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE",
            &[&tenant.id, &meter, &period],
        )
        .await?
        .map(|row| decimal_column(&row, 0, "previous reading"))
        .transpose()?
        .unwrap_or(opening_reading);
    if reading < previous {
        return Ok(vec![format!(
            "Chỉ số kỳ này ({reading}) nhỏ hơn chỉ số kỳ trước ({previous})"
        )]);
    }
    let consumption = reading.checked_sub(previous).ok_or_else(|| {
        crate::error::ApiError::validation(
            "utilities.meter_reading",
            vec!["Meter consumption exceeds the supported decimal range".into()],
        )
    })?;
    let Some(amount) = money::amount(consumption, rate) else {
        return Ok(vec!["Không thể tính tiền từ đơn giá công tơ".into()]);
    };
    document.insert("previous_reading".into(), decimal_json(previous)?);
    document.insert("consumption".into(), decimal_json(consumption)?);
    document.insert("rate".into(), decimal_json(rate)?);
    document.insert("amount".into(), decimal_json(amount)?);
    Ok(Vec::new())
}

async fn prepare_utility_bill(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(reading_id) = parse_id(document.get("meter_reading")) else {
        return Ok(vec!["Hóa đơn cần chỉ số công tơ hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT mr.period, mr.consumption::text, mr.rate::text, mr.amount::text, m.party FROM utilities__meter_reading mr JOIN utilities__meter m ON m.tenant_id = mr.tenant_id AND m.id = mr.meter WHERE mr.tenant_id = $1 AND mr.id = $2 FOR UPDATE OF mr, m",
            &[&tenant.id, &reading_id],
        )
        .await?
    else {
        return Ok(vec!["Chỉ số công tơ không tồn tại trong doanh nghiệp".into()]);
    };
    let period: String = row.get(0);
    let consumption = decimal_column(&row, 1, "consumption")?;
    let rate = decimal_column(&row, 2, "rate")?;
    let amount = decimal_column(&row, 3, "amount")?;
    let party: Uuid = row.get(4);
    document.insert("period".into(), Value::String(period));
    document.insert("consumption".into(), decimal_json(consumption)?);
    document.insert("unit_rate".into(), decimal_json(rate)?);
    document.insert("amount".into(), decimal_json(amount)?);
    document.insert("party".into(), Value::String(party.to_string()));
    Ok(Vec::new())
}

fn parse_id(value: Option<&Value>) -> Option<Uuid> {
    value
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
