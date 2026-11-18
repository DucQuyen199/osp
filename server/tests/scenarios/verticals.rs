use super::{Ctx, f, id};
use osp_server::{kernel::Kernel, money};
use rust_decimal::Decimal;
use serde_json::json;
use std::sync::Arc;

#[async_recursion::async_recursion]
pub(super) async fn run(kernel: &Arc<Kernel>) {
    ecommerce(kernel).await;
    hotel(kernel).await;
    utilities(kernel).await;
    lending(kernel).await;
    school(kernel).await;
}

async fn ecommerce(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["ecommerce"]).await;
    let warehouse = t.warehouse().await;
    let party = t
        .create("master-data.party", json!({ "name": "Online customer" }))
        .await;
    let product = t
        .create(
            "master-data.product",
            json!({ "sku": "ONLINE", "name": "Online goods", "price": 100, "cost": 50 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "warehouse": warehouse, "product": id(&product), "qty": 5, "direction": "in" }),
    )
    .await;
    let list = t
        .create(
            "sales.price_list",
            json!({ "name": "Web price", "items": [{ "product": id(&product), "price": 80 }] }),
        )
        .await;
    let tax = t
        .create("master-data.tax", json!({ "name": "Web tax", "rate": 10 }))
        .await;
    let shop = t.create("ecommerce.storefront", json!({ "name": "Shop", "warehouse": warehouse, "price_list": id(&list), "tax": id(&tax) })).await;
    let cart = t.create("ecommerce.web_order", json!({ "party": id(&party), "storefront": id(&shop), "lines": [{ "product": id(&product), "qty": 2, "price": 1, "discount_pct": 99, "tax_rate": 0 }] })).await;
    assert_eq!(
        f(&cart["total"]),
        176.0,
        "Cart price includes the server-selected tax and price list"
    );
    t.act("ecommerce.web_order", &id(&cart), "placed").await;
    let order = t
        .list("sales.sales_order", &[("source_id", &id(&cart))])
        .await
        .remove(0);
    assert_eq!(order["status"], "confirmed");
    assert_eq!(f(&order["total"]), 176.0);
    assert_eq!(t.stock(&id(&product)).await, 3.0);
    assert!(
        t.list("accounting.invoice", &[("source_id", &id(&order))])
            .await
            .is_empty(),
        "An ecommerce sales order is invoiced after delivery"
    );
    assert!(
        kernel
            .act(&t.a, &t.t, "ecommerce.web_order", &id(&cart), "placed")
            .await
            .is_err()
    );
    assert_eq!(
        t.list("sales.sales_order", &[("source_id", &id(&cart))])
            .await
            .len(),
        1
    );
    let excessive = t.create("ecommerce.web_order", json!({ "party": id(&party), "storefront": id(&shop), "lines": [{ "product": id(&product), "qty": 4 }] })).await;
    assert!(
        kernel
            .act(&t.a, &t.t, "ecommerce.web_order", &id(&excessive), "placed")
            .await
            .is_err()
    );
    assert_eq!(
        t.get("ecommerce.web_order", &id(&excessive)).await["status"],
        "cart"
    );
    assert!(
        t.list("sales.sales_order", &[("source_id", &id(&excessive))])
            .await
            .is_empty()
    );
    println!("✔ ecommerce: trusted pricing/tax, atomic fulfillment, duplicate and oversell guards");
}

async fn hotel(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["hotel"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Hotel guest" }))
        .await;
    let kind = t
        .create(
            "hotel.room_type",
            json!({ "name": "Standard", "rate": 100, "capacity": 1 }),
        )
        .await;
    let room = t
        .create(
            "hotel.room",
            json!({ "number": "101", "room_type": id(&kind) }),
        )
        .await;
    let today = kernel.tenant(&t.t.id).await.unwrap().business_today();
    let start = (today - chrono::Duration::days(2)).to_string();
    let end = (today + chrono::Duration::days(1)).to_string();
    let reservation = t
        .create(
            "hotel.reservation",
            json!({ "party": id(&party), "room": id(&room), "check_in": start, "check_out": end }),
        )
        .await;
    assert_eq!(f(&reservation["total"]), 300.0);
    assert!(
        t.try_create(
            "hotel.reservation",
            json!({ "party": id(&party), "room": id(&room), "check_in": start, "check_out": end })
        )
        .await
        .is_err()
    );
    t.act("hotel.reservation", &id(&reservation), "checked_in")
        .await;
    assert_eq!(t.get("hotel.room", &id(&room)).await["status"], "occupied");
    t.create(
        "hotel.folio_charge",
        json!({ "reservation": id(&reservation), "description": "Laundry", "amount": 25 }),
    )
    .await;
    assert_eq!(
        f(&t.get("hotel.reservation", &id(&reservation)).await["total"]),
        325.0
    );
    t.act("hotel.reservation", &id(&reservation), "checked_out")
        .await;
    assert_eq!(t.get("hotel.room", &id(&room)).await["status"], "cleaning");
    let invoices = t
        .list("accounting.invoice", &[("source_id", &id(&reservation))])
        .await;
    assert_eq!(invoices.len(), 1);
    assert_eq!(f(&invoices[0]["total"]), 325.0);
    assert!(
        t.try_create(
            "hotel.folio_charge",
            json!({ "reservation": id(&reservation), "description": "Late change", "amount": 10 })
        )
        .await
        .is_err()
    );
    let second_room = t
        .create(
            "hotel.room",
            json!({ "number": "102", "room_type": id(&kind) }),
        )
        .await;
    let second_reservation = t.create("hotel.reservation", json!({ "party": id(&party), "room": id(&second_room), "check_in": today.to_string(), "check_out": (today + chrono::Duration::days(1)).to_string() })).await;
    t.act("hotel.reservation", &id(&second_reservation), "checked_in")
        .await;
    t.act("hotel.reservation", &id(&second_reservation), "checked_out")
        .await;
    let (status, first_page) = t
        .api(
            "GET",
            "/reports/hotel/housekeeping-board?limit=1&offset=0",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "housekeeping page: {first_page}");
    assert_eq!(first_page["itemCount"], 2);
    assert_eq!(first_page["cleaningCount"], 2);
    assert_eq!(first_page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(first_page["pageSize"], 1);
    assert_eq!(first_page["offset"], 0);
    assert_eq!(first_page["hasMore"], true);
    let (status, last_page) = t
        .api(
            "GET",
            "/reports/hotel/housekeeping-board?limit=1&offset=1",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "housekeeping last page: {last_page}");
    assert_eq!(last_page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(last_page["offset"], 1);
    assert_eq!(last_page["hasMore"], false);
    t.act("hotel.room", &id(&room), "ready").await;
    t.act("hotel.room", &id(&second_room), "ready").await;
    assert_eq!(t.get("hotel.room", &id(&room)).await["status"], "vacant");
    println!("✔ hotel: capacity/overlap, rate snapshot, folio, checkout invoice and housekeeping");
}

async fn utilities(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["utilities"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Meter customer" }))
        .await;
    let meter = t
        .create(
            "utilities.meter",
            json!({ "party": id(&party), "code": "M-001", "rate": 2.5, "opening_reading": 50 }),
        )
        .await;
    let reading = t.create("utilities.meter_reading", json!({ "meter": id(&meter), "reading": 75, "period": "2020-01", "previous_reading": 1, "amount": 1 })).await;
    assert_eq!(f(&reading["previous_reading"]), 50.0);
    assert_eq!(f(&reading["amount"]), 62.5);
    assert!(
        t.try_create(
            "utilities.meter_reading",
            json!({ "meter": id(&meter), "reading": 80, "period": "2020-01" })
        )
        .await
        .is_err()
    );
    assert!(
        t.try_create(
            "utilities.meter_reading",
            json!({ "meter": id(&meter), "reading": 70, "period": "2020-02" })
        )
        .await
        .is_err()
    );
    let bill = t
        .create(
            "utilities.utility_bill",
            json!({ "meter_reading": id(&reading) }),
        )
        .await;
    t.act("utilities.utility_bill", &id(&bill), "issued").await;
    assert!(
        kernel
            .act(&t.a, &t.t, "utilities.utility_bill", &id(&bill), "paid")
            .await
            .is_err()
    );
    let invoice = t
        .list("accounting.invoice", &[("source_id", &id(&bill))])
        .await
        .remove(0);
    t.create(
        "accounting.payment",
        json!({ "party": id(&party), "invoice": id(&invoice), "amount": 62.5, "method": "bank" }),
    )
    .await;
    assert_eq!(
        t.get("utilities.utility_bill", &id(&bill)).await["status"],
        "paid"
    );
    println!(
        "✔ utilities: opening reading, trusted consumption, duplicate/monotonic checks and settlement"
    );
}

async fn lending(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["lending"]).await;
    let (_, reviewer_token) = kernel
        .add_user(
            &t.t,
            "Independent loan reviewer",
            None,
            None,
            &["admin".into()],
        )
        .await
        .unwrap();
    let (_, reviewer, _) = kernel.authenticate(&reviewer_token.unwrap()).await.unwrap();
    let (_, disburser_token) = kernel
        .add_user(
            &t.t,
            "Independent loan disburser",
            None,
            None,
            &["admin".into()],
        )
        .await
        .unwrap();
    let (_, disburser, _) = kernel
        .authenticate(&disburser_token.unwrap())
        .await
        .unwrap();
    let party = t
        .create("master-data.party", json!({ "name": "Borrower" }))
        .await;
    let first_due_date =
        kernel.tenant(&t.t.id).await.unwrap().business_today() + chrono::Duration::days(30);
    let loan = t.create("lending.loan", json!({ "party": id(&party), "principal": 3000, "rate": 12, "term_months": 3, "method": "bank", "first_due_date": first_due_date.to_string() })).await;
    kernel
        .act(&reviewer, &t.t, "lending.loan", &id(&loan), "approved")
        .await
        .unwrap();
    kernel
        .act(&disburser, &t.t, "lending.loan", &id(&loan), "disbursed")
        .await
        .unwrap();
    let installments = t.list("lending.repayment", &[("loan", &id(&loan))]).await;
    assert_eq!(installments.len(), 3);
    let principal: Decimal = installments
        .iter()
        .map(|row| money::decimal(&row["principal_component"]).unwrap())
        .sum();
    assert_eq!(principal, Decimal::from(3000));
    assert!(
        kernel
            .act(&t.a, &t.t, "lending.loan", &id(&loan), "closed")
            .await
            .is_err()
    );
    for repayment in &installments {
        t.update(
            "lending.repayment",
            &id(repayment),
            json!({ "method": "bank" }),
        )
        .await;
        t.act("lending.repayment", &id(repayment), "paid").await;
        assert_eq!(
            t.list("accounting.payment", &[("source_id", &id(repayment))])
                .await
                .len(),
            1
        );
    }
    t.act("lending.loan", &id(&loan), "closed").await;
    println!("✔ lending: disbursement, exact amortization principal, repayments and payoff guard");
}

async fn school(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["school"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Student customer" }))
        .await;
    let student = t
        .create(
            "school.student",
            json!({ "party": id(&party), "student_code": "ST-1" }),
        )
        .await;
    let class = t
        .create(
            "school.course_class",
            json!({ "name": "Class 1", "capacity": 1, "tuition": 100 }),
        )
        .await;
    let enrollment = t
        .create(
            "school.class_enrollment",
            json!({ "student": id(&student), "class": id(&class) }),
        )
        .await;
    assert!(
        t.try_create(
            "school.class_enrollment",
            json!({ "student": id(&student), "class": id(&class) })
        )
        .await
        .is_err()
    );
    let fee = t
        .create(
            "school.fee",
            json!({ "student": id(&student), "enrollment": id(&enrollment), "period": "2020-01" }),
        )
        .await;
    assert_eq!(f(&fee["amount"]), 100.0);
    t.act("school.fee", &id(&fee), "issued").await;
    let invoice = t
        .list("accounting.invoice", &[("source_id", &id(&fee))])
        .await
        .remove(0);
    t.create(
        "accounting.payment",
        json!({ "party": id(&party), "invoice": id(&invoice), "amount": 100, "method": "bank" }),
    )
    .await;
    assert_eq!(t.get("school.fee", &id(&fee)).await["status"], "paid");
    t.create("school.grade", json!({ "enrollment": id(&enrollment), "term": "2020-01", "subject": "Math", "score": 8.5 })).await;
    assert!(t.try_create("school.grade", json!({ "enrollment": id(&enrollment), "term": "2020-01", "subject": "Math", "score": 9 })).await.is_err());
    t.act("school.class_enrollment", &id(&enrollment), "completed")
        .await;
    println!(
        "✔ school: enrollment uniqueness, tuition snapshot, invoice settlement and grade history"
    );
}
