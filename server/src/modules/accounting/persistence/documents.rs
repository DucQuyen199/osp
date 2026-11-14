//! Posting checks for invoices, bills and their adjustment documents.
use super::{database_amount, database_optional_amount, purchase_line_amounts};
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn amount(document: &Value, field: &str) -> Option<Decimal> {
    money::decimal(document.get(field)?)
}

fn posted_document(status: &str) -> bool {
    matches!(
        status,
        "posted" | "partially_paid" | "partially_settled" | "paid" | "settled"
    )
}

fn amount_tolerance() -> Decimal {
    Decimal::new(5, 3)
}

fn quantity_tolerance() -> Decimal {
    Decimal::new(1, 6)
}

fn amount_limit(amount: Decimal) -> R<Decimal> {
    amount.checked_add(amount_tolerance()).ok_or_else(|| {
        crate::error::ApiError::validation(
            "accounting.document",
            vec!["A document balance exceeds the supported decimal range".into()],
        )
    })
}

fn amount_overflow() -> crate::error::ApiError {
    crate::error::ApiError::validation(
        "accounting.document",
        vec!["A document balance exceeds the supported decimal range".into()],
    )
}

pub(super) async fn validate_posted_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match entity {
        "invoice" => {
            for code in ["131", "511"] {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
                }
            }
            let Some(party_id) = document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                return Ok(vec![
                    "Hóa đơn cần khách hàng hợp lệ để kiểm tra hạn mức tín dụng".into(),
                ]);
            };
            let party = tx
                .query_opt(
                    "SELECT credit_limit::text, is_customer FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &party_id],
                )
                .await?;
            let Some(party) = party else {
                return Ok(vec!["Không tìm thấy khách hàng trong doanh nghiệp".into()]);
            };
            if party.get::<_, Option<bool>>(1) == Some(false) {
                errors.push("Đối tác chưa được đánh dấu là khách hàng".into());
            }
            if let Some(credit_limit) = database_optional_amount(&party, 0)? {
                let outstanding = tx
                    .query_opt(
                        "SELECT COALESCE(SUM(GREATEST(COALESCE(i.base_total, i.total) - COALESCE((SELECT SUM(COALESCE(p.applied_base_amount, p.amount)) FROM accounting__payment p WHERE p.tenant_id = i.tenant_id AND p.invoice = i.id), 0) - COALESCE((SELECT SUM(COALESCE(c.base_total, c.total)) FROM accounting__credit_note c WHERE c.tenant_id = i.tenant_id AND c.invoice = i.id AND c.status = 'posted'), 0), 0)), 0)::text FROM accounting__invoice i WHERE i.tenant_id = $1 AND i.party = $2 AND i.status NOT IN ('draft', 'void')",
                        &[&tenant.id, &party_id],
                    )
                    .await?
                    .ok_or_else(|| amount_overflow())?;
                let outstanding = database_amount(&outstanding, 0)?;
                let invoice_total = amount(document, "base_total")
                    .or_else(|| amount(document, "total"))
                    .unwrap_or(Decimal::ZERO);
                let projected = outstanding
                    .checked_add(invoice_total)
                    .ok_or_else(amount_overflow)?;
                if projected > amount_limit(credit_limit)? {
                    errors.push(format!(
                        "Ghi sổ hóa đơn vượt hạn mức tín dụng: công nợ hiện tại {outstanding:.2}, hóa đơn mới {invoice_total:.2}, hạn mức {credit_limit:.2}"
                    ));
                }
            }
        }
        "bill" => {
            for code in ["156", "331"] {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
                }
            }
            if document.get("source").and_then(Value::as_str) == Some("purchase_order") {
                let Some(order_id) = document
                    .get("source_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                else {
                    return Ok(vec!["Bill từ đơn mua cần mã đơn nguồn hợp lệ".into()]);
                };
                let Some(order) = tx
                    .query_opt(
                        "SELECT supplier, total::text, COALESCE(tax_total, 0)::text, status, lines FROM purchasing__purchase_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                        &[&tenant.id, &order_id],
                    )
                    .await?
                else {
                    return Ok(vec!["Không tìm thấy đơn mua nguồn trong doanh nghiệp".into()]);
                };
                let supplier: Uuid = order.get(0);
                let order_total = database_amount(&order, 1)?;
                let order_tax = database_amount(&order, 2)?;
                let order_status: String = order.get(3);
                let order_lines: Value = order.get(4);
                if order_status != "received" {
                    errors.push("Chỉ được ghi bill khi đơn mua đã nhận đủ hàng".into());
                }
                if document
                    .get("supplier")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    != Some(supplier)
                {
                    errors.push("Nhà cung cấp trên bill phải khớp đơn mua nguồn".into());
                }
                if !amount(document, "total").is_some_and(|value| {
                    money::within_tolerance(value, order_total, amount_tolerance())
                }) {
                    errors.push("Tổng bill phải khớp tổng đơn mua nguồn".into());
                }
                if !amount(document, "tax_total").is_some_and(|value| {
                    money::within_tolerance(value, order_tax, amount_tolerance())
                }) {
                    errors.push("Thuế bill phải khớp thuế đơn mua nguồn".into());
                }
                let bill_lines = document
                    .get("lines")
                    .cloned()
                    .unwrap_or_else(|| Value::Array(Vec::new()));
                match (
                    purchase_line_amounts(&order_lines),
                    purchase_line_amounts(&bill_lines),
                ) {
                    (Some(expected), Some(actual))
                        if expected.len() == actual.len()
                            && expected.iter().all(|(product, (qty, net))| {
                                actual.get(product).is_some_and(|(actual_qty, actual_net)| {
                                    money::within_tolerance(
                                        *qty,
                                        *actual_qty,
                                        quantity_tolerance(),
                                    ) && money::within_tolerance(
                                        *net,
                                        *actual_net,
                                        amount_tolerance(),
                                    )
                                })
                            }) => {}
                    _ => errors.push(
                        "Bill product quantities and net amounts must match every purchase-order line"
                            .into(),
                    ),
                }
                let bill_id = document
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .unwrap_or(Uuid::nil());
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__bill WHERE tenant_id = $1 AND source = 'purchase_order' AND source_id = $2 AND id <> $3 AND status <> 'void' LIMIT 1",
                        &[&tenant.id, &order_id.to_string(), &bill_id],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Đơn mua nguồn đã có bill khác, không thể ghi trùng".into());
                }
            }
        }
        "credit_note" => {
            for code in ["131", "511"] {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
                }
            }
            let credit_note_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let invoice_id = document
                .get("invoice")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if document.get("source").and_then(Value::as_str) != Some("sales_return") {
                errors.push("Credit note phải được tạo từ phiếu trả hàng đã nhận".into());
            }
            let Some(invoice_id) = invoice_id else {
                return Ok(vec!["Credit note cần tham chiếu hóa đơn bán hợp lệ".into()]);
            };
            let Some(source_id) = source_id else {
                return Ok(vec![
                    "Credit note cần tham chiếu phiếu trả hàng hợp lệ".into(),
                ]);
            };
            let Some(credit_note_id) = credit_note_id else {
                return Ok(vec!["Không xác định được credit note cần ghi sổ".into()]);
            };
            let invoice = tx
                .query_opt(
                    "SELECT total::text, status, source, source_id FROM accounting__invoice WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &invoice_id],
                )
                .await?;
            let sales_return = tx
                .query_opt(
                    "SELECT sales_order, total::text, status FROM sales__sales_return WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &source_id],
                )
                .await?;
            match (invoice, sales_return) {
                (Some(invoice), Some(sales_return)) => {
                    let invoice_total = database_amount(&invoice, 0)?;
                    let invoice_status: String = invoice.get(1);
                    let invoice_source: Option<String> = invoice.get(2);
                    let invoice_source_id: Option<String> = invoice.get(3);
                    let sales_order: Uuid = sales_return.get(0);
                    let return_total = database_amount(&sales_return, 1)?;
                    let return_status: String = sales_return.get(2);
                    if !posted_document(&invoice_status) {
                        errors.push("Credit note chỉ được ghi sổ theo hóa đơn đã ghi sổ".into());
                    }
                    if return_status != "received" {
                        errors.push(
                            "Phiếu trả hàng phải được nhận trước khi ghi sổ credit note".into(),
                        );
                    }
                    if invoice_source.as_deref() != Some("sales_order")
                        || invoice_source_id.as_deref() != Some(sales_order.to_string().as_str())
                    {
                        errors.push("Hóa đơn credit note không khớp đơn bán của phiếu trả".into());
                    }
                    if !amount(document, "total").is_some_and(|value| {
                        money::within_tolerance(value, return_total, amount_tolerance())
                    }) {
                        errors.push("Tổng credit note phải khớp tổng phiếu trả hàng".into());
                    }
                    let previous_row = tx
                        .query_opt(
                            "SELECT COALESCE(SUM(total), 0)::text FROM accounting__credit_note WHERE tenant_id = $1 AND invoice = $2 AND status = 'posted' AND id <> $3",
                            &[&tenant.id, &invoice_id, &credit_note_id],
                        )
                        .await?;
                    let previous = match previous_row {
                        Some(row) => database_amount(&row, 0)?,
                        None => Decimal::ZERO,
                    };
                    let new_credits = previous
                        .checked_add(amount(document, "total").unwrap_or(Decimal::ZERO))
                        .ok_or_else(amount_overflow)?;
                    // Adjustments reverse the original supply independently of cash settlement.
                    // Previously received/paid cash remains a refundable customer/supplier balance.
                    if new_credits > amount_limit(invoice_total)? {
                        errors.push("Tổng hóa đơn điều chỉnh vượt số tiền hóa đơn gốc".into());
                    }
                    if tx
                        .query_opt(
                            "SELECT 1 FROM accounting__credit_note WHERE tenant_id = $1 AND source = 'sales_return' AND source_id = $2 AND id <> $3 LIMIT 1",
                            &[&tenant.id, &source_id.to_string(), &credit_note_id],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Phiếu trả hàng đã có credit note".into());
                    }
                }
                _ => errors.push("Không tìm thấy hóa đơn hoặc phiếu trả hàng trong tenant".into()),
            }
        }
        "debit_note" => {
            for code in ["156", "331"] {
                if tx
                    .query_opt(
                        "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                        &[&tenant.id, &code],
                    )
                    .await?
                    .is_none()
                {
                    errors.push(format!("Thiếu tài khoản kế toán mặc định {code}"));
                }
            }
            let debit_note_id = document
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let bill_id = document
                .get("bill")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            let source_id = document
                .get("source_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if document.get("source").and_then(Value::as_str) != Some("purchase_return") {
                errors.push("Phiếu điều chỉnh giảm phải trả phải đến từ hàng mua đã trả".into());
            }
            let Some(bill_id) = bill_id else {
                return Ok(vec![
                    "Phiếu điều chỉnh cần tham chiếu hóa đơn mua hợp lệ".into(),
                ]);
            };
            let Some(source_id) = source_id else {
                return Ok(vec![
                    "Phiếu điều chỉnh cần tham chiếu phiếu trả hàng mua hợp lệ".into(),
                ]);
            };
            let Some(debit_note_id) = debit_note_id else {
                return Ok(vec![
                    "Không xác định được phiếu điều chỉnh cần ghi sổ".into(),
                ]);
            };
            let bill = tx
                .query_opt(
                    "SELECT total::text, COALESCE(tax_total,0)::text, status, source, source_id FROM accounting__bill WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &bill_id],
                )
                .await?;
            let purchase_return = tx
                .query_opt(
                    "SELECT purchase_order, total::text, COALESCE(tax_total,0)::text, status FROM purchasing__purchase_return WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &source_id],
                )
                .await?;
            match (bill, purchase_return) {
                (Some(bill), Some(purchase_return)) => {
                    let bill_total = database_amount(&bill, 0)?;
                    let bill_status: String = bill.get(2);
                    let bill_source: Option<String> = bill.get(3);
                    let bill_source_id: Option<String> = bill.get(4);
                    let purchase_order: Uuid = purchase_return.get(0);
                    let return_total = database_amount(&purchase_return, 1)?;
                    let return_tax = database_amount(&purchase_return, 2)?;
                    let return_status: String = purchase_return.get(3);
                    if !posted_document(&bill_status) {
                        errors.push(
                            "Phiếu điều chỉnh chỉ được ghi sổ theo hóa đơn mua đã ghi sổ".into(),
                        );
                    }
                    if return_status != "dispatched" {
                        errors.push(
                            "Phiếu hàng trả phải được gửi đi trước khi ghi sổ điều chỉnh".into(),
                        );
                    }
                    let purchase_order_id = purchase_order.to_string();
                    if bill_source.as_deref() != Some("purchase_order")
                        || bill_source_id.as_deref() != Some(purchase_order_id.as_str())
                    {
                        errors.push("Hóa đơn mua không khớp đơn hàng của phiếu trả".into());
                    }
                    if !amount(document, "total").is_some_and(|value| {
                        money::within_tolerance(value, return_total, amount_tolerance())
                    }) {
                        errors.push("Tổng điều chỉnh phải khớp tổng phiếu trả hàng mua".into());
                    }
                    if !amount(document, "tax_total").is_some_and(|value| {
                        money::within_tolerance(value, return_tax, amount_tolerance())
                    }) {
                        errors
                            .push("Thuế điều chỉnh phải khớp thuế trên phiếu trả hàng mua".into());
                    }
                    let previous_row = tx
                        .query_opt(
                            "SELECT COALESCE(SUM(total), 0)::text FROM accounting__debit_note WHERE tenant_id = $1 AND bill = $2 AND status = 'posted' AND id <> $3",
                            &[&tenant.id, &bill_id, &debit_note_id],
                        )
                        .await?;
                    let previous = match previous_row {
                        Some(row) => database_amount(&row, 0)?,
                        None => Decimal::ZERO,
                    };
                    let new_adjustments = previous
                        .checked_add(amount(document, "total").unwrap_or(Decimal::ZERO))
                        .ok_or_else(amount_overflow)?;
                    // Adjustments reverse the original supply independently of cash settlement.
                    // Previously received/paid cash remains a refundable customer/supplier balance.
                    if new_adjustments > amount_limit(bill_total)? {
                        errors.push("Tổng điều chỉnh vượt số tiền hóa đơn mua gốc".into());
                    }
                    if tx
                        .query_opt(
                            "SELECT 1 FROM accounting__debit_note WHERE tenant_id = $1 AND source = 'purchase_return' AND source_id = $2 AND id <> $3 LIMIT 1",
                            &[&tenant.id, &source_id.to_string(), &debit_note_id],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Phiếu trả hàng mua đã có chứng từ điều chỉnh".into());
                    }
                }
                _ => errors.push("Không tìm thấy hóa đơn mua hoặc phiếu trả trong tenant".into()),
            }
        }
        _ => {}
    }
    Ok(errors)
}
