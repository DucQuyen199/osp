use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use uuid::Uuid;

pub async fn transaction_exists(
    tx: &Tx<'_>,
    tenant: &Tenant,
    source: &str,
    source_id: &str,
) -> R<bool> {
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&format!(
            "loyalty.source:{}:{}:{}",
            tenant.id, source, source_id
        )],
    )
    .await?;
    Ok(tx
        .query_opt(
            "SELECT 1 FROM loyalty__point_txn WHERE tenant_id = $1 AND source = $2 AND source_id = $3 LIMIT 1",
            &[&tenant.id, &source, &source_id],
        )
        .await?
        .is_some())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &serde_json::Value,
) -> R<Vec<String>> {
    if entity != "member" || action != "removed" {
        return Ok(Vec::new());
    }
    let party = document
        .get("party")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(party) = party else {
        return Ok(vec!["Không xác định được khách hàng của thành viên".into()]);
    };
    let has_history = tx
        .query_opt(
            "SELECT 1 FROM loyalty__point_txn WHERE tenant_id = $1 AND party = $2 LIMIT 1",
            &[&tenant.id, &party],
        )
        .await?
        .is_some();
    Ok(if has_history {
        vec!["Thành viên có lịch sử điểm phải được giữ lại".into()]
    } else {
        Vec::new()
    })
}

/// Compute only the additional points reversal needed for one newly received
/// sales return. Total reversals are cumulative and never exceed earned points.
pub async fn sales_return_reversal(
    tx: &Tx<'_>,
    tenant: &Tenant,
    return_id: Uuid,
) -> R<Option<(Uuid, Decimal)>> {
    let Some(source) = tx
        .query_opt(
            "SELECT sr.sales_order, so.party FROM sales__sales_return sr JOIN sales__sales_order so ON so.tenant_id = sr.tenant_id AND so.id = sr.sales_order WHERE sr.tenant_id = $1 AND sr.id = $2 AND sr.status = 'received' FOR UPDATE OF so",
            &[&tenant.id, &return_id],
        )
        .await?
    else {
        return Ok(None);
    };
    let order_id: Uuid = source.get(0);
    let party: Uuid = source.get(1);
    let Some(earned_text) = tx
        .query_opt(
            "SELECT points::text FROM loyalty__point_txn WHERE tenant_id = $1 AND party = $2 AND source = 'sales_order' AND source_id = $3 LIMIT 1",
            &[&tenant.id, &party, &order_id.to_string()],
        )
        .await?
        .map(|row| row.get::<_, String>(0))
    else {
        return Ok(None);
    };
    let earned = money::decimal_str(&earned_text).ok_or_else(|| {
        ApiError::validation(
            "loyalty.point_txn.points",
            vec!["Earned points are not a valid decimal value".into()],
        )
    })?;
    let returned_value_text: String = tx
        .query_one_row(
            "SELECT COALESCE(SUM(total), 0)::text FROM sales__sales_return WHERE tenant_id = $1 AND sales_order = $2 AND status = 'received'",
            &[&tenant.id, &order_id],
        )
        .await?
        .get(0);
    let returned_value = money::decimal_str(&returned_value_text).ok_or_else(|| {
        ApiError::validation(
            "loyalty.sales_return.total",
            vec!["Returned sales value is not a valid decimal amount".into()],
        )
    })?;
    let already_reversed_text: String = tx
        .query_one_row(
            "SELECT COALESCE(SUM(GREATEST(-pt.points, 0)), 0)::text FROM loyalty__point_txn pt JOIN sales__sales_return sr ON sr.tenant_id = pt.tenant_id AND sr.id::text = pt.source_id WHERE pt.tenant_id = $1 AND pt.party = $2 AND pt.source = 'sales_return' AND sr.sales_order = $3 AND sr.status = 'received'",
            &[&tenant.id, &party, &order_id],
        )
        .await?
        .get(0);
    let already_reversed = money::decimal_str(&already_reversed_text).ok_or_else(|| {
        ApiError::validation(
            "loyalty.point_txn.reversed",
            vec!["Previously reversed points are not a valid decimal value".into()],
        )
    })?;
    let desired_reversal = returned_value
        .checked_div(Decimal::new(10_000, 0))
        .map(|points| points.floor())
        .map(|points| earned.min(points))
        .ok_or_else(|| {
            ApiError::validation(
                "loyalty.sales_return.total",
                vec!["Return-derived point reversal exceeds the supported decimal range".into()],
            )
        })?;
    let additional = desired_reversal
        .checked_sub(already_reversed)
        .ok_or_else(|| {
            ApiError::validation(
                "loyalty.point_txn.reversed",
                vec!["Additional point reversal exceeds the supported decimal range".into()],
            )
        })?;
    if additional <= Decimal::ZERO {
        return Ok(None);
    }
    Ok(Some((party, additional)))
}

pub async fn lock_member(tx: &Tx<'_>, tenant: &Tenant, party: Uuid) -> R<Option<(Uuid, Decimal)>> {
    let Some(row) = tx
        .query_opt(
            "SELECT id, COALESCE(points, 0)::text FROM loyalty__member WHERE tenant_id = $1 AND party = $2 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &party],
        )
        .await?
    else {
        return Ok(None);
    };
    let points_text: String = row.get(1);
    let points = money::decimal_str(&points_text).ok_or_else(|| {
        ApiError::validation(
            "loyalty.member.points",
            vec!["Member point balance is not a valid decimal value".into()],
        )
    })?;
    Ok(Some((row.get(0), points)))
}
