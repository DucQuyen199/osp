use chrono::NaiveDate;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;

mod journal;

fn amount(document: &Value, field: &str) -> Option<Decimal> {
    crate::money::decimal(document.get(field)?)
}

fn date(document: &Value, field: &str) -> Option<NaiveDate> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    match entity {
        "account" => {
            let code = document
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if code.is_empty()
                || code.len() > 32
                || !code.bytes().all(|byte| {
                    byte.is_ascii_uppercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
                })
            {
                errors.push("Account code must use up to 32 uppercase letters, digits, dots, dashes, or underscores".into());
            }
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            {
                errors.push("Account name is required".into());
            }
            let bank_identifiers = ["bank_account_id", "bank_iban", "casso_bank_account_id"];
            let has_bank_identifier = bank_identifiers.iter().any(|field| {
                document
                    .get(*field)
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
            });
            if has_bank_identifier && document.get("kind").and_then(Value::as_str) != Some("asset")
            {
                errors.push("Bank identifiers can only be configured on asset accounts".into());
            }
            for field in bank_identifiers {
                if let Some(value) = document.get(field).and_then(Value::as_str)
                    && (!value.trim().is_empty()
                        && (value.trim().chars().count() > 128
                            || value.chars().any(char::is_control)))
                {
                    errors.push(format!(
                        "{field} must be at most 128 characters without control characters"
                    ));
                }
            }
        }
        "period" => {
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
                && start > end
            {
                errors.push("Ngày bắt đầu kỳ phải nhỏ hơn hoặc bằng ngày kết thúc".into());
            }
        }
        "invoice" | "bill" | "credit_note" | "debit_note" => {
            if matches!(entity, "invoice" | "bill")
                && let (Some(issue), Some(due)) =
                    (date(document, "issue_date"), date(document, "due_date"))
                && due < issue
            {
                errors.push("Ngày đến hạn không được trước ngày phát hành".into());
            }
            if document.get("total").is_some() {
                if !amount(document, "total").is_some_and(|value| value > Decimal::ZERO) {
                    errors.push("total phải lớn hơn 0".into());
                }
            }
            if matches!(entity, "invoice" | "bill" | "credit_note" | "debit_note") {
                if let Some(tax) = document.get("tax_total") {
                    let total = amount(document, "total").unwrap_or_default();
                    if !crate::money::decimal(tax).is_some_and(|value| {
                        value >= Decimal::ZERO
                            && (value <= total
                                || crate::money::within_tolerance(value, total, Decimal::new(5, 3)))
                    }) {
                        errors.push("tax_total must be between zero and total".into());
                    }
                }
            }
        }
        "payment" => {
            let source = document.get("source").and_then(Value::as_str);
            if matches!(source, Some("ticket" | "event_ticket_refund")) {
                let total = amount(document, "amount").unwrap_or_default().abs();
                let rate = amount(document, "tax_rate").unwrap_or_default();
                let tax = amount(document, "tax_amount").unwrap_or_default().abs();
                let expected_tax = rate
                    .checked_div(Decimal::ONE_HUNDRED)
                    .and_then(|fraction| Decimal::ONE.checked_add(fraction))
                    .and_then(|factor| total.checked_div(factor))
                    .and_then(|net| total.checked_sub(net))
                    .map(|tax| {
                        tax.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                    });
                if rate < Decimal::ZERO
                    || rate > Decimal::ONE_HUNDRED
                    || tax < Decimal::ZERO
                    || (tax > total
                        && !crate::money::within_tolerance(tax, total, Decimal::new(5, 3)))
                    || expected_tax.is_none_or(|expected| {
                        !crate::money::within_tolerance(tax, expected, Decimal::new(5, 3))
                    })
                    || document
                        .get("tax_name")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                {
                    errors.push("Ticket payment requires valid tax snapshot values".into());
                }
            }
            if document
                .get("payment_date")
                .is_some_and(|value| !value.is_null() && date(document, "payment_date").is_none())
            {
                errors.push("payment_date phải là ngày hợp lệ theo định dạng YYYY-MM-DD".into());
            }
            if document.get("amount").is_some() {
                let refund = matches!(
                    document.get("source").and_then(Value::as_str),
                    Some(
                        "payment_refund"
                            | "event_ticket_refund"
                            | "pos_order_refund"
                            | "credit_note_refund"
                            | "debit_note_refund"
                    )
                );
                if !amount(document, "amount").is_some_and(|value| {
                    if refund {
                        value < Decimal::ZERO
                    } else {
                        value > Decimal::ZERO
                    }
                }) {
                    errors.push(if refund {
                        "Khoản hoàn tiền kế toán phải có số tiền âm".into()
                    } else {
                        "amount thanh toán phải lớn hơn 0".into()
                    });
                }
            }
            if document.get("source").and_then(Value::as_str) == Some("payment_refund")
                && (document.get("source_id").and_then(Value::as_str).is_none()
                    || !document
                        .get("invoice")
                        .is_some_and(|value| !value.is_null())
                        && !document.get("bill").is_some_and(|value| !value.is_null()))
            {
                errors.push("Khoản hoàn tiền cần nguồn và hóa đơn đối ứng".into());
            }
            if document.get("source").and_then(Value::as_str) == Some("event_ticket_refund")
                && document
                    .get("source_id")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
            {
                errors.push("Khoản hoàn vé cần mã vé nguồn".into());
            }
            if document.get("source").and_then(Value::as_str) == Some("pos_order_refund")
                && document
                    .get("source_id")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
            {
                errors.push("POS refund payment requires the source order id".into());
            }
            if matches!(
                document.get("source").and_then(Value::as_str),
                Some("credit_note_refund" | "debit_note_refund")
            ) {
                let credit_refund =
                    document.get("source").and_then(Value::as_str) == Some("credit_note_refund");
                let valid_link = if credit_refund {
                    document
                        .get("refund_credit_note")
                        .is_some_and(|v| !v.is_null())
                        && document.get("invoice").is_some_and(|v| !v.is_null())
                        && document.get("bill").is_none_or(Value::is_null)
                } else {
                    document
                        .get("refund_debit_note")
                        .is_some_and(|v| !v.is_null())
                        && document.get("bill").is_some_and(|v| !v.is_null())
                        && document.get("invoice").is_none_or(Value::is_null)
                };
                if !valid_link
                    || document
                        .get("source_id")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                {
                    errors.push("Adjustment refund requires its note, matching invoice or bill, and idempotency id".into());
                }
            }
            if document.get("invoice").is_some_and(|v| !v.is_null())
                && document.get("bill").is_some_and(|v| !v.is_null())
            {
                errors
                    .push("Một payment chỉ được liên kết với hóa đơn bán hoặc hóa đơn mua".into());
            }
            if source.is_none()
                && !document.get("invoice").is_some_and(|v| !v.is_null())
                && !document.get("bill").is_some_and(|v| !v.is_null())
            {
                errors.push(
                    "A manual payment must reference either a customer invoice or supplier bill"
                        .into(),
                );
            }
        }
        "settlement_batch" => {
            if !amount(document, "amount").is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Settlement batch total must be greater than zero".into());
            }
            if !matches!(
                document.get("direction").and_then(Value::as_str),
                Some("receipt" | "disbursement")
            ) {
                errors.push("Settlement batch direction must be receipt or disbursement".into());
            }
            if date(document, "payment_date").is_none() {
                errors.push("Settlement batch requires a valid payment date".into());
            }
            let Some(allocations) = document.get("allocations").and_then(Value::as_array) else {
                errors.push("Settlement batch requires invoice allocations".into());
                return errors;
            };
            if allocations.is_empty() {
                errors.push("Settlement batch needs at least one invoice allocation".into());
            }
            let receipt = document.get("direction").and_then(Value::as_str) == Some("receipt");
            let mut total = Decimal::ZERO;
            for (index, allocation) in allocations.iter().enumerate() {
                let document_ref = if receipt { "invoice" } else { "bill" };
                let other_ref = if receipt { "bill" } else { "invoice" };
                let valid_reference = allocation
                    .get(document_ref)
                    .and_then(Value::as_str)
                    .is_some_and(|id| !id.is_empty())
                    && allocation.get(other_ref).is_none_or(Value::is_null);
                let value = allocation.get("amount").and_then(crate::money::decimal);
                if !valid_reference || value.is_none_or(|amount| amount <= Decimal::ZERO) {
                    errors.push(format!("Settlement allocation {} must reference one matching invoice or bill and a positive amount", index + 1));
                    continue;
                }
                let Some(next) = total.checked_add(value.unwrap_or_default()) else {
                    errors.push("Settlement allocation total exceeds the supported range".into());
                    break;
                };
                total = next;
            }
            if amount(document, "amount").is_some_and(|value| {
                !crate::money::within_tolerance(total, value, Decimal::new(5, 3))
            }) {
                errors.push(
                    "Settlement batch total must equal the sum of its invoice allocations".into(),
                );
            }
        }
        "bank_statement" => {
            if let (Some(start), Some(end)) =
                (date(document, "start_date"), date(document, "end_date"))
                && start > end
            {
                errors.push("Ngày bắt đầu sao kê phải trước hoặc bằng ngày kết thúc".into());
            }
            for field in ["opening_balance", "closing_balance"] {
                if amount(document, field).is_none() {
                    errors.push(format!("{field} phải là số tiền hữu hạn"));
                }
            }
        }
        "bank_statement_line" => {
            if !amount(document, "amount").is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Số tiền dòng sao kê phải lớn hơn 0".into());
            }
        }
        "journal_entry" => {
            if document.get("amount").is_some_and(|v| !v.is_null())
                && !amount(document, "amount").is_some_and(|value| value >= Decimal::ZERO)
            {
                errors.push("amount bút toán không được âm".into());
            }
            if document.get("lines").is_some_and(|v| !v.is_null()) {
                errors.extend(journal::validate_lines(document));
            }
        }
        _ => {}
    }
    errors
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "bank_statement_line" && patch.get("statement").is_some() {
        return vec!["Không thể chuyển dòng sao kê sang một sao kê khác".into()];
    }
    let protected: &[&str] = match entity {
        "period" if current.get("status").and_then(Value::as_str) == Some("period_closed") => {
            &["*"]
        }
        "payment" => &["*"],
        "settlement_batch"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &["*"]
        }
        "bank_statement" if current.get("status").and_then(Value::as_str) != Some("draft") => {
            &["*"]
        }
        "bank_statement_line"
            if current.get("status").and_then(Value::as_str) != Some("unmatched") =>
        {
            &["*"]
        }
        "invoice" | "bill" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "party",
            "currency",
            "exchange_rate",
            "exchange_rate_date",
            "base_total",
            "base_tax_total",
            "supplier",
            "total",
            "tax_total",
            "lines",
            "paid_amount",
            "adjustment_amount",
            "balance_due",
            "issue_date",
            "due_date",
            "source",
            "source_id",
        ],
        "journal_entry"
            if !matches!(
                current.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            &[
                "memo",
                "amount",
                "posting_date",
                "lines",
                "source",
                "source_id",
            ]
        }
        "credit_note" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "invoice",
            "currency",
            "exchange_rate",
            "exchange_rate_date",
            "base_total",
            "base_tax_total",
            "total",
            "tax_total",
            "lines",
            "source",
            "source_id",
        ],
        "debit_note" if current.get("status").and_then(Value::as_str) != Some("draft") => &[
            "bill",
            "currency",
            "exchange_rate",
            "exchange_rate_date",
            "base_total",
            "base_tax_total",
            "total",
            "tax_total",
            "lines",
            "source",
            "source_id",
        ],
        _ => return Vec::new(),
    };
    if protected.contains(&"*") || protected.iter().any(|field| patch.get(*field).is_some()) {
        vec!["Chứng từ kế toán không thể sửa sau khi phát sinh/ghi sổ".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "period" if document.get("status").and_then(Value::as_str) == Some("period_closed") => {
            vec!["Kỳ kế toán đã khóa không được xóa; hãy mở lại kỳ trước".into()]
        }
        "settlement_batch"
            if !matches!(
                document.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            ) =>
        {
            vec!["Only a draft or rejected settlement batch can be deleted".into()]
        }
        "payment" => vec!["Payment là dấu vết tài chính, không được xóa trực tiếp".into()],
        "bank_statement_line"
            if document.get("status").and_then(Value::as_str) != Some("unmatched") =>
        {
            vec![
                "Matched or ignored bank statement lines are retained as reconciliation evidence"
                    .into(),
            ]
        }
        "bank_statement" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Only a draft bank statement can be deleted".into()]
        }
        "invoice" | "bill" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Hóa đơn đã ghi sổ không được xóa; hãy thực hiện nghiệp vụ điều chỉnh".into()]
        }
        "credit_note" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Hóa đơn điều chỉnh đã ghi sổ không được xóa".into()]
        }
        "debit_note" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Phiếu điều chỉnh công nợ mua đã ghi sổ không được xóa".into()]
        }
        "journal_entry" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Bút toán đã ghi sổ không được xóa; hãy tạo bút toán đảo".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    validate_action_at(entity, action, document, chrono::Utc::now().date_naive())
}

pub fn validate_action_at(
    entity: &str,
    action: &str,
    document: &Value,
    today: chrono::NaiveDate,
) -> Vec<String> {
    match (entity, action) {
        ("settlement_batch", "submitted" | "approved") => validate("settlement_batch", document),
        ("period", "closed") => {
            let Some(start) = date(document, "start_date") else {
                return vec!["Kỳ kế toán cần ngày bắt đầu hợp lệ".into()];
            };
            let Some(end) = date(document, "end_date") else {
                return vec!["Kỳ kế toán cần ngày kết thúc hợp lệ".into()];
            };
            if start > end {
                vec!["Ngày bắt đầu kỳ phải nhỏ hơn hoặc bằng ngày kết thúc".into()]
            } else if end > today {
                vec!["An accounting period can only be closed after its end date".into()]
            } else {
                Vec::new()
            }
        }
        ("bank_statement", "reconciled") => {
            if amount(document, "opening_balance").is_none()
                || amount(document, "closing_balance").is_none()
            {
                vec!["Statement opening and closing balances must be finite".into()]
            } else {
                Vec::new()
            }
        }
        ("bank_statement_line", "ignored") => {
            let reason = document
                .get("ignore_reason")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if reason.is_empty() {
                vec!["Nhập lý do trước khi bỏ qua dòng sao kê".into()]
            } else if reason.chars().count() > 500 {
                vec!["Lý do bỏ qua không được vượt quá 500 ký tự".into()]
            } else {
                Vec::new()
            }
        }
        ("bank_statement_line", "matched") => {
            let payment = document
                .get("payment")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty());
            let journal_entry = document
                .get("journal_entry")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty());
            if payment == journal_entry {
                vec!["Chọn đúng một payment hoặc bút toán đã ghi sổ để khớp dòng sao kê".into()]
            } else {
                Vec::new()
            }
        }
        ("journal_entry", "submitted" | "posted" | "reversed") => journal::validate_lines(document),
        ("invoice" | "bill" | "credit_note" | "debit_note", "posted") => {
            if !amount(document, "total").is_some_and(|value| value > Decimal::ZERO) {
                vec!["Chỉ ghi sổ hóa đơn có tổng tiền lớn hơn 0".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}
