use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    if entity == "voucher"
        && let Some(code) = document.get("code").and_then(Value::as_str)
    {
        document.insert(
            "code".into(),
            Value::String(code.trim().to_ascii_uppercase()),
        );
    }
}

/// Apply a single-use loyalty voucher to normalized sales lines. The discount
/// is distributed before tax, so the adjusted line tax and total remain valid.
pub async fn apply_to_order(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    for field in ["voucher_discount"] {
        document.remove(field);
    }
    if let Some(lines) = document.get_mut("lines").and_then(Value::as_array_mut) {
        for line in lines.iter_mut().filter_map(Value::as_object_mut) {
            for field in ["voucher_discount_amount", "effective_discount_pct"] {
                line.remove(field);
            }
        }
    }
    let Some(raw_code) = document.get("voucher_code").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    if !tenant.has_module("loyalty") {
        return Ok(vec![
            "Cần bật module Khách hàng thân thiết để sử dụng voucher".into(),
        ]);
    }
    let code = raw_code.trim().to_ascii_uppercase();
    if code.is_empty() {
        document.remove("voucher_code");
        return Ok(Vec::new());
    }
    document.insert("voucher_code".into(), Value::String(code.clone()));
    let Some(row) = tx.query_opt(
        "SELECT id, percent::text, amount::text, valid_until, COALESCE(used, false) FROM loyalty__voucher WHERE tenant_id = $1 AND upper(code) = $2 FOR UPDATE",
        &[&tenant.id, &code],
    ).await? else {
        return Ok(vec!["Không tìm thấy voucher còn hiệu lực với mã này".into()]);
    };
    if row.get::<_, bool>(4) {
        return Ok(vec!["Voucher này đã được sử dụng".into()]);
    }
    let valid_until: Option<chrono::NaiveDate> = row.get(3);
    if valid_until.is_some_and(|date| date < tenant.business_today()) {
        return Ok(vec!["Voucher đã hết hạn".into()]);
    }
    let party = document
        .get("party")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let Some(party) = party else {
        return Ok(vec![
            "Cần chọn khách hàng thành viên để dùng voucher".into(),
        ]);
    };
    if tx
        .query_opt(
            "SELECT id FROM loyalty__member WHERE tenant_id = $1 AND party = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        return Ok(vec![
            "Voucher chỉ áp dụng cho khách hàng đã đăng ký thành viên".into(),
        ]);
    }
    let percent = row
        .get::<_, Option<String>>(1)
        .as_deref()
        .and_then(money::decimal_str);
    let fixed = row
        .get::<_, Option<String>>(2)
        .as_deref()
        .and_then(money::decimal_str);
    let lines = document.get_mut("lines").and_then(Value::as_array_mut);
    let Some(lines) = lines else {
        return Ok(vec!["Voucher chỉ áp dụng cho đơn có dòng hàng".into()]);
    };
    let eligible = lines
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|line| line.get("net_amount").and_then(money::decimal))
        .try_fold(Decimal::ZERO, |sum, value| sum.checked_add(value));
    let Some(eligible) = eligible else {
        return Ok(vec![
            "Tổng tiền đủ điều kiện vượt giới hạn tính toán".into(),
        ]);
    };
    if eligible <= Decimal::ZERO {
        return Ok(vec![
            "Đơn hàng không có giá trị đủ điều kiện áp dụng voucher".into(),
        ]);
    }
    let discount = if let Some(percent) = percent {
        eligible
            .checked_mul(percent)
            .and_then(|value| value.checked_div(Decimal::ONE_HUNDRED))
            .map(money::round_money)
    } else if let Some(fixed) = fixed {
        Some(money::round_money(fixed.min(eligible)))
    } else {
        None
    };
    let Some(discount) = discount.filter(|amount| *amount > Decimal::ZERO) else {
        return Ok(vec!["Cấu hình giảm giá của voucher không hợp lệ".into()]);
    };
    if discount >= eligible {
        return Ok(vec![
            "Voucher không thể giảm toàn bộ giá trị đơn; giá trị thanh toán phải còn lớn hơn 0"
                .into(),
        ]);
    }
    let eligible_lines = lines
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let line = value.as_object()?;
            let net = line.get("net_amount").and_then(money::decimal)?;
            (net > Decimal::ZERO).then_some((index, net))
        })
        .collect::<Vec<_>>();
    let mut remaining = discount;
    let mut updated_total = Decimal::ZERO;
    let mut updated_tax = Decimal::ZERO;
    for (position, (index, base_net)) in eligible_lines.iter().enumerate() {
        let proposed = if position + 1 == eligible_lines.len() {
            remaining
        } else {
            let Some(share) = discount
                .checked_mul(*base_net)
                .and_then(|value| value.checked_div(eligible))
            else {
                return Ok(vec![
                    "Không thể phân bổ voucher do vượt giới hạn tính toán".into(),
                ]);
            };
            money::round_money(share)
        };
        let allocated = proposed.min(remaining).min(*base_net);
        let Some(next_remaining) = remaining.checked_sub(allocated) else {
            return Ok(vec!["Không thể phân bổ chính xác giá trị voucher".into()]);
        };
        remaining = next_remaining;
        let Some(line) = lines[*index].as_object_mut() else {
            return Ok(vec!["Dòng hàng không hợp lệ khi áp dụng voucher".into()]);
        };
        let Some(qty) = line.get("qty").and_then(money::decimal) else {
            return Ok(vec![
                "Số lượng dòng hàng không hợp lệ khi áp dụng voucher".into(),
            ]);
        };
        let Some(price) = line.get("price").and_then(money::decimal) else {
            return Ok(vec![
                "Đơn giá dòng hàng không hợp lệ khi áp dụng voucher".into(),
            ]);
        };
        let rate = line
            .get("tax_rate")
            .and_then(money::decimal)
            .unwrap_or(Decimal::ZERO);
        let Some(gross) = qty.checked_mul(price).map(money::round_money) else {
            return Ok(vec![
                "Tổng dòng hàng vượt giới hạn tính toán voucher".into(),
            ]);
        };
        let Some(net) = base_net.checked_sub(allocated).map(money::round_money) else {
            return Ok(vec![
                "Giá trị giảm voucher trên dòng hàng không hợp lệ".into(),
            ]);
        };
        let Some(tax) = net
            .checked_mul(rate)
            .and_then(|value| value.checked_div(Decimal::ONE_HUNDRED))
            .map(money::round_money)
        else {
            return Ok(vec!["Không thể tính thuế sau khi áp dụng voucher".into()]);
        };
        let Some(line_total) = net.checked_add(tax).map(money::round_money) else {
            return Ok(vec!["Không thể tính tổng dòng hàng sau voucher".into()]);
        };
        let Some(actual_discount) = gross.checked_sub(net) else {
            return Ok(vec!["Không thể tính số tiền giảm voucher".into()]);
        };
        let effective_pct = if gross > Decimal::ZERO {
            actual_discount
                .checked_mul(Decimal::ONE_HUNDRED)
                .and_then(|value| value.checked_div(gross))
                .ok_or_else(|| {
                    crate::error::ApiError::validation(
                        "loyalty.voucher",
                        vec!["Tỷ lệ giảm voucher vượt giới hạn tính toán".into()],
                    )
                })?
        } else {
            Decimal::ZERO
        };
        let (
            Some(allocated_value),
            Some(effective_value),
            Some(discount_value),
            Some(net_value),
            Some(tax_value),
            Some(total_value),
        ) = (
            money::json_number(allocated),
            money::json_number(effective_pct),
            money::json_number(actual_discount),
            money::json_number(net),
            money::json_number(tax),
            money::json_number(line_total),
        )
        else {
            return Ok(vec![
                "Giá trị voucher hoặc dòng hàng vượt phạm vi lưu trữ".into(),
            ]);
        };
        line.insert("voucher_discount_amount".into(), allocated_value);
        line.insert("effective_discount_pct".into(), effective_value);
        line.insert("discount_amount".into(), discount_value);
        line.insert("net_amount".into(), net_value);
        line.insert("tax_amount".into(), tax_value);
        line.insert("line_total".into(), total_value);
        let Some(total) = updated_total.checked_add(line_total) else {
            return Ok(vec!["Tổng đơn sau voucher vượt giới hạn tính toán".into()]);
        };
        let Some(tax_total) = updated_tax.checked_add(tax) else {
            return Ok(vec!["Thuế đơn sau voucher vượt giới hạn tính toán".into()]);
        };
        updated_total = total;
        updated_tax = tax_total;
    }
    if remaining > Decimal::ZERO {
        return Ok(vec![
            "Không thể phân bổ chính xác toàn bộ giá trị voucher vào các dòng hàng".into(),
        ]);
    }
    for value in lines.iter() {
        let Some(line) = value.as_object() else {
            continue;
        };
        if line.get("voucher_discount_amount").is_none() {
            if let Some(total) = line.get("line_total").and_then(money::decimal) {
                let Some(next) = updated_total.checked_add(total) else {
                    return Ok(vec!["Tổng đơn sau voucher vượt giới hạn tính toán".into()]);
                };
                updated_total = next;
            }
            if let Some(tax) = line.get("tax_amount").and_then(money::decimal) {
                let Some(next) = updated_tax.checked_add(tax) else {
                    return Ok(vec!["Thuế đơn sau voucher vượt giới hạn tính toán".into()]);
                };
                updated_tax = next;
            }
        }
    }
    let (Some(discount_value), Some(total_value), Some(tax_value)) = (
        money::json_number(discount),
        money::json_number(updated_total),
        money::json_number(updated_tax),
    ) else {
        return Ok(vec!["Tổng voucher không thể lưu trữ".into()]);
    };
    document.insert("voucher_discount".into(), discount_value);
    document.insert("total".into(), total_value);
    document.insert("tax_total".into(), tax_value);
    Ok(Vec::new())
}

/// Redeem the voucher inside the sale transaction, after the sale action has
/// passed validation. The locked, tenant-scoped row prevents concurrent reuse.
pub async fn redeem_for_order(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
    source: &str,
    opts: &Opts,
) -> R<Vec<String>> {
    let Some(code) = document
        .get("voucher_code")
        .and_then(Value::as_str)
        .map(|code| code.trim().to_ascii_uppercase())
        .filter(|code| !code.is_empty())
    else {
        return Ok(Vec::new());
    };
    if !tenant.has_module("loyalty") {
        return Ok(vec![
            "Cần bật module Khách hàng thân thiết để sử dụng voucher".into(),
        ]);
    }
    let Some(order_id) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec![
            "Đơn hàng cần mã hợp lệ để ghi nhận việc dùng voucher".into(),
        ]);
    };
    let Some(row) = tx.query_opt(
        "SELECT id, COALESCE(used, false) FROM loyalty__voucher WHERE tenant_id = $1 AND upper(code) = $2 FOR UPDATE",
        &[&tenant.id, &code],
    ).await? else { return Ok(vec!["Không tìm thấy voucher để ghi nhận sử dụng".into()]); };
    if row.get::<_, bool>(1) {
        return Ok(vec![
            "Voucher đã được sử dụng bởi một giao dịch khác".into(),
        ]);
    }
    let voucher_id: Uuid = row.get(0);
    let entity = kernel.ent(tenant, "loyalty.voucher")?;
    let mut patch = Map::new();
    patch.insert("used".into(), json!(true));
    patch.insert("redeemed_source".into(), json!(source));
    patch.insert("redeemed_order".into(), json!(order_id));
    let child = Opts {
        depth: opts.depth.map(|depth| depth + 1),
        causation: opts.causation,
        silent: opts.silent,
    };
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            &voucher_id.to_string(),
            patch,
            &child,
        )
        .await?;
    Ok(Vec::new())
}
