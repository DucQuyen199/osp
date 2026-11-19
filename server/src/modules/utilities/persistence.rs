//! Tenant-scoped meter references, period uniqueness, and invoice settlement.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "utilities.persistence",
            vec![format!("Stored utility {field} is not a valid decimal")],
        )
    })
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "meter" => validate_meter(tx, tenant, action, document).await,
        "meter_reading" => validate_reading(tx, tenant, document).await,
        "utility_bill" => validate_bill(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_meter(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let id = parse_id(document, "id");
    let Some(party) = parse_id(document, "party") else {
        return Ok(vec!["Chủ hợp đồng công tơ phải hợp lệ".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Chủ hợp đồng công tơ không tồn tại trong doanh nghiệp".into());
    }
    let code = document
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let normalized_code: String = tx
        .query_opt("SELECT lower(btrim($1::text))", &[&code])
        .await?
        .ok_or_else(|| crate::error::ApiError::internal("Unable to normalize utility meter code"))?
        .get(0);
    let lock_key = format!("utilities.meter-code:{}:{}", tenant.id, normalized_code);
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&lock_key],
    )
    .await?;
    if tx
        .query_opt(
            "SELECT id FROM utilities__meter WHERE tenant_id = $1 AND lower(btrim(code)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &code, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Mã công tơ đã tồn tại trong doanh nghiệp".into());
    }
    if action == "updated" {
        if let Some(id) = id {
            let has_readings = tx
                .query_opt(
                    "SELECT id FROM utilities__meter_reading WHERE tenant_id = $1 AND meter = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some();
            if has_readings {
                if let Some(old) = tx
                    .query_opt(
                        "SELECT party, code, COALESCE(opening_reading, 0)::text FROM utilities__meter WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &id],
                    )
                    .await?
                {
                    let old_party: Uuid = old.get(0);
                    let old_code: String = old.get(1);
                    let old_opening_reading = decimal_column(&old, 2, "opening reading")?;
                    let opening_reading = document
                        .get("opening_reading")
                        .and_then(money::decimal)
                        .unwrap_or_default();
                    if party != old_party
                        || !code.eq_ignore_ascii_case(&old_code)
                        || !money::within_tolerance(
                            opening_reading,
                            old_opening_reading,
                            Decimal::new(1, 6),
                        )
                    {
                        errors.push("Chủ hợp đồng và mã công tơ không thể đổi sau khi có lịch sử đo".into());
                    }
                }
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx
                .query_opt(
                    "SELECT id FROM utilities__meter_reading WHERE tenant_id = $1 AND meter = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &id],
                )
                .await?
                .is_some()
            {
                errors.push("Công tơ có lịch sử đo nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_reading(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(meter) = parse_id(document, "meter") else {
        return Ok(vec!["Chỉ số cần công tơ hợp lệ".into()]);
    };
    let Some(period) = document.get("period").and_then(Value::as_str) else {
        return Ok(vec!["Chỉ số cần kỳ YYYY-MM hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    let Some(row) = tx
        .query_opt(
            "SELECT rate::text, COALESCE(fixed_charge, 0)::text, COALESCE(tariff_tiers, '[]'::jsonb), COALESCE(opening_reading, 0)::text FROM utilities__meter WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &meter],
        )
        .await?
    else {
        return Ok(vec!["Công tơ không tồn tại trong doanh nghiệp".into()]);
    };
    let expected_rate = decimal_column(&row, 0, "meter rate")?;
    let expected_fixed_charge = decimal_column(&row, 1, "fixed charge")?;
    let expected_tiers: Value = row.get(2);
    let opening_reading = decimal_column(&row, 3, "opening reading")?;
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM utilities__meter_reading WHERE tenant_id = $1 AND meter = $2 AND period = $3 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &meter, &period, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Mỗi công tơ chỉ được có một chỉ số trong một kỳ".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM utilities__meter_reading WHERE tenant_id = $1 AND meter = $2 AND period > $3 AND ($4::uuid IS NULL OR id <> $4) ORDER BY period ASC LIMIT 1 FOR UPDATE",
            &[&tenant.id, &meter, &period, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Không thể ghi bổ sung kỳ cũ sau khi đã có kỳ mới vì sẽ làm sai mức tiêu thụ và hóa đơn đã chốt".into());
    }
    let reading = document
        .get("reading")
        .and_then(money::decimal)
        .unwrap_or_default();
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
        errors.push("Chỉ số không thể thấp hơn kỳ đo trước".into());
    }
    let captured_rate = document
        .get("rate")
        .and_then(money::decimal)
        .unwrap_or_default();
    if !money::within_tolerance(captured_rate, expected_rate, Decimal::new(1, 4)) {
        errors.push("Đơn giá chụp trên chỉ số không khớp đơn giá công tơ tại thời điểm ghi".into());
    }
    let captured_fixed_charge = document
        .get("fixed_charge")
        .and_then(money::decimal)
        .unwrap_or_default();
    if !money::within_tolerance(
        captured_fixed_charge,
        expected_fixed_charge,
        Decimal::new(1, 4),
    ) {
        errors.push("Phí cố định chụp không khớp cấu hình công tơ".into());
    }
    if document.get("tariff_tiers") != Some(&expected_tiers) {
        errors.push("Bậc giá chụp không khớp cấu hình công tơ".into());
    }
    Ok(errors)
}

async fn validate_bill(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(reading) = parse_id(document, "meter_reading") else {
        return Ok(vec!["Hóa đơn cần chỉ số công tơ hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    let Some(row) = tx
        .query_opt(
            "SELECT m.party FROM utilities__meter_reading mr JOIN utilities__meter m ON m.tenant_id = mr.tenant_id AND m.id = mr.meter WHERE mr.tenant_id = $1 AND mr.id = $2 FOR UPDATE OF mr, m",
            &[&tenant.id, &reading],
        )
        .await?
    else {
        return Ok(vec!["Chỉ số công tơ không tồn tại trong doanh nghiệp".into()]);
    };
    let party: Uuid = row.get(0);
    if parse_id(document, "party") != Some(party) {
        errors.push("Khách hàng trên hóa đơn phải trùng chủ hợp đồng công tơ".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM utilities__utility_bill WHERE tenant_id = $1 AND meter_reading = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &reading, &id],
        )
        .await?
        .is_some()
    {
        errors.push("Chỉ số công tơ đã được lập hóa đơn".into());
    }
    if action == "paid" {
        let bill_id = id.ok_or_else(|| {
            crate::error::ApiError::validation(
                "utilities.utility_bill",
                vec!["Không xác định được hóa đơn".into()],
            )
        })?;
        if tx
            .query_opt(
                "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND source = 'utility_bill' AND source_id = $2 AND status = 'paid' LIMIT 1 FOR UPDATE",
                &[&tenant.id, &bill_id.to_string()],
            )
            .await?
            .is_none()
        {
            errors.push("Chỉ đánh dấu đã thanh toán sau khi hóa đơn kế toán đã được thu đủ".into());
        }
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}
