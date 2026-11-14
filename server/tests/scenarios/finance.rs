//! Financial lifecycle regressions using the same public kernel as HTTP.
use super::{Ctx, f, id};
use osp_server::{kernel::Kernel, money};
use rust_decimal::Decimal;
use serde_json::json;
use std::sync::Arc;

async fn balanced_journals(context: &Ctx, minimum: usize) {
    let journals = context.list("accounting.journal_entry", &[]).await;
    assert!(journals.len() >= minimum, "missing financial effects");
    for journal in journals {
        assert_eq!(journal["status"], "posted");
        let mut debit = Decimal::ZERO;
        let mut credit = Decimal::ZERO;
        for line in journal["lines"].as_array().unwrap() {
            debit = debit
                .checked_add(money::decimal(&line["debit"]).unwrap())
                .unwrap();
            credit = credit
                .checked_add(money::decimal(&line["credit"]).unwrap())
                .unwrap();
        }
        assert_eq!(debit, credit, "unbalanced journal {}", journal["id"]);
        assert!(debit > Decimal::ZERO);
    }
}

#[async_recursion::async_recursion]
pub(super) async fn run(kernel: &Arc<Kernel>) {
    {
        let context = Ctx::new(kernel, None, &["asset"]).await;
        let asset = context
            .create(
                "asset.asset",
                json!({
                    "code": "FA-001", "name": "Test equipment", "cost": 1200,
                    "in_service_date": "2020-01-01", "useful_life_months": 12,
                    "acquisition_method": "bank"
                }),
            )
            .await;
        context.act("asset.asset", &id(&asset), "activated").await;
        let depreciation = context
            .create(
                "asset.depreciation",
                json!({ "asset": id(&asset), "period": "2020-01-31" }),
            )
            .await;
        assert_eq!(depreciation["amount"], 100);
        context
            .act("asset.depreciation", &id(&depreciation), "posted")
            .await;
        assert_eq!(
            money::decimal(&context.get("asset.asset", &id(&asset)).await["book_value"]),
            Some(Decimal::from(1100))
        );
        assert!(
            context
                .try_create(
                    "asset.depreciation",
                    json!({ "asset": id(&asset), "period": "2020-01-01" })
                )
                .await
                .is_err()
        );
        context
            .update(
                "asset.asset",
                &id(&asset),
                json!({ "disposal_proceeds": 1200, "disposal_method": "bank" }),
            )
            .await;
        context.act("asset.asset", &id(&asset), "disposed").await;
        assert!(
            kernel
                .remove(&context.a, &context.t, "asset.asset", &id(&asset))
                .await
                .is_err()
        );
        balanced_journals(&context, 3).await;
        println!(
            "✔ fixed asset: capitalization, exact depreciation, duplicate month guard, disposal"
        );
    }
    {
        let context = Ctx::new(kernel, None, &["expense"]).await;
        let employee = context
            .create(
                "hrm.employee",
                json!({ "name": "Expense employee", "hire_date": "2000-01-01" }),
            )
            .await;
        let claim = context.create("expense.expense_claim", json!({
            "employee": id(&employee), "payment_method": "bank",
            "items": [{ "description": "Transport", "amount": 30.3 }, { "description": "Supplies", "amount": 69.7 }]
        })).await;
        assert_eq!(claim["total"], 100);
        context
            .act("expense.expense_claim", &id(&claim), "submitted")
            .await;
        context
            .act("expense.expense_claim", &id(&claim), "approved")
            .await;
        context
            .act("expense.expense_claim", &id(&claim), "paid")
            .await;
        assert!(
            kernel
                .act(
                    &context.a,
                    &context.t,
                    "expense.expense_claim",
                    &id(&claim),
                    "paid"
                )
                .await
                .is_err()
        );
        assert_eq!(
            context
                .list("accounting.payment", &[("source_id", &id(&claim))])
                .await
                .len(),
            1
        );
        assert!(
            kernel
                .update(
                    &context.a,
                    &context.t,
                    "expense.expense_claim",
                    &id(&claim),
                    super::o(json!({ "items": [] }))
                )
                .await
                .is_err()
        );
        balanced_journals(&context, 2).await;
        println!(
            "✔ employee expenses: exact total, approval, single payment, immutable paid claim"
        );
    }
    {
        let context = Ctx::new(kernel, None, &["payroll"]).await;
        let employee = context
            .create(
                "hrm.employee",
                json!({
                    "name": "Payroll employee", "hire_date": "2000-01-01", "base_salary": 2300,
                    "tax_residency": "exempt", "contribution_exempt": true
                }),
            )
            .await;
        context
            .create(
                "hrm.attendance",
                json!({
                    "employee": id(&employee), "date": "2001-01-02",
                    "check_in": "2001-01-02T09:00:00Z", "check_out": "2001-01-02T17:00:00Z"
                }),
            )
            .await;
        let run = context
            .create(
                "payroll.payroll_run",
                json!({ "period": "2001-01", "payment_method": "bank" }),
            )
            .await;
        context
            .act("payroll.payroll_run", &id(&run), "calculated")
            .await;
        let slips = context.list("payroll.payslip", &[("run", &id(&run))]).await;
        assert_eq!(slips.len(), 1);
        assert_eq!(f(&slips[0]["paid_days"]), 1.0);
        assert_eq!(f(&slips[0]["net"]), 100.0);
        assert!(
            kernel
                .act(
                    &context.a,
                    &context.t,
                    "payroll.payroll_run",
                    &id(&run),
                    "calculated"
                )
                .await
                .is_err()
        );
        context
            .act("payroll.payroll_run", &id(&run), "submitted")
            .await;
        context
            .act("payroll.payroll_run", &id(&run), "approved")
            .await;
        context.act("payroll.payroll_run", &id(&run), "paid").await;
        assert_eq!(
            context
                .list("accounting.payment", &[("source_id", &id(&run))])
                .await
                .len(),
            1
        );
        balanced_journals(&context, 2).await;
        println!(
            "✔ payroll: attendance valuation, immutable calculation, approval and payment journals"
        );
    }
}
