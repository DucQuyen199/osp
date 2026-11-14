use crate::money;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};

const APPROVAL_TARGETS: &[&str] = &[
    "purchasing.purchase_order",
    "purchasing.supplier_invoice",
    "purchasing.purchase_requisition",
    "payroll.payroll_run",
    "inventory.stock_count",
    "sales.sales_return",
    "purchasing.purchase_return",
    "expense.expense_claim",
    "hrm.leave_request",
    "accounting.settlement_batch",
    "contract.amendment",
];

fn valid_approvers(value: &Value) -> bool {
    let nonempty_strings = |value: &Value| {
        value.as_array().is_some_and(|entries| {
            !entries.is_empty()
                && entries
                    .iter()
                    .all(|entry| entry.as_str().is_some_and(|entry| !entry.trim().is_empty()))
        })
    };
    if nonempty_strings(value) {
        return true;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    ["users", "userIds", "roles"]
        .iter()
        .filter_map(|key| object.get(*key))
        .any(nonempty_strings)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    if entity != "approval_rule" {
        return Vec::new();
    }
    let mut errors = Vec::new();
    if !document
        .get("entity")
        .and_then(Value::as_str)
        .is_some_and(|entity| APPROVAL_TARGETS.contains(&entity))
    {
        errors.push("Approval rule must target a supported business document".into());
    }
    if document
        .get("min_amount")
        .is_some_and(|amount| !money::decimal(amount).is_some_and(|amount| amount >= Decimal::ZERO))
    {
        errors.push("Approval threshold must be a finite non-negative amount".into());
    }
    if document.get("variance_tolerance").is_some_and(|tolerance| {
        !money::decimal(tolerance).is_some_and(|tolerance| tolerance >= Decimal::ZERO)
    }) {
        errors.push("Variance tolerance must be a finite non-negative amount".into());
    }
    if document
        .get("variance_tolerance")
        .is_some_and(|tolerance| !tolerance.is_null())
        && document.get("entity").and_then(Value::as_str) != Some("purchasing.supplier_invoice")
    {
        errors.push("Variance tolerance can only be configured for supplier invoices".into());
    }
    if !document.get("approvers").is_some_and(valid_approvers) {
        errors.push("Approvers must be a non-empty list of user IDs or role names".into());
    }
    errors
}

pub fn request_for_event(event_type: &str, event: &Value) -> Option<Map<String, Value>> {
    let (entity, subject, amount, requested_by) = match event_type {
        "purchasing.purchase_order.submitted" => (
            "purchasing.purchase_order",
            "Duyệt đơn mua hàng",
            event.get("total"),
            None,
        ),
        "purchasing.supplier_invoice.submitted" => (
            "purchasing.supplier_invoice",
            "Duyệt hóa đơn nhà cung cấp",
            event.get("total"),
            None,
        ),
        "purchasing.purchase_requisition.submitted" => (
            "purchasing.purchase_requisition",
            "Duyệt đề nghị mua hàng",
            None,
            event.get("requested_by"),
        ),
        "payroll.payroll_run.submitted" => (
            "payroll.payroll_run",
            "Duyệt bảng lương",
            event.get("total_net"),
            None,
        ),
        "inventory.stock_count.submitted" => {
            ("inventory.stock_count", "Duyệt phiếu kiểm kê", None, None)
        }
        "sales.sales_return.submitted" => (
            "sales.sales_return",
            "Duyệt phiếu trả hàng bán",
            event.get("total"),
            None,
        ),
        "purchasing.purchase_return.submitted" => (
            "purchasing.purchase_return",
            "Duyệt phiếu trả hàng mua",
            event.get("total"),
            None,
        ),
        "expense.expense_claim.submitted" => (
            "expense.expense_claim",
            "Duyệt đề nghị chi phí",
            event.get("total"),
            None,
        ),
        "hrm.leave_request.submitted" => (
            "hrm.leave_request",
            "Duyệt đơn nghỉ phép",
            None,
            event.get("employee"),
        ),
        "accounting.settlement_batch.submitted" => (
            "accounting.settlement_batch",
            "Duyệt phiếu thu/chi phân bổ công nợ",
            event.get("amount"),
            None,
        ),
        "contract.amendment.submitted" => (
            "contract.amendment",
            "Duyệt phụ lục hợp đồng",
            event.pointer("/changes/value"),
            None,
        ),
        _ => return None,
    };
    let record_id = event.get("id")?.as_str()?;
    let mut request = Map::new();
    request.insert("subject".into(), json!(subject));
    request.insert("entity".into(), json!(entity));
    request.insert("record_id".into(), json!(record_id));
    if let Some(amount) = amount.filter(|value| !value.is_null()) {
        request.insert("amount".into(), amount.clone());
    }
    if let Some(requested_by) = requested_by.filter(|value| !value.is_null()) {
        request.insert("requested_by".into(), requested_by.clone());
    }
    if let Some(requested_by_user) = event
        .get("_approval_actor_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        request.insert("requested_by_user".into(), json!(requested_by_user));
    }
    Some(request)
}

pub fn decision_for_event(event_type: &str, event: &Value) -> Option<(&'static str, &'static str)> {
    let action = match event_type {
        "workflow-approval.approval_request.approved" => "approved",
        "workflow-approval.approval_request.rejected" => "rejected",
        _ => return None,
    };
    let entity = match event.get("entity")?.as_str()? {
        "purchasing.purchase_order" => "purchasing.purchase_order",
        "purchasing.supplier_invoice" => "purchasing.supplier_invoice",
        "purchasing.purchase_requisition" => "purchasing.purchase_requisition",
        "payroll.payroll_run" => "payroll.payroll_run",
        "inventory.stock_count" => "inventory.stock_count",
        "sales.sales_return" => "sales.sales_return",
        "purchasing.purchase_return" => "purchasing.purchase_return",
        "expense.expense_claim" => "expense.expense_claim",
        "hrm.leave_request" => "hrm.leave_request",
        "accounting.settlement_batch" => "accounting.settlement_batch",
        "contract.amendment" => "contract.amendment",
        _ => return None,
    };
    Some((entity, action))
}

pub fn is_optional_target(entity: &str) -> bool {
    entity == "expense.expense_claim"
}
