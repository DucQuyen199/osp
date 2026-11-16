use super::{Ctx, f, id, o};
use osp_server::kernel::Kernel;
use serde_json::json;
use std::sync::Arc;

#[async_recursion::async_recursion]
pub(super) async fn run(kernel: &Arc<Kernel>) {
    sales_returns(kernel).await;
    purchase_returns(kernel).await;
    provider_payments(kernel).await;
    approvals(kernel).await;
    rent(kernel).await;
}

async fn purchase_returns(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["purchasing", "payments"]).await;
    let warehouse = t.warehouse().await;
    let supplier = t
        .create(
            "master-data.party",
            json!({ "name": "Return supplier", "is_supplier": true }),
        )
        .await;
    let product = t
        .create(
            "master-data.product",
            json!({ "sku": "PRET", "name": "Purchased item", "cost": 100 }),
        )
        .await;
    let tax = t
        .create(
            "master-data.tax",
            json!({ "name": "Input VAT", "rate": 10 }),
        )
        .await;
    let order = t.create("purchasing.purchase_order", json!({ "supplier": id(&supplier), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 4, "price": 100, "tax": id(&tax) }] })).await;
    for action in ["submitted", "approved"] {
        t.act("purchasing.purchase_order", &id(&order), action)
            .await;
    }
    for qty in [1, 3] {
        let receipt = t.create("purchasing.purchase_receipt", json!({ "purchase_order": id(&order), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": qty, "price": 100 }] })).await;
        t.act("purchasing.purchase_receipt", &id(&receipt), "received")
            .await;
        for inspection in t
            .list("quality.inspection", &[("source_id", &id(&receipt))])
            .await
        {
            t.act("quality.inspection", &id(&inspection), "passed")
                .await;
        }
        assert_eq!(
            t.get("purchasing.purchase_order", &id(&order)).await["status"],
            if qty == 1 {
                "partially_received"
            } else {
                "received"
            }
        );
    }
    assert_eq!(t.stock(&id(&product)).await, 4.0);
    let issue_date = kernel.tenant(&t.t.id).await.unwrap().business_today();
    let supplier_invoice = t
        .create(
            "purchasing.supplier_invoice",
            json!({
                "purchase_order": id(&order),
                "supplier": id(&supplier),
                "invoice_number": "SUP-RET-001",
                "issue_date": issue_date.to_string(),
                "lines": [{ "product": id(&product), "qty": 4, "price": 100, "tax": id(&tax) }]
            }),
        )
        .await;
    t.act(
        "purchasing.supplier_invoice",
        &id(&supplier_invoice),
        "approved",
    )
    .await;
    let bill = t
        .list("accounting.bill", &[("source_id", &id(&order))])
        .await
        .remove(0);
    assert_eq!(f(&bill["total"]), 440.0);
    let capture = t.create("payments.payment_txn", json!({ "provider": "stripe", "party": id(&supplier), "bill": id(&bill), "amount": 220, "method": "card", "reference": "supplier-return-capture" })).await;
    t.act("payments.payment_txn", &id(&capture), "succeeded")
        .await;
    for _ in 0..2 {
        let returned = t.create("purchasing.purchase_return", json!({ "purchase_order": id(&order), "supplier_invoice": id(&supplier_invoice), "warehouse": warehouse, "reason": "Supplier return", "lines": [{ "product": id(&product), "qty": 2, "price": 100 }] })).await;
        for action in ["submitted", "approved", "dispatched"] {
            t.act("purchasing.purchase_return", &id(&returned), action)
                .await;
        }
    }
    assert_eq!(t.stock(&id(&product)).await, 0.0);
    let bill = t.get("accounting.bill", &id(&bill)).await;
    assert_eq!(bill["status"], "settled");
    assert_eq!(f(&bill["paid_amount"]), 220.0);
    assert_eq!(f(&bill["adjustment_amount"]), 440.0);
    assert_eq!(
        t.list("accounting.debit_note", &[("bill", &id(&bill))])
            .await
            .len(),
        2
    );
    println!(
        "✔ purchasing: partial receipts/QC, taxed bill, partial payment, full supplier return/refund"
    );
}

async fn sales_returns(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["sales", "loyalty", "payments"]).await;
    let warehouse = t.warehouse().await;
    let party = t
        .create("master-data.party", json!({ "name": "Returns customer" }))
        .await;
    let member = t
        .create("loyalty.member", json!({ "party": id(&party) }))
        .await;
    let product = t
        .create(
            "master-data.product",
            json!({ "sku": "RET", "name": "Returnable item", "price": 100000, "cost": 50000 }),
        )
        .await;
    let tax = t
        .create(
            "master-data.tax",
            json!({ "name": "Return tax", "rate": 10 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&product), "warehouse": warehouse, "qty": 10, "direction": "in" }),
    )
    .await;
    let order = t.create("sales.sales_order", json!({ "party": id(&party), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 4, "price": 100000, "tax": id(&tax) }] })).await;
    t.act("sales.sales_order", &id(&order), "confirmed").await;
    assert_eq!(t.stock(&id(&product)).await, 6.0);
    assert_eq!(
        f(&t.get("loyalty.member", &id(&member)).await["points"]),
        44.0
    );
    t.act("sales.sales_order", &id(&order), "delivered").await;
    let invoice = t
        .list("accounting.invoice", &[("source_id", &id(&order))])
        .await
        .remove(0);
    let capture = t.create(
        "payments.payment_txn",
        json!({ "provider": "stripe", "party": id(&party), "invoice": id(&invoice), "amount": 220000, "method": "card", "reference": "return-capture" }),
    ).await;
    t.act("payments.payment_txn", &id(&capture), "succeeded")
        .await;
    assert_eq!(
        t.get("accounting.invoice", &id(&invoice)).await["status"],
        "partially_paid"
    );
    let returned = t.create("sales.sales_return", json!({ "sales_order": id(&order), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 2, "price": 100000 }] })).await;
    for action in ["submitted", "approved", "received"] {
        t.act("sales.sales_return", &id(&returned), action).await;
    }
    assert_eq!(t.stock(&id(&product)).await, 8.0);
    assert_eq!(
        f(&t.get("loyalty.member", &id(&member)).await["points"]),
        22.0
    );
    let credits = t
        .list("accounting.credit_note", &[("invoice", &id(&invoice))])
        .await;
    assert_eq!(credits.len(), 1);
    assert_eq!(f(&credits[0]["total"]), 220000.0);
    assert_eq!(
        t.get("accounting.invoice", &id(&invoice)).await["status"],
        "settled"
    );
    let extra = t.create("sales.sales_return", json!({ "sales_order": id(&order), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 3, "price": 100000 }] })).await;
    assert!(
        kernel
            .act(&t.a, &t.t, "sales.sales_return", &id(&extra), "submitted")
            .await
            .is_err()
    );
    assert_eq!(t.stock(&id(&product)).await, 8.0);
    let remaining = t.create("sales.sales_return", json!({ "sales_order": id(&order), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 2, "price": 100000 }] })).await;
    for action in ["submitted", "approved", "received"] {
        t.act("sales.sales_return", &id(&remaining), action).await;
    }
    assert_eq!(t.stock(&id(&product)).await, 10.0);
    assert_eq!(
        f(&t.get("loyalty.member", &id(&member)).await["points"]),
        0.0
    );
    let invoice = t.get("accounting.invoice", &id(&invoice)).await;
    assert_eq!(invoice["status"], "settled");
    assert_eq!(f(&invoice["paid_amount"]), 220000.0);
    assert_eq!(f(&invoice["adjustment_amount"]), 440000.0);
    println!(
        "✔ sales returns: partial payment, full return/refund, tax/COGS/points reversal and quantity cap"
    );
}

async fn provider_payments(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["payments"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Payment customer" }))
        .await;
    let invoice = t
        .create(
            "accounting.invoice",
            json!({ "party": id(&party), "total": 100 }),
        )
        .await;
    t.act("accounting.invoice", &id(&invoice), "posted").await;
    let payload = json!({ "provider": "stripe", "party": id(&party), "invoice": id(&invoice), "amount": 100, "method": "card", "reference": " capture-1 " });
    let payment = t.create("payments.payment_txn", payload.clone()).await;
    assert_eq!(payment["reference"], "capture-1");
    assert!(t.try_create("payments.payment_txn", payload).await.is_err());
    t.act("payments.payment_txn", &id(&payment), "succeeded")
        .await;
    assert_eq!(
        t.get("accounting.invoice", &id(&invoice)).await["status"],
        "paid"
    );
    assert_eq!(
        t.list("accounting.payment", &[("source_id", &id(&payment))])
            .await
            .len(),
        1
    );
    let payments = t
        .list("accounting.payment", &[("source_id", &id(&payment))])
        .await;
    assert_eq!(payments.len(), 1);
    assert_eq!(
        payments.iter().map(|row| f(&row["amount"])).sum::<f64>(),
        100.0
    );
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "payments.payment_txn",
                &id(&payment),
                "refunded"
            )
            .await
            .is_err()
    );
    println!(
        "✔ payment ledger: canonical provider reference, single capture, refund and invoice reopening"
    );
}

async fn approvals(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["purchasing", "workflow-approval"]).await;
    let (reviewer, token) = kernel
        .add_user(&t.t, "Independent reviewer", None, None, &["admin".into()])
        .await
        .unwrap();
    let (_, reviewer_actor, _) = kernel.authenticate(&token.unwrap()).await.unwrap();
    t.create("workflow-approval.approval_rule", json!({ "name": "Independent purchase review", "entity": "purchasing.purchase_order", "min_amount": 0, "approvers": { "users": [reviewer.id] } })).await;
    let warehouse = t.warehouse().await;
    let supplier = t
        .create(
            "master-data.party",
            json!({ "name": "Approval supplier", "is_supplier": true }),
        )
        .await;
    let product = t
        .create(
            "master-data.product",
            json!({ "sku": "APR", "name": "Approval goods", "cost": 10 }),
        )
        .await;
    let order = t.create("purchasing.purchase_order", json!({ "supplier": id(&supplier), "warehouse": warehouse, "lines": [{ "product": id(&product), "qty": 1, "price": 10 }] })).await;
    t.act("purchasing.purchase_order", &id(&order), "submitted")
        .await;
    let request = t
        .list(
            "workflow-approval.approval_request",
            &[("record_id", &id(&order))],
        )
        .await
        .remove(0);
    assert_eq!(
        kernel
            .act(
                &t.a,
                &t.t,
                "workflow-approval.approval_request",
                &id(&request),
                "approved"
            )
            .await
            .unwrap_err()
            .code,
        "FORBIDDEN"
    );
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "purchasing.purchase_order",
                &id(&order),
                "approved"
            )
            .await
            .is_err()
    );
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "purchasing.purchase_order",
                &id(&order),
                "cancelled"
            )
            .await
            .is_err()
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
        t.get("purchasing.purchase_order", &id(&order)).await["status"],
        "rejected"
    );
    t.update(
        "purchasing.purchase_order",
        &id(&order),
        json!({ "lines": [{ "product": id(&product), "qty": 2, "price": 10 }] }),
    )
    .await;
    t.act("purchasing.purchase_order", &id(&order), "submitted")
        .await;
    let pending = t
        .list(
            "workflow-approval.approval_request",
            &[("record_id", &id(&order)), ("status", "pending")],
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
        t.get("purchasing.purchase_order", &id(&order)).await["status"],
        "approved"
    );
    println!("✔ shared approval: separation of duties, no bypass, rejection/revision and approval");
}

async fn rent(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["real-estate"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Tenant customer" }))
        .await;
    let property = t
        .create("real-estate.property", json!({ "title": "Unit A" }))
        .await;
    let start = chrono::Utc::now().date_naive();
    let end = start + chrono::Duration::days(60);
    let lease = t.create("real-estate.lease", json!({ "property": id(&property), "tenant": id(&party), "rent": 100, "billing_interval": "monthly", "start_date": start.to_string(), "end_date": end.to_string() })).await;
    t.act("real-estate.lease", &id(&lease), "activated").await;
    assert_eq!(
        t.get("real-estate.property", &id(&property)).await["status"],
        "leased"
    );
    assert_eq!(
        t.list("contract.contract", &[("source_id", &id(&lease))])
            .await
            .len(),
        1
    );
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 1);
    let cycles = t
        .list("real-estate.rent_cycle", &[("lease", &id(&lease))])
        .await;
    assert_eq!(cycles.len(), 1);
    assert_eq!(
        t.list("accounting.invoice", &[("source_id", &id(&cycles[0]))])
            .await
            .len(),
        1
    );
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 0);
    t.act("real-estate.lease", &id(&lease), "terminated").await;
    assert_eq!(
        t.get("real-estate.property", &id(&property)).await["status"],
        "available"
    );
    assert_eq!(
        t.list("contract.contract", &[("source_id", &id(&lease))])
            .await[0]["status"],
        "terminated"
    );
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "real-estate.rent_cycle",
                &id(&cycles[0]),
                o(json!({ "amount": 1 }))
            )
            .await
            .is_err()
    );
    assert!(
        kernel
            .remove(&t.a, &t.t, "real-estate.rent_cycle", &id(&cycles[0]))
            .await
            .is_err()
    );
    println!(
        "✔ leases: property/contract synchronization, recurring billing and immutable rent history"
    );
}
