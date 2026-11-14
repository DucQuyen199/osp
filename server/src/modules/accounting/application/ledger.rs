use super::*;
#[path = "ledger/refunds.rs"]
mod refunds;
mod reversal;
#[path = "ledger/settlements.rs"]
mod settlements;
#[path = "ledger/source_documents.rs"]
mod source_documents;

pub async fn handle_ledger_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if let Some(handled) =
        refunds::handle_event(kernel, tx, tenant, event_type, event, event_id, depth).await?
    {
        return Ok(handled);
    }
    if let Some(handled) =
        settlements::handle_event(kernel, tx, tenant, event_type, event, event_id, depth).await?
    {
        return Ok(handled);
    }
    if let Some(handled) =
        source_documents::handle_event(kernel, tx, tenant, event_type, event, event_id, depth)
            .await?
    {
        return Ok(handled);
    }
    Ok(false)
}

fn payment_posting(event: &Value) -> Option<(&'static str, &'static str, &'static str)> {
    let source = event.get("source")?.as_str()?;
    let method = event
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match source {
        "expense_claim" => match method {
            "cash" => return Some(("Chi trả hoàn ứng nhân viên", "334", "111")),
            "bank" => return Some(("Chuyển khoản hoàn ứng nhân viên", "334", "112")),
            _ => return None,
        },
        "payroll_run" => {
            return match method {
                "bank" => Some(("Chuyển khoản thanh toán bảng lương", "334", "112")),
                "cash" | "" => Some(("Tiền mặt thanh toán bảng lương", "334", "111")),
                _ => None,
            };
        }
        _ => {}
    }
    let has_invoice = event.get("invoice").is_some_and(|value| !value.is_null());
    let has_bill = event.get("bill").is_some_and(|value| !value.is_null());
    let cash_account = match (source, method) {
        ("pos_order" | "table_order" | "ticket", "cash") => "111",
        ("pos_order" | "table_order" | "ticket", "card" | "transfer" | "ewallet" | "bank") => "112",
        ("donation", "cash") => "111",
        ("donation", "card" | "transfer" | "ewallet" | "bank") => "112",
        (_, "cash") if has_invoice || has_bill => "111",
        (_, "card" | "transfer" | "ewallet" | "bank") if has_invoice || has_bill => "112",
        _ => return None,
    };
    match source {
        "pos_order" => Some(("Ghi nhận thu tiền đơn POS", cash_account, "511")),
        "table_order" => Some(("Thu tiền order nhà hàng", cash_account, "511")),
        "ticket" => Some(("Ghi nhận thu tiền bán vé sự kiện", cash_account, "511")),
        "donation" => Some(("Ghi nhận khoản quyên góp", cash_account, "711")),
        _ if has_invoice && !has_bill => Some(("Thu tiền hóa đơn bán", cash_account, "131")),
        _ if has_bill && !has_invoice => Some(("Chi tiền hóa đơn mua", "331", cash_account)),
        _ => None,
    }
}
