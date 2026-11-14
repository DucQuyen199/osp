//! POS product snapshot preparation.
use crate::money;
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// Snapshot the cash expected at close from the session opening float and its
/// completed/refunded cash orders. Called while the kernel holds the session row lock.
pub async fn prepare_action(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if entity == "pos_order" && action == "refunded" {
        if document.get("method").and_then(Value::as_str) != Some("cash") {
            return Ok(Vec::new());
        }
        let Some(original_session) = document
            .get("session")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Hoàn tiền mặt cần ca bán gốc hợp lệ".into()]);
        };
        let session = tx
            .query_opt(
                "SELECT current.id FROM pos__pos_session original JOIN pos__pos_session current ON current.tenant_id = original.tenant_id AND current.status = 'open' AND current.branch IS NOT DISTINCT FROM original.branch AND current.cashier IS NOT DISTINCT FROM original.cashier WHERE original.tenant_id = $1 AND original.id = $2 ORDER BY current.created_at DESC, current.id LIMIT 1 FOR UPDATE OF current",
                &[&tenant.id, &original_session],
            )
            .await?;
        let Some(session) = session else {
            return Ok(vec![
                "Hoàn tiền mặt cần một ca đang mở cùng chi nhánh và thu ngân với giao dịch bán gốc"
                    .into(),
            ]);
        };
        document.insert("refund_session".into(), json!(session.get::<_, Uuid>(0)));
        return Ok(Vec::new());
    }
    if entity != "pos_session" || action != "closed" {
        return Ok(Vec::new());
    }
    let Some(session_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Không xác định được ca POS cần đóng".into()]);
    };
    let opening_cash = document
        .get("opening_cash")
        .and_then(money::decimal)
        .unwrap_or_default();
    let row = tx
        .query_one_row(
            "SELECT (COALESCE((SELECT SUM(CASE WHEN status = 'completed' AND session = $2 THEN total::numeric WHEN status = 'refunded' AND refund_session = $2 THEN -total::numeric ELSE 0::numeric END) FROM pos__pos_order WHERE tenant_id = $1 AND method = 'cash' AND (session = $2 OR refund_session = $2)), 0::numeric) + COALESCE((SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'cash_in'), 0::numeric) - COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'cash_out'), 0::numeric) FROM pos__cash_movement WHERE tenant_id = $1 AND session = $2 AND status = 'posted'), 0::numeric))::text",
            &[
                &tenant.id as &(dyn tokio_postgres::types::ToSql + Sync),
                &session_id,
            ],
        )
        .await?;
    let cash_net_text: String = row.get(0);
    let Some(cash_net) = money::decimal_str(&cash_net_text) else {
        return Ok(vec!["POS cash movement total is invalid".into()]);
    };
    let Some(expected_cash) = opening_cash.checked_add(cash_net) else {
        return Ok(vec![
            "Expected POS cash exceeds the supported amount".into(),
        ]);
    };
    let counted_cash = document
        .get("closing_cash")
        .and_then(money::decimal)
        .unwrap_or_default();
    let Some(cash_difference) = counted_cash.checked_sub(expected_cash) else {
        return Ok(vec![
            "POS cash difference exceeds the supported amount".into(),
        ]);
    };
    let (Some(expected_cash), Some(cash_difference)) = (
        money::json_number(money::round_money(expected_cash)),
        money::json_number(money::round_money(cash_difference)),
    ) else {
        return Ok(vec!["POS cash total cannot be serialized".into()]);
    };
    document.insert("expected_cash".into(), expected_cash);
    document.insert("cash_difference".into(), cash_difference);
    Ok(Vec::new())
}

/// Capture product kind and stock tracking on POS lines before they become
/// immutable transaction records.
pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let is_open = document.get("status").and_then(Value::as_str) == Some("open");
    let mut total_error = false;
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        if let Some(total) = money::sum_line_totals(lines).and_then(money::json_number) {
            document.insert("total".into(), total);
        } else {
            document.remove("total");
            total_error = true;
        }
    }
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    if total_error {
        errors.push("POS order total is invalid".into());
    }
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("lines[{}] phải là một dòng hàng", index + 1));
            continue;
        };
        let Some(product_id) = line
            .get("product")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        let product = tx
            .query_opt(
                "SELECT kind, tracked, active FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product_id],
            )
            .await?;
        let Some(product) = product else {
            errors.push(format!(
                "Không tìm thấy sản phẩm ở dòng {} trong doanh nghiệp",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let tracked: Option<bool> = product.get(1);
        let active: Option<bool> = product.get(2);
        if active == Some(false) && is_open {
            errors.push(format!("Sản phẩm ở dòng {} đã ngừng hoạt động", index + 1));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        line.insert("kind".into(), json!(kind));
        line.insert("tracked".into(), json!(tracked.unwrap_or(kind == "goods")));
    }
    Ok(errors)
}
