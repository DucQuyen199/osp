//! Tenant-scoped event references and row-locked capacity enforcement.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        crate::error::ApiError::validation(
            "event_management.persistence",
            vec![format!("Stored event {field} is not a valid decimal")],
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
        "event" => validate_event(tx, tenant, action, document).await,
        "ticket" => validate_ticket(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_event(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let id = parse_id(document, "id");
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM events__ticket WHERE tenant_id = $1 AND event = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                return Ok(vec!["Sự kiện đã có vé nên không thể xóa".into()]);
            }
        }
    }
    if action == "published" {
        let Some(id) = id else {
            return Ok(vec!["Không xác định được sự kiện cần công bố".into()]);
        };
        let capacity = document
            .get("capacity")
            .and_then(money::decimal)
            .unwrap_or_default();
        let reserved: i64 = tx.query_opt(
                "SELECT count(*) FROM events__ticket WHERE tenant_id = $1 AND event = $2 AND status NOT IN ('cancelled', 'refunded') AND (status <> 'reserved' OR reservation_expires_at > now())",
            &[&tenant.id, &id],
        ).await?.map(|row| row.get(0)).unwrap_or_default();
        if Decimal::from(reserved) > capacity {
            return Ok(vec!["Sức chứa thấp hơn số vé đã được giữ chỗ".into()]);
        }
    }
    Ok(Vec::new())
}

async fn validate_ticket(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(event) = parse_id(document, "event") else {
        return Ok(vec!["Vé cần tham chiếu sự kiện hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT status, COALESCE(starts_at <= now(), true), COALESCE(now() >= starts_at - interval '2 hours' AND now() <= starts_at + interval '24 hours', false), capacity::text, ticket_price::text FROM events__event WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &event],
    ).await? else {
        return Ok(vec!["Sự kiện không tồn tại trong doanh nghiệp".into()]);
    };
    let event_status: String = row.get(0);
    let start_passed: bool = row.get(1);
    let check_in_open: bool = row.get(2);
    let capacity = decimal_column(&row, 3, "capacity")?;
    let ticket_price = decimal_column(&row, 4, "ticket price")?;
    let mut errors = Vec::new();
    let ticket_id = parse_id(document, "id");
    if action == "created" {
        let ticket_code = document
            .get("ticket_code")
            .and_then(Value::as_str)
            .filter(|code| !code.is_empty());
        let Some(ticket_code) = ticket_code else {
            return Ok(vec!["Mã vé chưa được tạo".into()]);
        };
        let code_lock = format!("events.ticket-code:{}:{ticket_code}", tenant.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&code_lock],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM events__ticket WHERE tenant_id = $1 AND lower(ticket_code) = lower($2) LIMIT 1 FOR UPDATE",
                &[&tenant.id, &ticket_code],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Mã vé đã tồn tại; hãy tạo lại lượt giữ chỗ".into()]);
        }
        if event_status != "published" {
            errors.push("Chỉ giữ chỗ cho sự kiện đang mở bán".into());
        }
        if start_passed {
            errors.push("Không thể giữ vé sau thời điểm sự kiện bắt đầu".into());
        }
        let count: i64 = tx.query_opt(
            "SELECT count(*) FROM events__ticket WHERE tenant_id = $1 AND event = $2 AND status NOT IN ('cancelled', 'refunded') AND (status <> 'reserved' OR reservation_expires_at > now())",
            &[&tenant.id, &event],
        ).await?.map(|row| row.get(0)).unwrap_or_default();
        if Decimal::from(count) >= capacity {
            errors.push("Sự kiện đã hết chỗ".into());
        }
    }
    if matches!(action, "updated" | "sold")
        && event_status != "published"
        && !(action == "updated"
            && event_status == "closed"
            && document.get("status").and_then(Value::as_str) == Some("sold"))
    {
        errors.push("Chỉ cập nhật hoặc bán vé khi sự kiện còn mở bán".into());
    }
    if action == "sold" {
        let reservation_valid = if let Some(ticket_id) = ticket_id {
            tx.query_opt(
                "SELECT reservation_expires_at IS NOT NULL AND reservation_expires_at > now() FROM events__ticket WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                &[&tenant.id, &ticket_id],
            )
            .await?
            .is_some_and(|row| row.get::<_, bool>(0))
        } else {
            false
        };
        if !reservation_valid {
            errors
                .push("Chỗ giữ vé đã hết hạn; hãy tạo lượt giữ vé mới trước khi thanh toán".into());
        }
        let price = document
            .get("price")
            .and_then(money::decimal)
            .unwrap_or_default();
        if !money::within_tolerance(price, ticket_price, Decimal::new(5, 3)) {
            errors.push("Giá trên vé phải khớp giá đã công bố của sự kiện".into());
        }
        if let Some(party) = parse_id(document, "party") {
            if tx
                .query_opt(
                    "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &party],
                )
                .await?
                .is_none()
            {
                errors.push("Người mua vé không tồn tại trong doanh nghiệp".into());
            }
        }
    }
    if action == "checked_in" {
        if event_status == "draft" {
            errors.push("Không thể check-in một sự kiện chưa công bố".into());
        }
        if !check_in_open {
            errors.push("Check-in chỉ mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu".into());
        }
    }
    if action == "refunded" {
        if document.get("status").and_then(Value::as_str) != Some("sold") {
            errors.push("Chỉ được hoàn vé đã bán và chưa check-in".into());
        }
        if start_passed {
            errors.push("Chỉ được hoàn vé trước giờ bắt đầu sự kiện".into());
        }
        if !tenant.has_module("accounting") {
            errors.push("Cần bật module kế toán để ghi nhận hoàn tiền vé".into());
        }
    }
    if action == "cancelled" && document.get("status").and_then(Value::as_str) != Some("reserved") {
        errors.push("Chỉ hủy vé đang giữ chỗ; vé đã bán cần quy trình hoàn tiền".into());
    }
    if action == "removed" && ticket_id.is_some() {
        errors.push("Vé cần được hủy qua action để giữ lịch sử".into());
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
