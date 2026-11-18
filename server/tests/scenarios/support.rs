use super::{Ctx, f, id, o};
use osp_server::kernel::Kernel;
use serde_json::json;
use std::sync::Arc;

#[async_recursion::async_recursion]
pub(super) async fn run(kernel: &Arc<Kernel>) {
    budget(kernel).await;
    cases(kernel).await;
    charity(kernel).await;
    marketing_bi(kernel).await;
    documents(kernel).await;
    messaging(kernel).await;
    reports(kernel).await;
}

async fn reports(kernel: &Arc<Kernel>) {
    let t = Ctx::new(
        kernel,
        None,
        &[
            "manufacturing",
            "asset",
            "budget",
            "marketing",
            "helpdesk",
            "payroll",
            "logistics",
        ],
    )
    .await;
    for route in [
        "accounting/trial-balance",
        "accounting/income-statement",
        "accounting/balance-sheet",
        "accounting/cash-flow-forecast",
        "accounting/receivables-aging",
        "accounting/payables-aging",
        "accounting/fx-revaluation-preview",
        "accounting/chart-templates",
        "accounting/tax-register",
        "manufacturing/wip",
        "asset/depreciation-schedule",
        "inventory/replenishment",
        "inventory/location-stock",
        "inventory/quality-holds",
        "budget/variance",
        "crm/pipeline",
        "marketing/campaign-performance",
        "helpdesk/sla",
    ] {
        let (status, result) = t
            .api("GET", &format!("/reports/{route}"), json!(null))
            .await;
        assert_eq!(status, 200, "report {route}: {result}");
    }
    let account = t
        .list("accounting.account", &[("code", "112")])
        .await
        .remove(0);
    let (status, result) = t
        .api(
            "GET",
            &format!("/reports/accounting/general-ledger/{}", id(&account)),
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "general ledger: {result}");
    println!(
        "✔ reports: all 19 business report HTTP endpoints on PostgreSQL with tenant authorization"
    );
}

async fn budget(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["budget"]).await;
    let expense = t
        .list("accounting.account", &[("code", "642")])
        .await
        .remove(0);
    let cash = t
        .list("accounting.account", &[("code", "112")])
        .await
        .remove(0);
    let period = chrono::Utc::now().format("%Y-%m").to_string();
    let original = t
        .create(
            "budget.budget",
            json!({ "name": "Operating plan", "period": period, "amount": 100 }),
        )
        .await;
    let line = t
        .create(
            "budget.budget_line",
            json!({ "budget": id(&original), "account": id(&expense), "planned": 100 }),
        )
        .await;
    t.act("budget.budget", &id(&original), "approved").await;
    let journal = t.create("accounting.journal_entry", json!({ "memo": "Budgeted expense", "amount": 20, "posting_date": chrono::Utc::now().date_naive().to_string(), "lines": [{ "account": id(&expense), "debit": 20, "credit": 0 }, { "account": id(&cash), "debit": 0, "credit": 20 }] })).await;
    t.act("accounting.journal_entry", &id(&journal), "posted")
        .await;
    assert_eq!(
        f(&t.get("budget.budget_line", &id(&line)).await["actual"]),
        20.0
    );
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "budget.budget_line",
                &id(&line),
                o(json!({ "planned": 50 }))
            )
            .await
            .is_err()
    );
    let revision = t.create("budget.budget", json!({ "name": "Revised plan", "period": period, "amount": 150, "adjustment_of": id(&original) })).await;
    t.create(
        "budget.budget_line",
        json!({ "budget": id(&revision), "account": id(&expense), "planned": 150 }),
    )
    .await;
    t.act("budget.budget", &id(&revision), "approved").await;
    assert_eq!(
        t.get("budget.budget", &id(&original)).await["status"],
        "superseded"
    );
    let (status, result) = t.api("GET", "/reports/budget/variance", json!(null)).await;
    assert_eq!(status, 200, "{result}");
    println!(
        "✔ budgets: approved allocation, journal actuals, frozen lines and revision supersession"
    );
}

async fn cases(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["case-management"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Case client" }))
        .await;
    let case = t
        .create(
            "case-management.case",
            json!({ "title": "Consulting matter", "party": id(&party), "opened_on": "2026-01-01" }),
        )
        .await;
    t.create(
        "case-management.case_note",
        json!({ "case": id(&case), "body": "Initial instructions" }),
    )
    .await;
    let entry = t.create("case-management.time_entry", json!({ "case": id(&case), "party": id(&party), "who": "Consultant", "hours": 1.5, "rate": 100, "date": "2026-11-01" })).await;
    assert_eq!(f(&entry["amount"]), 150.0);
    assert!(
        kernel
            .act(&t.a, &t.t, "case-management.case", &id(&case), "closed")
            .await
            .is_err()
    );
    t.act("case-management.time_entry", &id(&entry), "billed")
        .await;
    assert_eq!(
        f(&t.list("accounting.invoice", &[("source_id", &id(&entry))])
            .await[0]["total"]),
        150.0
    );
    t.act("case-management.case", &id(&case), "closed").await;
    assert!(
        t.try_create(
            "case-management.case_note",
            json!({ "case": id(&case), "body": "Late edit" })
        )
        .await
        .is_err()
    );
    println!(
        "✔ case management: valued time, invoicing, unbilled-time close guard and retained notes"
    );
}

async fn charity(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["charity"]).await;
    let program = t
        .create(
            "charity.program",
            json!({ "name": "Assistance", "budget": 1000 }),
        )
        .await;
    let party = t
        .create(
            "master-data.party",
            json!({ "name": "Donor and recipient" }),
        )
        .await;
    let donation = t.create("charity.donation", json!({ "program": id(&program), "donor": id(&party), "amount": 1000, "method": "bank" })).await;
    t.act("charity.donation", &id(&donation), "received").await;
    assert_eq!(
        f(
            &t.list("accounting.payment", &[("source_id", &id(&donation))])
                .await[0]["amount"]
        ),
        1000.0
    );
    let beneficiary = t
        .create(
            "charity.beneficiary",
            json!({ "program": id(&program), "party": id(&party) }),
        )
        .await;
    let expense = t
        .list("accounting.account", &[("code", "642")])
        .await
        .remove(0);
    let payload = json!({ "program": id(&program), "beneficiary": id(&beneficiary), "expense_account": id(&expense), "amount": 700, "method": "bank", "purpose": "Approved support" });
    let payout = t.create("charity.disbursement", payload.clone()).await;
    for action in ["approved", "paid"] {
        t.act("charity.disbursement", &id(&payout), action).await;
    }
    assert_eq!(
        t.list("accounting.payment", &[("source_id", &id(&payout))])
            .await
            .len(),
        1
    );
    let extra = t.create("charity.disbursement", payload).await;
    assert!(
        kernel
            .act(&t.a, &t.t, "charity.disbursement", &id(&extra), "approved")
            .await
            .is_err()
    );
    println!(
        "✔ charity: received donation, approved beneficiary payout and aggregate budget limit"
    );
}

async fn marketing_bi(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["marketing", "bi"]).await;
    let campaign = t.create("marketing.campaign", json!({ "name": "Launch", "channel": "offline", "budget": 100, "start": "2026-01-01", "end": chrono::Utc::now().date_naive().to_string() })).await;
    t.act("marketing.campaign", &id(&campaign), "launched")
        .await;
    let lead = t
        .create("crm.lead", json!({ "name": "Campaign lead" }))
        .await;
    let member = json!({ "campaign": id(&campaign), "lead": id(&lead) });
    t.create("marketing.campaign_member", member.clone()).await;
    assert!(
        t.try_create("marketing.campaign_member", member)
            .await
            .is_err()
    );
    let supplier = t
        .create(
            "master-data.party",
            json!({ "name": "Ad supplier", "is_supplier": true }),
        )
        .await;
    let bill = t
        .create(
            "accounting.bill",
            json!({ "supplier": id(&supplier), "total": 50 }),
        )
        .await;
    t.act("accounting.bill", &id(&bill), "posted").await;
    t.create(
        "marketing.campaign_cost",
        json!({ "campaign": id(&campaign), "bill": id(&bill), "allocated_amount": 50 }),
    )
    .await;
    assert!(
        t.try_create(
            "marketing.campaign_cost",
            json!({ "campaign": id(&campaign), "bill": id(&bill), "allocated_amount": 1 })
        )
        .await
        .is_err()
    );
    t.act("marketing.campaign", &id(&campaign), "completed")
        .await;
    for model in ["first_touch", "last_touch", "linear"] {
        let (status, result) = t
            .api(
                "GET",
                &format!("/reports/marketing/campaign-performance?model={model}"),
                json!(null),
            )
            .await;
        assert_eq!(status, 200, "{model}: {result}");
    }
    let report = t.create("bi.report", json!({ "name": "Attributed leads", "query": { "source": "marketing.campaign_member", "aggregate": { "operation": "count" } } })).await;
    let result = kernel
        .run_bi_report(&t.a, &t.t, &id(&report))
        .await
        .unwrap();
    assert_eq!(result["items"][0]["value"], 1, "{result}");
    let kpi = t.create("bi.kpi", json!({ "name": "Lead target", "report": id(&report), "formula": "value", "target": 2 })).await;
    t.create("bi.dashboard", json!({ "name": "Marketing dashboard", "widgets": [{ "type": "number", "report": id(&report) }, { "type": "kpi", "kpi": id(&kpi) }] })).await;
    let (status, result) = t
        .api(
            "GET",
            &format!("/reports/bi/kpis/{}", id(&kpi)),
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "{result}");
    assert_eq!(f(&result["value"]), 1.0);
    println!(
        "✔ marketing/BI: attribution uniqueness, bill allocation cap, aggregate report and computed KPI"
    );
}

async fn documents(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["document"]).await;
    let parent = t
        .create("document.folder", json!({ "name": "Parent" }))
        .await;
    let child = t
        .create(
            "document.folder",
            json!({ "name": "Child", "parent": id(&parent) }),
        )
        .await;
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "document.folder",
                &id(&parent),
                o(json!({ "parent": id(&child) }))
            )
            .await
            .is_err()
    );
    let document = t.create("document.document", json!({ "title": "Agreement", "folder": id(&child), "file_url": "https://example.test/agreement-v1.pdf" })).await;
    let replaced = t
        .update(
            "document.document",
            &id(&document),
            json!({ "file_url": "https://example.test/agreement-v2.pdf", "version": 2 }),
        )
        .await;
    assert_eq!(f(&replaced["version"]), 2.0);
    let signature = t.create("document.signature_request", json!({ "document": id(&document), "signer_email": "signer@example.test", "signer_name": "Signer" })).await;
    t.act("document.signature_request", &id(&signature), "signed")
        .await;
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "document.document",
                &id(&document),
                o(json!({ "file_url": "https://example.test/other.pdf" }))
            )
            .await
            .is_err()
    );
    assert!(
        kernel
            .remove(&t.a, &t.t, "document.folder", &id(&child))
            .await
            .is_err()
    );
    println!(
        "✔ documents: folder cycle protection, explicit file version and signed-document freeze"
    );
}

async fn messaging(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["communication", "integration-hub"]).await;
    let party = t
        .create(
            "master-data.party",
            json!({ "name": "Reminder recipient", "email": "recipient@example.test" }),
        )
        .await;
    let webhook = t.create("integration-hub.webhook", json!({ "url": "https://example.test/hooks", "events": ["communication.reminder.queued"], "active": true, "secret": "test-signing-secret-32-bytes-long" })).await;
    assert!(
        t.try_create(
            "integration-hub.webhook",
            json!({ "url": "https://127.0.0.1/hooks", "events": ["*"], "active": true })
        )
        .await
        .is_err()
    );
    let key = t
        .create(
            "integration-hub.api_key",
            json!({ "name": "Configuration credential", "scopes": ["read"] }),
        )
        .await;
    t.update(
        "integration-hub.api_key",
        &id(&key),
        json!({ "name": "Renamed credential" }),
    )
    .await;
    let reminder = t.create("communication.reminder", json!({ "party": id(&party), "channel": "email", "subject": "Due reminder", "body": "Your appointment", "send_at": (chrono::Utc::now() - chrono::Duration::minutes(1)).to_rfc3339() })).await;
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 1);
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 0);
    assert_eq!(
        t.get("communication.reminder", &id(&reminder)).await["status"],
        "queued"
    );
    let messages = t.list("communication.message_log", &[]).await;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["status"], "queued");
    assert_eq!(messages[0]["recipient"], id(&party));
    let (status, deliveries) = t.api("GET", "/outbox?status=pending", json!(null)).await;
    assert_eq!(status, 200, "{deliveries}");
    assert!(
        deliveries.to_string().contains(&id(&webhook)),
        "{deliveries}"
    );
    assert!(
        osp_server::modules::integration_hub::run_once(kernel)
            .await
            .unwrap()
            >= 1,
        "the webhook worker should claim the queued test delivery"
    );
    let (status, retries) = t.api("GET", "/outbox?status=retry", json!(null)).await;
    assert_eq!(status, 200, "{retries}");
    assert!(
        retries.as_array().unwrap().iter().any(|delivery| {
            delivery["webhookId"] == id(&webhook)
                && delivery["status"] == "retry"
                && delivery["attempts"] == 1
                && !delivery["error"].as_str().unwrap_or_default().is_empty()
        }),
        "a transient reserved-domain DNS failure should schedule a retry"
    );

    println!(
        "✔ messaging/integration: due reminder queue, one outbox event, credential edits and private-host denial"
    );
}
