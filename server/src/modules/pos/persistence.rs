//! Tenant-scoped POS session and warehouse checks.
use crate::money;
use crate::{db::Tx, error::R, kernel::Tenant};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;
pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    if entity == "pos_session" && action == "created" {
        let warehouse = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(warehouse) = warehouse else {
            return Ok(vec!["POS session requires a valid warehouse".into()]);
        };
        if tx
            .query_opt(
                "SELECT id FROM inventory__warehouse WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &warehouse],
            )
            .await?
            .is_none()
        {
            return Ok(vec!["POS warehouse was not found in this tenant".into()]);
        }
        let branch = document
            .get("branch")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let cashier = document
            .get("cashier")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase);
        let lock_key = format!("{}:pos-session:{branch:?}:{cashier:?}", tenant.id);
        tx.query_one_row(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT id FROM pos__pos_session WHERE tenant_id = $1 AND status = 'open' AND branch IS NOT DISTINCT FROM $2 AND lower(btrim(cashier)) IS NOT DISTINCT FROM $3 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &branch, &cashier],
            )
            .await?
            .is_some()
        {
            return Ok(vec!["Chá»‰ Ä‘Æ°á»£c má»Ÿ má»™t ca POS cho má»—i chi nhÃ¡nh vÃ  thu ngÃ¢n".into()]);
        }
    }
    if entity == "pos_session" && action == "closed" {
        let Some(session_id) = document
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return Ok(vec!["Không xác định được ca POS cần đóng".into()]);
        };
        let has_unfinished_work = tx
            .query_opt(
                "SELECT 1 WHERE EXISTS (SELECT 1 FROM pos__pos_order WHERE tenant_id = $1 AND session = $2 AND status = 'open') OR EXISTS (SELECT 1 FROM pos__cash_movement WHERE tenant_id = $1 AND session = $2 AND status = 'draft')",
                &[&tenant.id, &session_id],
            )
            .await?
            .is_some();
        return Ok(if has_unfinished_work {
            vec!["Không thể đóng ca khi còn đơn hàng hoặc phiếu thu chi nháp".into()]
        } else {
            Vec::new()
        });
    }
    if entity == "pos_order"
        && action == "refunded"
        && document.get("method").and_then(Value::as_str) == Some("cash")
    {
        let refund_session = document
            .get("refund_session")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let original_session = document
            .get("session")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let (Some(refund_session), Some(original_session)) = (refund_session, original_session)
        else {
            return Ok(vec![
                "Hoàn tiền mặt cần ca hoàn tiền và ca bán gốc hợp lệ".into(),
            ]);
        };
        let eligible = tx
            .query_opt(
                "SELECT current.id FROM pos__pos_session original JOIN pos__pos_session current ON current.tenant_id = original.tenant_id AND current.id = $3 AND current.status = 'open' AND current.branch IS NOT DISTINCT FROM original.branch AND lower(btrim(current.cashier)) IS NOT DISTINCT FROM lower(btrim(original.cashier)) WHERE original.tenant_id = $1 AND original.id = $2 FOR UPDATE OF current",
                &[&tenant.id, &original_session, &refund_session],
            )
            .await?
            .is_some();
        if !eligible {
            return Ok(vec![
                "Ca hoàn tiền phải đang mở và trùng chi nhánh, thu ngân với giao dịch bán gốc"
                    .into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity == "cash_movement" && matches!(action, "created" | "updated" | "posted") {
        let session_id = document
            .get("session")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(session_id) = session_id else {
            return Ok(vec!["Phiếu thu chi cần ca POS hợp lệ".into()]);
        };
        let session = tx
            .query_opt(
                "SELECT status FROM pos__pos_session WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &session_id],
            )
            .await?;
        if !session.is_some_and(|row| row.get::<_, String>(0) == "open") {
            return Ok(vec![
                "Chỉ được lập hoặc ghi sổ thu chi trong ca đang mở".into(),
            ]);
        }
        let account_id = document
            .get("offset_account")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(account_id) = account_id else {
            return Ok(vec!["Phiếu thu chi cần tài khoản đối ứng hợp lệ".into()]);
        };
        let account = tx
            .query_opt(
                "SELECT code FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &account_id],
            )
            .await?;
        let Some(account) = account else {
            return Ok(vec![
                "Không tìm thấy tài khoản đối ứng trong doanh nghiệp".into(),
            ]);
        };
        let code: String = account.get(0);
        if matches!(code.as_str(), "111" | "112") {
            return Ok(vec![
                "Tài khoản đối ứng phải khác tài khoản tiền mặt/ngân hàng".into(),
            ]);
        }
        return Ok(Vec::new());
    }
    if entity != "pos_order" || !matches!(action, "created" | "updated" | "completed") {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    let Some(session_id) = document
        .get("session")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(vec!["Đơn POS phải thuộc một ca bán hàng hợp lệ".into()]);
    };
    let session = tx
        .query_opt(
            "SELECT status FROM pos__pos_session WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &session_id],
        )
        .await?;
    if !session.is_some_and(|row| row.get::<_, String>(0) == "open") {
        errors.push("Chỉ được tạo hoặc cập nhật đơn trong ca POS đang mở".into());
    }
    let session_location = tx
        .query_opt(
            "SELECT warehouse, branch FROM pos__pos_session WHERE tenant_id = $1 AND id = $2",
            &[&tenant.id, &session_id],
        )
        .await?;
    if let Some(session_location) = session_location {
        let session_warehouse: Option<Uuid> = session_location.get(0);
        let session_branch: Option<Uuid> = session_location.get(1);
        let order_warehouse = document
            .get("warehouse")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let order_branch = document
            .get("branch")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        if session_warehouse.is_none() || order_warehouse != session_warehouse {
            errors.push("Kho của đơn POS phải trùng với kho của ca bán hàng".into());
        }
        if order_branch != session_branch {
            errors.push("Chi nhánh của đơn POS phải trùng với chi nhánh của ca bán hàng".into());
        }
    }
    if let Some(lines) = document.get("lines").and_then(Value::as_array) {
        for (index, line) in lines.iter().enumerate() {
            let product_id = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let exists = if let Some(product_id) = product_id {
                tx.query_opt(
                    "SELECT 1 FROM master_data__product WHERE tenant_id = $1 AND id = $2",
                    &[&tenant.id, &product_id],
                )
                .await?
                .is_some()
            } else {
                false
            };
            if !exists {
                errors.push(format!(
                    "lines[{}].product không tồn tại trong tenant",
                    index + 1
                ));
            }
        }
    }
    // Pharmacy checks are activated only for prescriptions linked to the
    // dedicated pharmacy module. The prescription row lock serializes checkout
    // attempts so cumulative partial fills cannot exceed the prescription.
    if tenant.has_module("pharmacy") {
        let prescription_id = document
            .get("prescription")
            .and_then(Value::as_str)
            .and_then(|v| Uuid::parse_str(v).ok());
        let mut rx_required = Vec::<(Uuid, Decimal)>::new();
        if let Some(lines) = document.get("lines").and_then(Value::as_array) {
            for line in lines {
                let Some(pid) = line
                    .get("product")
                    .and_then(Value::as_str)
                    .and_then(|v| Uuid::parse_str(v).ok())
                else {
                    continue;
                };
                let row = tx.query_opt("SELECT custom FROM master_data__product WHERE tenant_id=$1 AND id=$2 FOR SHARE", &[&tenant.id, &pid]).await?;
                if let Some(row) = row {
                    let custom: Value = row.get(0);
                    if custom
                        .get("requires_prescription")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        rx_required.push((
                            pid,
                            line.get("base_qty")
                                .or_else(|| line.get("qty"))
                                .and_then(money::decimal)
                                .unwrap_or(Decimal::ZERO),
                        ));
                    }
                }
            }
        }
        if !rx_required.is_empty() && prescription_id.is_none() {
            errors.push("Bán thuốc kê đơn cần gắn đơn thuốc đã xác minh".into());
        }
        if rx_required.is_empty() && prescription_id.is_some() {
            errors.push("Chỉ gắn đơn thuốc khi giỏ hàng có thuốc cần đơn".into());
        }
        if let Some(rx_id) = prescription_id {
            let rx = tx.query_opt("SELECT party, status, valid_until, items FROM pharmacy__prescription WHERE tenant_id=$1 AND id=$2 FOR UPDATE", &[&tenant.id, &rx_id]).await?;
            if let Some(rx) = rx {
                let rx_party: Uuid = rx.get(0);
                let status: String = rx.get(1);
                let valid_until: Option<chrono::NaiveDate> = rx.get(2);
                let rx_items: Value = rx.get(3);
                if !matches!(status.as_str(), "verified" | "partially_dispensed") {
                    errors.push("Chỉ dùng đơn thuốc đã xác minh hoặc đang cấp một phần".into());
                }
                if valid_until.is_none_or(|date| date < chrono::Utc::now().date_naive()) {
                    errors.push("Đơn thuốc đã hết hạn".into());
                }
                let order_party = document
                    .get("party")
                    .and_then(Value::as_str)
                    .and_then(|v| Uuid::parse_str(v).ok());
                if order_party != Some(rx_party) {
                    errors.push("Khách hàng trên đơn POS phải trùng với đơn thuốc".into());
                }
                let mut required_totals = std::collections::BTreeMap::<Uuid, Decimal>::new();
                for (pid, qty) in &rx_required {
                    let current = required_totals.get(pid).copied().unwrap_or(Decimal::ZERO);
                    if let Some(total) = current.checked_add(*qty) {
                        required_totals.insert(*pid, total);
                    } else {
                        errors.push("Số lượng thuốc kê đơn vượt giới hạn hỗ trợ".into());
                    }
                }
                let previously_dispensed =
                    dispensed_quantities_for_prescription(tx, tenant, rx_id).await?;
                for (pid, qty) in &required_totals {
                    let allowed = rx_items
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|item| {
                            item.get("product")
                                .and_then(Value::as_str)
                                .and_then(|v| Uuid::parse_str(v).ok())
                                == Some(*pid)
                        })
                        .filter_map(|item| item.get("qty").and_then(money::decimal))
                        .try_fold(Decimal::ZERO, |sum, value| sum.checked_add(value))
                        .unwrap_or(Decimal::ZERO);
                    let already_dispensed = previously_dispensed
                        .get(pid)
                        .copied()
                        .unwrap_or(Decimal::ZERO);
                    let combined = already_dispensed.checked_add(*qty);
                    if combined.is_none_or(|total| allowed < total) {
                        errors.push(
                            "Tổng số lượng đã và đang bán vượt quá số lượng kê trong đơn".into(),
                        );
                    }
                }
            } else {
                errors.push("Không tìm thấy đơn thuốc trong doanh nghiệp".into());
            }
        }
    }
    Ok(errors)
}

async fn dispensed_quantities_for_prescription(
    tx: &Tx<'_>,
    tenant: &Tenant,
    prescription_id: Uuid,
) -> R<std::collections::BTreeMap<Uuid, Decimal>> {
    let rows = tx
        .query(
            "SELECT lines FROM pos__pos_order WHERE tenant_id = $1 AND prescription = $2::text AND status = 'completed' FOR SHARE",
            &[&tenant.id, &prescription_id],
        )
        .await?;
    let mut totals = std::collections::BTreeMap::<Uuid, Decimal>::new();
    for row in rows {
        let lines: Value = row.get(0);
        for line in lines.as_array().into_iter().flatten() {
            let Some(product_id) = line
                .get("product")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let qty = line
                .get("base_qty")
                .or_else(|| line.get("qty"))
                .and_then(money::decimal)
                .unwrap_or(Decimal::ZERO);
            let current = totals.get(&product_id).copied().unwrap_or(Decimal::ZERO);
            let Some(total) = current.checked_add(qty) else {
                return Err(crate::error::ApiError::validation(
                    "pos.pos_order",
                    vec!["Dispensed quantity exceeds the supported range".into()],
                ));
            };
            totals.insert(product_id, total);
        }
    }
    Ok(totals)
}
