//! Financial lifecycle regressions using the same public kernel as HTTP.
use super::{Ctx, f, id, o};
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
    manual_journal_approvals(kernel).await;
    company_group_consent(kernel).await;
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

async fn company_group_consent(kernel: &Arc<Kernel>) {
    let owner = Ctx::new(kernel, None, &["consolidation"]).await;
    let mut member = Ctx::new(kernel, None, &["consolidation"]).await;
    let member_usd = member
        .create(
            "master-data.currency",
            json!({ "code": "USD", "name": "US Dollar" }),
        )
        .await;
    kernel
        .update_settings(&member.t, &json!({ "baseCurrency": "USD" }))
        .await
        .expect("set member base currency");
    member.refresh().await;
    let local_vnd = member
        .list("master-data.currency", &[])
        .await
        .into_iter()
        .find(|currency| currency["code"] == "VND")
        .expect("member VND seed");
    let rate_date = member.t.business_today();
    let rate = member
        .create(
            "master-data.currency_rate",
            json!({ "from_currency": local_vnd["id"], "to_currency": id(&member_usd), "effective_date": rate_date.to_string(), "rate": 0.00004 }),
        )
        .await;
    let expense_account = member
        .list("accounting.account", &[("code", "642")])
        .await
        .remove(0);
    let cash_account = member
        .list("accounting.account", &[("code", "112")])
        .await
        .remove(0);
    let journal = member
        .create(
            "accounting.journal_entry",
            json!({
                "memo": "Group report FX fixture",
                "amount": 10,
                "lines": [
                    { "account": id(&expense_account), "debit": 10, "credit": 0 },
                    { "account": id(&cash_account), "debit": 0, "credit": 10 }
                ]
            }),
        )
        .await;
    member
        .act("accounting.journal_entry", &id(&journal), "posted")
        .await;
    let currencies = owner.list("master-data.currency", &[]).await;
    let usd = currencies
        .iter()
        .find(|currency| currency["code"] == "VND")
        .unwrap_or_else(|| panic!("VND currency seed missing"));
    let group = owner
        .create(
            "consolidation.company_group",
            json!({ "name": "Test Group", "reporting_currency": usd["id"], "max_rate_age_days": 30 }),
        )
        .await;
    assert!(
        owner
            .try_create(
                "consolidation.company_group",
                json!({ "name": "Invalid Rate Policy", "reporting_currency": usd["id"], "max_rate_age_days": 1.5 }),
            )
            .await
            .is_err(),
        "rate age policies must use whole calendar days"
    );
    let invite = kernel
        .invite_company_group_member(&owner.a, &owner.t, &id(&group), &member.t.id)
        .await
        .expect("create company group invite");
    let member_id = invite["memberId"].as_str().unwrap();
    let token = invite["inviteToken"].as_str().unwrap();

    assert!(
        kernel
            .accept_company_group_invite(
                &member.a,
                &member.t,
                &owner.t.id,
                member_id,
                "wrong-token",
            )
            .await
            .is_err()
    );
    let denied = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect_err("accounting access alone must not grant group reports");
    assert_eq!(denied.code, "FORBIDDEN");
    let grant = kernel
        .grant_consolidated_report(
            &owner.a,
            &owner.t,
            &id(&group),
            owner.a.user_id(),
            "trial_balance",
        )
        .await
        .expect("grant named owner user access to trial balance");
    let unconsented_report = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect("read group report before member consent");
    assert!(
        unconsented_report["companies"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    kernel
        .accept_company_group_invite(&member.a, &member.t, &owner.t.id, member_id, token)
        .await
        .expect("member admin consents to invite");

    let owner_record = owner.get("consolidation.member", member_id).await;
    assert_eq!(owner_record["status"], "active");
    let shares = member.list("consolidation.shared_company", &[]).await;
    assert_eq!(shares.len(), 1);
    assert_eq!(shares[0]["owner_tenant_id"], owner.t.id);
    let report = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect("read reciprocal-consent group report");
    assert_eq!(report["reportingCurrency"], "VND");
    assert_eq!(report["companies"].as_array().unwrap().len(), 1);
    assert_eq!(report["companies"][0]["tenantId"], member.t.id);
    assert_eq!(report["companies"][0]["localCurrency"], "USD");
    assert_eq!(report["companies"][0]["conversionRate"], "25000");
    assert_eq!(
        report["companies"][0]["rateEffectiveDate"],
        rate_date.to_string()
    );
    assert_eq!(report["companies"][0]["rateAgeDays"], 0);
    assert_eq!(report["companies"][0]["maxRateAgeDays"], 30.0);
    let source_expense = report["companies"][0]["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["code"] == "642")
        .unwrap();
    assert_eq!(source_expense["closingDebit"], "10");
    assert_eq!(source_expense["reportingClosingDebit"], "250000");
    assert_eq!(report["reconciliation"]["difference"], "0");
    assert_eq!(report["reconciliation"]["withinCentTolerance"], true);
    let (snapshot_status, snapshot) = owner
        .api(
            "POST",
            &format!(
                "/consolidation/groups/{}/trial-balance/snapshots",
                id(&group)
            ),
            json!({}),
        )
        .await;
    assert_eq!(snapshot_status, 201);
    let snapshot_id = snapshot["snapshotId"].as_str().unwrap();
    assert_eq!(snapshot["report"]["companies"], report["companies"]);
    assert_eq!(snapshot["report"]["accounts"], report["accounts"]);
    let (saved_reports_status, saved_reports) = owner
        .api(
            "GET",
            &format!(
                "/consolidation/groups/{}/trial-balance/snapshots",
                id(&group)
            ),
            json!({}),
        )
        .await;
    assert_eq!(saved_reports_status, 200);
    assert_eq!(saved_reports["items"].as_array().unwrap().len(), 1);
    assert_eq!(saved_reports["items"][0]["id"], snapshot_id);
    let (opened_snapshot_status, opened_snapshot) = owner
        .api(
            "GET",
            &format!("/consolidation/trial-balance/snapshots/{snapshot_id}"),
            json!({}),
        )
        .await;
    assert_eq!(opened_snapshot_status, 200);
    assert_eq!(opened_snapshot["report"], snapshot["report"]);
    assert!(
        owner
            .k
            .update(
                &owner.a,
                &owner.t,
                "consolidation.report_snapshot",
                snapshot_id,
                o(json!({ "reporting_currency": "USD" })),
            )
            .await
            .is_err(),
        "generic updates must not change an immutable report snapshot"
    );
    assert!(
        owner
            .k
            .remove(
                &owner.a,
                &owner.t,
                "consolidation.report_snapshot",
                snapshot_id,
            )
            .await
            .is_err(),
        "generic deletes must not remove an immutable report snapshot"
    );
    kernel
        .remove(
            &member.a,
            &member.t,
            "master-data.currency_rate",
            &id(&rate),
        )
        .await
        .expect("remove rate to check fail-closed behavior");
    let stale_rate_date = (rate_date - chrono::Duration::days(31)).to_string();
    let stale_rate = member
        .create(
            "master-data.currency_rate",
            json!({ "from_currency": local_vnd["id"], "to_currency": id(&member_usd), "effective_date": stale_rate_date, "rate": 0.00004 }),
        )
        .await;
    let stale_rate_error = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect_err("report must fail closed when the latest quote exceeds group policy");
    assert_eq!(stale_rate_error.code, "CURRENCY_RATE_STALE");
    member
        .k
        .remove(
            &member.a,
            &member.t,
            "master-data.currency_rate",
            &id(&stale_rate),
        )
        .await
        .expect("remove stale rate before checking missing-rate behavior");
    let missing_rate = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect_err("report must fail if the member has no rate on or before period end");
    assert_eq!(missing_rate.code, "CURRENCY_RATE_MISSING");
    member
        .create(
            "master-data.currency_rate",
            json!({ "from_currency": local_vnd["id"], "to_currency": id(&member_usd), "effective_date": rate_date.to_string(), "rate": 0.00004 }),
        )
        .await;
    owner
        .update(
            "consolidation.company_group",
            &id(&group),
            json!({ "max_rate_age_days": null }),
        )
        .await;
    let missing_policy = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect_err("translated reports require an explicit rate-age policy");
    assert_eq!(missing_policy.code, "CURRENCY_RATE_POLICY_MISSING");
    owner
        .update(
            "consolidation.company_group",
            &id(&group),
            json!({ "max_rate_age_days": 30 }),
        )
        .await;
    let (_, ungranted_token) = kernel
        .add_user(&owner.t, "Ungrantable user", None, None, &["admin".into()])
        .await
        .expect("create another tenant user");
    let (_, ungranted_actor, _) = kernel
        .authenticate(&ungranted_token.expect("API token"))
        .await
        .expect("authenticate ungranted user");
    let denied_user = kernel
        .consolidated_trial_balance(&ungranted_actor, &owner.t, &id(&group), None, None)
        .await
        .expect_err("a different admin must not inherit another user's report grant");
    assert_eq!(denied_user.code, "FORBIDDEN");
    assert!(
        owner
            .k
            .act(
                &owner.a,
                &owner.t,
                "consolidation.report_grant",
                grant["grantId"].as_str().unwrap(),
                "revoked",
            )
            .await
            .is_err(),
        "generic state actions must not bypass the audited grant endpoint"
    );
    kernel
        .revoke_consolidated_report_grant(&owner.a, &owner.t, grant["grantId"].as_str().unwrap())
        .await
        .expect("revoke named report access");
    assert!(
        kernel
            .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
            .await
            .is_err()
    );
    let (revoked_snapshot_status, _) = owner
        .api(
            "GET",
            &format!("/consolidation/trial-balance/snapshots/{snapshot_id}"),
            json!({}),
        )
        .await;
    assert_eq!(revoked_snapshot_status, 404);
    kernel
        .grant_consolidated_report(
            &owner.a,
            &owner.t,
            &id(&group),
            owner.a.user_id(),
            "trial_balance",
        )
        .await
        .expect("restore named report access for remaining flow assertions");

    assert!(
        kernel
            .accept_company_group_invite(&member.a, &member.t, &owner.t.id, member_id, token,)
            .await
            .is_ok(),
        "acceptance retry should be idempotent"
    );
    kernel
        .revoke_shared_company(&member.a, &member.t, &owner.t.id, member_id)
        .await
        .expect("member admin revokes consent");
    assert_eq!(
        owner.get("consolidation.member", member_id).await["status"],
        "revoked"
    );
    assert_eq!(
        member
            .get(
                "consolidation.shared_company",
                shares[0]["id"].as_str().unwrap()
            )
            .await["status"],
        "revoked"
    );

    let second_invite = kernel
        .invite_company_group_member(&owner.a, &owner.t, &id(&group), &member.t.id)
        .await
        .expect("create replacement invitation after revocation");
    let second_member_id = second_invite["memberId"].as_str().unwrap();
    kernel
        .accept_company_group_invite(
            &member.a,
            &member.t,
            &owner.t.id,
            second_member_id,
            second_invite["inviteToken"].as_str().unwrap(),
        )
        .await
        .expect("member admin accepts replacement invite");
    kernel
        .revoke_company_group_member(&owner.a, &owner.t, second_member_id)
        .await
        .expect("owner admin revokes company membership");
    let shares = member.list("consolidation.shared_company", &[]).await;
    assert_eq!(shares.len(), 2);
    assert!(shares.iter().all(|share| share["status"] == "revoked"));
    let revoked_report = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect("revoked members are excluded from the consolidated report");
    assert!(revoked_report["companies"].as_array().unwrap().is_empty());

    // Keep the elimination workflow isolated from the FX and member-consent
    // scenario above so its approval module cannot alter those report fixtures.
    let owner = Ctx::new(kernel, None, &["consolidation", "workflow-approval"]).await;
    let reporting_currency = owner
        .list("master-data.currency", &[])
        .await
        .into_iter()
        .find(|currency| currency["code"] == "VND")
        .expect("owner VND currency seed");
    let group = owner
        .create(
            "consolidation.company_group",
            json!({ "name": "Elimination Test Group", "reporting_currency": reporting_currency["id"], "max_rate_age_days": 30 }),
        )
        .await;
    kernel
        .grant_consolidated_report(
            &owner.a,
            &owner.t,
            &id(&group),
            owner.a.user_id(),
            "trial_balance",
        )
        .await
        .expect("grant report access for elimination assertions");
    let (reviewer, reviewer_token) = kernel
        .add_user(
            &owner.t,
            "Independent elimination reviewer",
            None,
            None,
            &["admin".into()],
        )
        .await
        .expect("create independent elimination reviewer");
    let (_, reviewer_actor, _) = kernel
        .authenticate(&reviewer_token.expect("reviewer API token"))
        .await
        .expect("authenticate elimination reviewer");
    owner
        .create(
            "workflow-approval.approval_rule",
            json!({
                "name": "Independent elimination review",
                "entity": "consolidation.elimination_journal",
                "min_amount": 0,
                "approvers": { "users": [reviewer.id] }
            }),
        )
        .await;
    let posting_date = owner.t.business_today().to_string();
    assert!(
        owner
            .try_create(
                "consolidation.elimination_journal",
                json!({
                    "group": id(&group),
                    "posting_date": posting_date,
                    "memo": "Unbalanced elimination should fail",
                    "lines": [
                        { "accountCode": "642", "debit": 10, "credit": 0 },
                        { "accountCode": "112", "debit": 0, "credit": 9 }
                    ],
                    "matching_evidence": ["IC-INV-001"]
                }),
            )
            .await
            .is_err(),
        "unbalanced elimination drafts must be rejected"
    );
    let elimination = owner
        .create(
            "consolidation.elimination_journal",
            json!({
                "group": id(&group),
                "posting_date": posting_date,
                "memo": "Eliminate matched intercompany balance",
                "lines": [
                    { "accountCode": "642", "debit": 10, "credit": 0 },
                    { "accountCode": "112", "debit": 0, "credit": 10 }
                ],
                "matching_evidence": ["IC-INV-001"]
            }),
        )
        .await;
    owner
        .act(
            "consolidation.elimination_journal",
            &id(&elimination),
            "submitted",
        )
        .await;
    let pending = owner
        .list(
            "workflow-approval.approval_request",
            &[("record_id", &id(&elimination)), ("status", "pending")],
        )
        .await
        .remove(0);
    assert!(
        kernel
            .act(
                &owner.a,
                &owner.t,
                "workflow-approval.approval_request",
                &id(&pending),
                "approved",
            )
            .await
            .is_err(),
        "the submitter cannot approve their own elimination journal"
    );
    assert!(
        kernel
            .update(
                &owner.a,
                &owner.t,
                "consolidation.elimination_journal",
                &id(&elimination),
                o(json!({ "memo": "Changed after submission" })),
            )
            .await
            .is_err(),
        "submitted elimination journals must be immutable"
    );
    kernel
        .act(
            &reviewer_actor,
            &owner.t,
            "workflow-approval.approval_request",
            &id(&pending),
            "approved",
        )
        .await
        .expect("independent reviewer approves elimination journal");
    assert_eq!(
        owner
            .get("consolidation.elimination_journal", &id(&elimination))
            .await["status"],
        "posted"
    );
    assert!(
        kernel
            .remove(
                &owner.a,
                &owner.t,
                "consolidation.elimination_journal",
                &id(&elimination),
            )
            .await
            .is_err(),
        "posted elimination journals must remain immutable"
    );
    let final_report = kernel
        .consolidated_trial_balance(&owner.a, &owner.t, &id(&group), None, None)
        .await
        .expect("approved elimination appears in consolidated report");
    assert_eq!(final_report["eliminations"].as_array().unwrap().len(), 1);
    assert_eq!(
        final_report["eliminations"][0]["matchingEvidence"][0],
        "IC-INV-001"
    );
    assert!(
        owner
            .k
            .update(
                &owner.a,
                &owner.t,
                "consolidation.company_group",
                &id(&group),
                o(json!({ "reporting_currency": "USD" })),
            )
            .await
            .is_err(),
        "the reporting currency cannot change after elimination activity"
    );
}

async fn manual_journal_approvals(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["accounting", "workflow-approval"]).await;
    let (reviewer, token) = kernel
        .add_user(
            &t.t,
            "Independent journal reviewer",
            None,
            None,
            &["admin".into()],
        )
        .await
        .unwrap();
    let (_, reviewer_actor, _) = kernel.authenticate(&token.unwrap()).await.unwrap();
    t.create(
        "workflow-approval.approval_rule",
        json!({
            "name": "Manual journal review",
            "entity": "accounting.journal_entry",
            "min_amount": 50,
            "approvers": { "users": [reviewer.id] }
        }),
    )
    .await;
    let expense = t
        .list("accounting.account", &[("code", "642")])
        .await
        .remove(0);
    let cash = t
        .list("accounting.account", &[("code", "112")])
        .await
        .remove(0);
    let below_threshold = t
        .create(
            "accounting.journal_entry",
            json!({
                "memo": "Below approval threshold",
                "amount": 20,
                "lines": [
                    { "account": id(&expense), "debit": 20, "credit": 0 },
                    { "account": id(&cash), "debit": 0, "credit": 20 }
                ]
            }),
        )
        .await;
    t.act("accounting.journal_entry", &id(&below_threshold), "posted")
        .await;
    assert_eq!(
        t.get("accounting.journal_entry", &id(&below_threshold))
            .await["status"],
        "posted"
    );
    let journal = t
        .create(
            "accounting.journal_entry",
            json!({
                "memo": "Manual accrual",
                "amount": 100,
                "posting_date": chrono::Utc::now().date_naive().to_string(),
                "lines": [
                    { "account": id(&expense), "debit": 100, "credit": 0 },
                    { "account": id(&cash), "debit": 0, "credit": 100 }
                ]
            }),
        )
        .await;
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "accounting.journal_entry",
                &id(&journal),
                "posted"
            )
            .await
            .is_err(),
        "a user cannot directly post a manual journal"
    );
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "accounting.journal_entry",
                &id(&journal),
                o(json!({ "status": "posted" }))
            )
            .await
            .is_err(),
        "a user cannot bypass the state machine through a status patch"
    );
    t.act("accounting.journal_entry", &id(&journal), "submitted")
        .await;
    let request = t
        .list(
            "workflow-approval.approval_request",
            &[("record_id", &id(&journal)), ("status", "pending")],
        )
        .await
        .remove(0);
    assert_eq!(money::decimal(&request["amount"]), Some(Decimal::from(100)));
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "workflow-approval.approval_request",
                &id(&request),
                "approved"
            )
            .await
            .is_err(),
        "the submitter cannot approve their own journal"
    );
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "accounting.journal_entry",
                &id(&journal),
                "rejected"
            )
            .await
            .is_err(),
        "users cannot reject a journal outside the approval request"
    );
    kernel
        .act(
            &reviewer_actor,
            &t.t,
            "workflow-approval.approval_request",
            &id(&request),
            "rejected",
        )
        .await
        .unwrap();
    assert_eq!(
        t.get("accounting.journal_entry", &id(&journal)).await["status"],
        "rejected"
    );
    t.update(
        "accounting.journal_entry",
        &id(&journal),
        json!({ "memo": "Revised manual accrual" }),
    )
    .await;
    t.act("accounting.journal_entry", &id(&journal), "submitted")
        .await;
    let pending = t
        .list(
            "workflow-approval.approval_request",
            &[("record_id", &id(&journal)), ("status", "pending")],
        )
        .await
        .remove(0);
    kernel
        .act(
            &reviewer_actor,
            &t.t,
            "workflow-approval.approval_request",
            &id(&pending),
            "approved",
        )
        .await
        .unwrap();
    assert_eq!(
        t.get("accounting.journal_entry", &id(&journal)).await["status"],
        "posted"
    );
    println!("✔ manual journals: rule threshold, separation of duties, no bypass and resubmission");
}
