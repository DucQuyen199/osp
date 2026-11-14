//! POS product snapshot preparation.
use crate::money;
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
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
    let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) else {
        return Ok(Vec::new());
    };
    let mut errors = Vec::new();
    let mut total = Decimal::ZERO;
    let mut tax_total = Decimal::ZERO;
    for (index, line) in lines.iter_mut().enumerate() {
        let Some(line) = line.as_object_mut() else {
            errors.push(format!("POS line {} must be an object", index + 1));
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
                "SELECT kind, tracked, active, price::text, tax FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &product_id],
            )
            .await?;
        let Some(product) = product else {
            errors.push(format!(
                "POS product on line {} was not found in this tenant",
                index + 1
            ));
            continue;
        };
        let kind: Option<String> = product.get(0);
        let tracked: Option<bool> = product.get(1);
        let active: Option<bool> = product.get(2);
        let price_text: Option<String> = product.get(3);
        let tax_id: Option<Uuid> = product.get(4);
        if active == Some(false) && is_open {
            errors.push(format!("POS product on line {} is inactive", index + 1));
        }
        let Some(price) = price_text
            .as_deref()
            .and_then(money::decimal_str)
            .filter(|price| *price >= Decimal::ZERO)
        else {
            errors.push(format!(
                "POS product on line {} needs a valid catalog selling price",
                index + 1
            ));
            continue;
        };
        let Some(qty) = line
            .get("qty")
            .and_then(money::decimal)
            .filter(|qty| *qty > Decimal::ZERO)
        else {
            errors.push(format!("POS line {} needs a positive quantity", index + 1));
            continue;
        };
        let (tax_rate, tax_name) = if let Some(tax_id) = tax_id {
            let Some(tax) = tx
                .query_opt(
                    "SELECT name, rate::text FROM master_data__tax WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                    &[&tenant.id, &tax_id],
                )
                .await?
            else {
                errors.push(format!("POS tax on line {} was not found in this tenant", index + 1));
                continue;
            };
            let name: String = tax.get(0);
            let rate_text: String = tax.get(1);
            let Some(rate) = money::decimal_str(&rate_text)
                .filter(|rate| (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(rate))
            else {
                errors.push(format!("POS tax rate on line {} is invalid", index + 1));
                continue;
            };
            (rate, Some(name))
        } else {
            (Decimal::ZERO, None)
        };
        let Some((discount, net, line_tax, line_total)) =
            money::line_amounts(qty, price, Decimal::ZERO, tax_rate)
        else {
            errors.push(format!(
                "POS line {} exceeds supported amount limits",
                index + 1
            ));
            continue;
        };
        let (
            Some(price_value),
            Some(rate_value),
            Some(discount_value),
            Some(net_value),
            Some(tax_value),
            Some(total_value),
        ) = (
            money::json_number(price),
            money::json_number(tax_rate),
            money::json_number(discount),
            money::json_number(net),
            money::json_number(line_tax),
            money::json_number(line_total),
        )
        else {
            errors.push(format!(
                "POS line {} amounts cannot be represented",
                index + 1
            ));
            continue;
        };
        for field in [
            "discount_amount",
            "net_amount",
            "tax_rate",
            "tax_name",
            "tax_amount",
            "line_total",
        ] {
            line.remove(field);
        }
        line.insert("price".into(), price_value);
        line.insert("discount_pct".into(), json!(0));
        line.insert("discount_amount".into(), discount_value);
        line.insert("net_amount".into(), net_value);
        line.insert("tax_rate".into(), rate_value);
        line.insert("tax_amount".into(), tax_value);
        line.insert("line_total".into(), total_value);
        if let Some(tax_id) = tax_id {
            line.insert("tax".into(), json!(tax_id));
        } else {
            line.remove("tax");
        }
        if let Some(tax_name) = tax_name {
            line.insert("tax_name".into(), json!(tax_name));
        }
        let kind = kind.unwrap_or_else(|| "goods".into());
        line.insert("kind".into(), json!(kind));
        line.insert("tracked".into(), json!(tracked.unwrap_or(kind == "goods")));
        let Some(next_total) = total.checked_add(line_total) else {
            errors.push("POS order total exceeds the supported amount range".into());
            continue;
        };
        let Some(next_tax_total) = tax_total.checked_add(line_tax) else {
            errors.push("POS tax total exceeds the supported amount range".into());
            continue;
        };
        total = next_total;
        tax_total = next_tax_total;
    }
    let (Some(total), Some(tax_total)) = (money::json_number(total), money::json_number(tax_total))
    else {
        errors.push("POS order totals cannot be represented".into());
        return Ok(errors);
    };
    document.insert("total".into(), total);
    document.insert("tax_total".into(), tax_total);
    Ok(errors)
}
