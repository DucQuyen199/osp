//! Payroll lifecycle transition invariants.
use super::*;
pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    match entity {
        "tax_deduction"
            if current.get("status").and_then(Value::as_str) == Some("approved")
                && patch.as_object().is_none_or(|patch| !patch.is_empty()) =>
        {
            vec!["Approved tax deduction records are retained as annual tax evidence".into()]
        }
        "tax_deduction"
            if current.get("status").and_then(Value::as_str) == Some("submitted")
                && patch.as_object().is_some_and(|patch| {
                    patch
                        .keys()
                        .any(|key| !matches!(key.as_str(), "approved_amount" | "review_note"))
                }) =>
        {
            vec!["Submitted tax deduction details are locked; reviewer may only set approved amount and note".into()]
        }
        "tax_policy"
            if current.get("status").and_then(Value::as_str) == Some("approved")
                && [
                    "name",
                    "effective_from",
                    "effective_to",
                    "personal_allowance",
                    "dependent_allowance",
                    "annual_medical_deduction_cap",
                    "annual_education_deduction_cap",
                    "annual_deductions_require_resident",
                    "resident_brackets",
                    "nonresident_rate",
                    "rounding_unit",
                    "tax_account",
                ]
                .iter()
                .any(|field| patch.get(*field).is_some()) =>
        {
            vec![
                "Approved payroll tax policies are immutable; create a new effective-dated policy"
                    .into(),
            ]
        }
        "contribution_policy"
            if current.get("status").and_then(Value::as_str) == Some("approved")
                && [
                    "name",
                    "effective_from",
                    "effective_to",
                    "basis",
                    "monthly_base_cap",
                    "employee_rate",
                    "employer_rate",
                    "employee_deductible_for_tax",
                    "liability_account",
                    "employer_expense_account",
                ]
                .iter()
                .any(|field| patch.get(*field).is_some()) =>
        {
            vec![
                "Approved contribution policies are immutable; create a new effective-dated policy"
                    .into(),
            ]
        }
        "payroll_adjustment"
            if matches!(
                current.get("status").and_then(Value::as_str),
                Some("submitted" | "approved")
            ) && [
                "employee", "period", "kind", "amount", "account", "reason", "taxable",
            ]
            .iter()
            .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Submitted or approved payroll adjustments cannot be edited".into()]
        }
        "overtime_entry"
            if matches!(
                current.get("status").and_then(Value::as_str),
                Some("submitted" | "approved")
            ) && ["employee", "date", "hours", "multiplier", "reason"]
                .iter()
                .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Submitted or approved overtime entries are immutable; create a new entry to correct them".into()]
        }
        "contribution_remittance"
            if matches!(
                current.get("status").and_then(Value::as_str),
                Some("submitted" | "approved" | "paid")
            ) && [
                "period",
                "policy",
                "amount",
                "payment_method",
                "payment_date",
            ]
            .iter()
            .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Submitted, approved or paid contribution remittances are immutable; cancel an unpaid draft and create a replacement".into()]
        }
        "payslip"
            if [
                "run",
                "employee",
                "salary_revision",
                "salary_basis",
                "paid_days",
                "working_days",
                "work_weekdays",
                "standard_hours_per_day",
                "additions",
                "overtime_hours",
                "overtime_pay",
                "gross",
                "deductions",
                "tax_policy",
                "taxable_income",
                "income_tax",
                "contribution_policy",
                "contribution_base",
                "employee_contribution",
                "employer_contribution",
                "net",
            ]
            .iter()
            .any(|field| patch.get(*field).is_some()) =>
        {
            vec!["Phiếu lương đã tạo không thể sửa; hãy hủy bảng lương nháp và lập bảng mới".into()]
        }
        "payroll_run" if current.get("status").and_then(Value::as_str) != Some("draft") => {
            if patch.get("period").is_some()
                || patch.get("hours_per_day").is_some()
                || patch.get("working_weekdays").is_some()
                || patch.get("total_net").is_some()
                || patch.get("payment_date").is_some()
                || patch.get("payment_method").is_some()
            {
                vec![
                    "Bảng lương đã gửi duyệt không thể sửa kỳ, số giờ chuẩn, tổng tiền hoặc ngày thanh toán"
                        .into(),
                ]
            } else {
                Vec::new()
            }
        }
        "payroll_run"
            if patch.get("total_net").is_some()
                || patch.get("hours_per_day").is_some()
                || patch.get("working_weekdays").is_some() =>
        {
            vec!["total_net và hours_per_day là dữ liệu chốt khi tạo bảng lương".into()]
        }
        "payroll_run" if patch.get("period").is_some() => {
            vec![
                "Kỳ lương được chốt khi tạo bảng; hãy hủy bảng nháp và tạo bảng mới nếu sai kỳ"
                    .into(),
            ]
        }
        _ => Vec::new(),
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "tax_deduction"
            if matches!(
                document.get("status").and_then(Value::as_str),
                Some("submitted" | "approved")
            ) =>
        {
            vec![
                "Submitted or approved tax deduction records are retained as audit evidence".into(),
            ]
        }
        "tax_policy" if document.get("status").and_then(Value::as_str) == Some("approved") => {
            vec!["Approved payroll tax policies are retained as payroll audit history".into()]
        }
        "contribution_policy"
            if document.get("status").and_then(Value::as_str) == Some("approved") =>
        {
            vec!["Approved contribution policies are retained as payroll audit history".into()]
        }
        "overtime_entry"
            if matches!(
                document.get("status").and_then(Value::as_str),
                Some("submitted" | "approved")
            ) =>
        {
            vec!["Submitted or approved overtime entries are retained as audit history".into()]
        }
        "contribution_remittance"
            if matches!(
                document.get("status").and_then(Value::as_str),
                Some("submitted" | "approved" | "paid")
            ) =>
        {
            vec!["Submitted, approved or paid contribution remittances are retained as audit history".into()]
        }
        "payroll_adjustment"
            if matches!(
                document.get("status").and_then(Value::as_str),
                Some("submitted" | "approved")
            ) =>
        {
            vec!["Submitted or approved payroll adjustments are retained as audit history".into()]
        }
        "payslip" => vec![
            "Phiếu lương là dấu vết bảng lương; hãy hủy bảng nháp và lập bảng mới nếu cần sửa"
                .into(),
        ],
        "payroll_run" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Bảng lương đã duyệt hoặc đã trả không được xóa".into()]
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "tax_deduction" && action == "submitted" {
        return validate_tax_deduction(document, true, false);
    } else if entity == "tax_deduction" && action == "approved" {
        return validate_tax_deduction(document, true, true);
    } else if entity == "tax_deduction" && action == "rejected" {
        if document
            .get("review_note")
            .and_then(Value::as_str)
            .is_none_or(|note| note.trim().is_empty())
        {
            return vec!["Reviewer must record a rejection note".into()];
        }
        return Vec::new();
    } else if entity == "tax_policy" && action == "approved" {
        return validate_tax_policy(document);
    } else if entity == "contribution_policy" && action == "approved" {
        return validate_contribution_policy(document);
    } else if entity == "payroll_adjustment" && matches!(action, "submitted" | "approved") {
        let mut errors = validate_adjustment(document);
        if document.get("employee").and_then(Value::as_str).is_none() {
            errors.push("Payroll adjustment requires an employee".into());
        }
        return errors;
    } else if entity == "overtime_entry" && matches!(action, "submitted" | "approved") {
        return validate_overtime_entry(document);
    } else if entity == "contribution_remittance"
        && matches!(action, "submitted" | "approved" | "paid")
    {
        return validate_contribution_remittance(document, action == "paid");
    } else if entity == "payroll_run" && action == "calculated" {
        if !document
            .get("period")
            .and_then(Value::as_str)
            .is_some_and(valid_period)
        {
            return vec!["Payroll period must use YYYY-MM format".into()];
        }
        if document
            .get("hours_per_day")
            .is_some_and(|value| !value.is_null())
            && !decimal_field(document, "hours_per_day")
                .is_some_and(|hours| (Decimal::ONE..=Decimal::from(24)).contains(&hours))
        {
            return vec!["Payroll hours_per_day must be between 1 and 24".into()];
        }
        let mut errors = Vec::new();
        validate_run_weekdays(document, &mut errors);
        if !errors.is_empty() {
            return errors;
        }
        return Vec::new();
    }
    if entity == "payroll_run" && action == "paid" {
        return match document.get("payment_method").and_then(Value::as_str) {
            None | Some("cash" | "bank") => Vec::new(),
            _ => vec!["Payroll payment method must be cash or bank".into()],
        };
    }
    if entity == "payroll_run"
        && action == "approved"
        && !decimal_field(document, "total_net").is_some_and(|amount| amount > Decimal::ZERO)
    {
        vec!["Payroll net total must be greater than zero before approval".into()]
    } else {
        Vec::new()
    }
}
