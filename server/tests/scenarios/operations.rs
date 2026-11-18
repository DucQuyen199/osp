use super::{Ctx, f, id, o};
use osp_server::kernel::Kernel;
use serde_json::json;
use std::sync::Arc;

#[async_recursion::async_recursion]
pub(super) async fn run(kernel: &Arc<Kernel>) {
    logistics(kernel).await;
    restaurant(kernel).await;
    tickets(kernel).await;
    projects(kernel).await;
    learning(kernel).await;
    insurance(kernel).await;
    agriculture(kernel).await;
    services(kernel).await;
    recruitment(kernel).await;
    pharmacy(kernel).await;
    automotive(kernel).await;
    beauty_wellness_bookings(kernel).await;
}

async fn beauty_wellness_bookings(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, Some("beauty-wellness"), &[]).await;
    let guest = t
        .create("master-data.party", json!({ "name": "Salon customer" }))
        .await;
    let stylist = t
        .create(
            "booking.resource",
            json!({ "name": "Senior stylist", "kind": "staff" }),
        )
        .await;
    let haircut = t
        .create(
            "booking.service",
            json!({ "name": "Haircut", "duration_min": 45, "price": 75 }),
        )
        .await;
    let coloring = t
        .create(
            "booking.service",
            json!({ "name": "Hair coloring", "duration_min": 90, "price": 180 }),
        )
        .await;
    let starts_at = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(2))
        .unwrap()
        .to_rfc3339();
    let appointment = t
        .create(
            "booking.booking",
            json!({ "party": id(&guest), "resource": id(&stylist), "service": id(&haircut), "starts_at": starts_at }),
        )
        .await;
    let start =
        chrono::DateTime::parse_from_rfc3339(appointment["starts_at"].as_str().unwrap()).unwrap();
    let end =
        chrono::DateTime::parse_from_rfc3339(appointment["ends_at"].as_str().unwrap()).unwrap();
    assert_eq!((end - start).num_minutes(), 45);
    assert_eq!(appointment["price"], 75.0);
    let overlapping_start = (start + chrono::Duration::minutes(30)).to_rfc3339();
    assert_eq!(
        t.try_create(
            "booking.booking",
            json!({ "party": id(&guest), "resource": id(&stylist), "service": id(&haircut), "starts_at": overlapping_start }),
        )
        .await
        .unwrap_err(),
        "CONSTRAINT",
        "service duration must be included in resource conflict checks"
    );
    let repriced = t
        .update(
            "booking.booking",
            &id(&appointment),
            json!({ "service": id(&coloring) }),
        )
        .await;
    let repriced_start =
        chrono::DateTime::parse_from_rfc3339(repriced["starts_at"].as_str().unwrap()).unwrap();
    let repriced_end =
        chrono::DateTime::parse_from_rfc3339(repriced["ends_at"].as_str().unwrap()).unwrap();
    assert_eq!((repriced_end - repriced_start).num_minutes(), 90);
    assert_eq!(repriced["price"], 180.0);
    t.act("booking.booking", &id(&appointment), "confirmed")
        .await;
    assert!(
        t.k.update(
            &t.a,
            &t.t,
            "booking.booking",
            &id(&appointment),
            o(json!({ "service": id(&haircut) })),
        )
        .await
        .is_err(),
        "a confirmed appointment cannot be moved or repriced in place"
    );
    println!(
        "âœ” beauty/wellness: service duration and price snapshots, staff conflict prevention, confirmed appointment immutability"
    );
}

async fn automotive(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, Some("automotive"), &[]).await;
    let warehouse = t.warehouse().await;
    let customer = t
        .create("master-data.party", json!({ "name": "Garage customer" }))
        .await;
    let part = t
        .create(
            "master-data.product",
            json!({ "sku": "GARAGE-FILTER", "name": "Oil filter", "kind": "goods", "tracked": true, "cost": 10, "price": 20 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&part), "warehouse": warehouse, "qty": 2, "direction": "in" }),
    )
    .await;
    let vehicle = t
        .create(
            "auto-service.vehicle",
            json!({ "party": id(&customer), "plate": " 51a-12345 ", "vin": "garage-vin-001", "odometer": 103000 }),
        )
        .await;
    assert_eq!(vehicle["plate"], "51A-12345");
    assert_eq!(vehicle["vin"], "GARAGE-VIN-001");
    assert!(
        t.try_create(
            "auto-service.vehicle",
            json!({ "party": id(&customer), "plate": "51a-12345", "vin": "another-vin", "odometer": 0 }),
        )
        .await
        .is_err(),
        "vehicle plates must be unique independent of case and surrounding spaces"
    );
    let order = t
        .create(
            "auto-service.repair_order",
            json!({
                "vehicle": id(&vehicle),
                "party": id(&customer),
                "odometer_reading": 105000,
                "warehouse": warehouse,
                "complaint": "Replace oil filter",
                "lines": [{ "product": id(&part), "qty": 1 }]
            }),
        )
        .await;
    assert_eq!(order["status"], "intake");
    assert_eq!(order["total"], 20.0);
    assert_eq!(order["lines"][0]["price"], 20.0);
    assert!(
        t.try_create(
            "auto-service.repair_order",
            json!({
                "vehicle": id(&vehicle), "party": id(&customer), "odometer_reading": 104000,
                "lines": [{ "product": id(&part), "qty": 1 }]
            }),
        )
        .await
        .is_err(),
        "a vehicle cannot have concurrent open repairs or a mileage rollback"
    );
    t.act("auto-service.repair_order", &id(&order), "approved")
        .await;
    assert!(
        t.k.update(
            &t.a,
            &t.t,
            "auto-service.repair_order",
            &id(&order),
            o(json!({ "lines": [{ "product": id(&part), "qty": 2 }] })),
        )
        .await
        .is_err(),
        "a customer-approved quote cannot be changed"
    );
    t.act("auto-service.repair_order", &id(&order), "started")
        .await;
    t.act("auto-service.repair_order", &id(&order), "completed")
        .await;
    assert_eq!(t.stock(&id(&part)).await, 1.0);
    let invoices = t
        .list(
            "accounting.invoice",
            &[("source", "repair_order"), ("source_id", &id(&order))],
        )
        .await;
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0]["status"], "posted");
    assert_eq!(invoices[0]["total"], 20.0);
    t.act("auto-service.repair_order", &id(&order), "delivered")
        .await;
    assert!(
        t.k.remove(&t.a, &t.t, "auto-service.repair_order", &id(&order))
            .await
            .is_err(),
        "delivered repair history cannot be deleted"
    );
    assert!(
        t.k.update(
            &t.a,
            &t.t,
            "auto-service.vehicle",
            &id(&vehicle),
            o(json!({ "odometer": 104000 })),
        )
        .await
        .is_err(),
        "vehicle mileage cannot be reduced below its repair history"
    );
    println!(
        "âœ” automotive: normalized vehicle identity, monotonic mileage, approved quote, stock issue, posted invoice and immutable delivery history"
    );
}

async fn pharmacy(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, Some("pharmacy"), &[]).await;
    let warehouse = t.warehouse().await;
    let session = t
        .create(
            "pos.pos_session",
            json!({ "warehouse": warehouse, "opening_cash": 0 }),
        )
        .await;
    let party = t
        .create("master-data.party", json!({ "name": "Pharmacy customer" }))
        .await;
    let other_party = t
        .create("master-data.party", json!({ "name": "Different customer" }))
        .await;
    let medicine = t
        .create(
            "master-data.product",
            json!({
                "sku": "RX-001",
                "name": "Prescription medicine",
                "price": 5,
                "requires_prescription": true
            }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&medicine), "warehouse": warehouse, "qty": 20, "direction": "in" }),
    )
    .await;
    let today = kernel.tenant(&t.t.id).await.unwrap().business_today();
    let prescription = t
        .create(
            "pharmacy.prescription",
            json!({
                "prescription_no": "RX-TEST-001",
                "party": id(&party),
                "prescriber": "Dr Test",
                "issued_at": today.to_string(),
                "valid_until": (today + chrono::Duration::days(30)).to_string(),
                "items": [{ "product": id(&medicine), "qty": 6, "dosage": "Uống một viên mỗi tám giờ" }]
            }),
        )
        .await;
    t.act("pharmacy.prescription", &id(&prescription), "verified")
        .await;

    assert!(
        t.try_create(
            "pos.pos_order",
            json!({
                "party": id(&other_party),
                "warehouse": warehouse,
                "session": id(&session),
                "prescription": id(&prescription),
                "method": "card",
                "lines": [{ "product": id(&medicine), "qty": 2, "price": 5 }]
            }),
        )
        .await
        .is_err()
    );
    assert!(
        t.try_create(
            "pos.pos_order",
            json!({
                "party": id(&party),
                "warehouse": warehouse,
                "session": id(&session),
                "prescription": id(&prescription),
                "method": "cash",
                "lines": [{ "product": id(&medicine), "qty": 7, "price": 5 }]
            }),
        )
        .await
        .is_err()
    );

    let first_dispense = t
        .create(
            "pos.pos_order",
            json!({
                "party": id(&party),
                "warehouse": warehouse,
                "session": id(&session),
                "prescription": id(&prescription),
                "method": "card",
                "lines": [{ "product": id(&medicine), "qty": 2, "price": 5 }]
            }),
        )
        .await;
    t.act("pos.pos_order", &id(&first_dispense), "completed")
        .await;
    assert_eq!(
        t.get("pharmacy.prescription", &id(&prescription)).await["status"],
        "partially_dispensed"
    );

    let final_dispense = t
        .create(
            "pos.pos_order",
            json!({
                "party": id(&party),
                "warehouse": warehouse,
                "session": id(&session),
                "prescription": id(&prescription),
                "method": "card",
                "lines": [{ "product": id(&medicine), "qty": 4, "price": 5 }]
            }),
        )
        .await;
    t.act("pos.pos_order", &id(&final_dispense), "completed")
        .await;
    assert_eq!(
        t.get("pharmacy.prescription", &id(&prescription)).await["status"],
        "dispensed"
    );
    assert_eq!(t.stock(&id(&medicine)).await, 14.0);
    println!("✔ pharmacy: patient match, quantity limits, partial and complete POS dispensing");
}

async fn services(kernel: &Arc<Kernel>) {
    let t = Ctx::new(
        kernel,
        None,
        &["field-service", "helpdesk", "maintenance", "auto-service"],
    )
    .await;
    let warehouse = t.warehouse().await;
    let party = t
        .create("master-data.party", json!({ "name": "Service customer" }))
        .await;
    let part = t
        .create(
            "master-data.product",
            json!({ "sku": "PART", "name": "Service part", "cost": 10, "price": 20 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&part), "warehouse": warehouse, "qty": 20, "direction": "in" }),
    )
    .await;
    let technician = t
        .create(
            "hrm.employee",
            json!({ "name": "Technician", "hire_date": "2020-01-01" }),
        )
        .await;
    let ticket = t.create("helpdesk.ticket", json!({ "subject": "On-site repair", "party": id(&party), "channel": "field", "assignee": "Support agent", "resolution": "Replacement installed" })).await;
    let work = t
        .list(
            "field-service.work_order",
            &[("source_ticket", &id(&ticket))],
        )
        .await
        .remove(0);
    let start = chrono::Utc::now() + chrono::Duration::days(1);
    let end = start + chrono::Duration::hours(1);
    t.update("field-service.work_order", &id(&work), json!({ "technician_employee": id(&technician), "scheduled_at": start.to_rfc3339(), "scheduled_end": end.to_rfc3339(), "warehouse": warehouse, "lines": [{ "product": id(&part), "qty": 2, "price": 20 }] })).await;
    assert!(t.try_create("field-service.work_order", json!({ "party": id(&party), "title": "Conflicting job", "technician_employee": id(&technician), "scheduled_at": start.to_rfc3339(), "scheduled_end": end.to_rfc3339() })).await.is_err());
    for action in ["dispatched", "done"] {
        t.act("field-service.work_order", &id(&work), action).await;
    }
    assert_eq!(t.stock(&id(&part)).await, 18.0);
    assert_eq!(
        f(&t.list("accounting.invoice", &[("source_id", &id(&work))])
            .await[0]["total"]),
        40.0
    );
    t.create(
        "helpdesk.message",
        json!({ "ticket": id(&ticket), "direction": "outbound", "author": "Support agent", "body": "Replacement installed" }),
    )
    .await;
    for action in ["resolved", "closed"] {
        t.act("helpdesk.ticket", &id(&ticket), action).await;
    }
    t.create(
        "helpdesk.message",
        json!({ "ticket": id(&ticket), "direction": "inbound", "author": "Service customer", "body": "The issue is still present" }),
    )
    .await;
    assert_eq!(
        t.get("helpdesk.ticket", &id(&ticket)).await["status"],
        "open"
    );
    assert_eq!(
        t.list(
            "field-service.work_order",
            &[("source_ticket", &id(&ticket))]
        )
        .await
        .len(),
        1
    );

    let asset = t.create("asset.asset", json!({ "code": "SERVICE-ASSET", "name": "Service equipment", "cost": 1200, "in_service_date": "2020-01-01", "useful_life_months": 120, "acquisition_method": "bank" })).await;
    t.act("asset.asset", &id(&asset), "activated").await;
    let today = chrono::Utc::now().date_naive();
    let plan = t.create("maintenance.maintenance_plan", json!({ "asset": id(&asset), "title": "Monthly service", "interval_days": 30, "next_due": today.to_string() })).await;
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 1);
    assert_eq!(kernel.run_jobs(&t.t).await.unwrap(), 1);
    let request = t
        .list(
            "maintenance.maintenance_request",
            &[("source_plan", &id(&plan))],
        )
        .await
        .remove(0);
    t.update("maintenance.maintenance_request", &id(&request), json!({ "warehouse": warehouse, "parts": [{ "product": id(&part), "qty": 1 }], "resolution": "Replaced filter", "labor_hours": 1, "labor_rate": 10 })).await;
    for action in ["started", "done"] {
        t.act("maintenance.maintenance_request", &id(&request), action)
            .await;
    }
    assert_eq!(t.stock(&id(&part)).await, 17.0);
    assert_eq!(
        t.get("maintenance.maintenance_plan", &id(&plan)).await["last_completed"],
        today.to_string()
    );

    let vehicle = t
        .create(
            "auto-service.vehicle",
            json!({ "party": id(&party), "plate": "REPAIR-1", "make": "Make", "odometer": 100 }),
        )
        .await;
    let repair = t.create("auto-service.repair_order", json!({ "vehicle": id(&vehicle), "party": id(&party), "odometer_reading": 100, "warehouse": warehouse, "complaint": "Replace part", "lines": [{ "product": id(&part), "qty": 3, "price": 20 }] })).await;
    for action in ["approved", "started", "completed", "delivered"] {
        t.act("auto-service.repair_order", &id(&repair), action)
            .await;
    }
    assert_eq!(t.stock(&id(&part)).await, 14.0);
    assert_eq!(
        f(
            &t.list("accounting.invoice", &[("source_id", &id(&repair))])
                .await[0]["total"]
        ),
        60.0
    );
    println!(
        "✔ services: ticket conversion, technician conflicts, billable repair, scheduled maintenance, vehicle service"
    );
}

async fn recruitment(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["recruitment", "performance"]).await;
    let department = t
        .create("hrm.department", json!({ "name": "Engineering" }))
        .await;
    let position = t
        .create(
            "hrm.position",
            json!({ "name": "Engineer", "department": id(&department) }),
        )
        .await;
    let job = t.create("recruitment.job_opening", json!({ "title": "Engineer", "department": id(&department), "position": id(&position), "headcount": 1 })).await;
    let candidate = t
        .create(
            "recruitment.candidate",
            json!({ "name": "Candidate", "email": "candidate@example.test" }),
        )
        .await;
    let application = t
        .create(
            "recruitment.application",
            json!({ "job": id(&job), "candidate": id(&candidate), "candidate_name": "Candidate" }),
        )
        .await;
    for action in ["applied", "hired"] {
        t.act("recruitment.application", &id(&application), action)
            .await;
    }
    let employee = t
        .list("hrm.employee", &[("source_id", &id(&candidate))])
        .await
        .remove(0);
    assert_eq!(employee["department"], id(&department));
    assert_eq!(employee["position"], id(&position));
    assert_eq!(employee["email"], "candidate@example.test");
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "recruitment.application",
                &id(&application),
                "hired"
            )
            .await
            .is_err()
    );
    t.act("recruitment.job_opening", &id(&job), "closed").await;
    let objective = t
        .create(
            "performance.objective",
            json!({ "title": "Quality", "owner": id(&employee), "period": "2026-Q4" }),
        )
        .await;
    t.create("performance.key_result", json!({ "objective": id(&objective), "title": "Tests passed", "target": 100, "current": 90 })).await;
    let reviewer = t
        .create("hrm.employee", json!({ "name": "Reviewer" }))
        .await;
    let review = t.create("performance.review", json!({ "employee": id(&employee), "reviewer": id(&reviewer), "period": "2026-Q4", "score": 4, "comment": "Meets expectations", "revision_note": "Please add supporting examples" })).await;
    for action in ["submitted", "returned"] {
        t.act("performance.review", &id(&review), action).await;
    }
    t.update(
        "performance.review",
        &id(&review),
        json!({ "comment": "Revised assessment" }),
    )
    .await;
    for action in ["submitted", "acknowledged"] {
        t.act("performance.review", &id(&review), action).await;
    }
    println!(
        "✔ recruitment/performance: candidate to employee with department/position, review revision and acknowledgement"
    );
}

async fn logistics(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["sales", "logistics"]).await;
    let warehouse = t.warehouse().await;
    let party = t
        .create("master-data.party", json!({ "name": "Delivery customer" }))
        .await;
    let product = t
        .create(
            "master-data.product",
            json!({ "sku": "SHIP", "name": "Parcel", "price": 100, "cost": 50, "weight": 2 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&product), "warehouse": warehouse, "qty": 10, "direction": "in" }),
    )
    .await;
    let order = t.create("sales.sales_order", json!({ "party": id(&party), "warehouse": warehouse, "shipping_address": "Destination A", "lines": [{ "product": id(&product), "qty": 4, "price": 100 }] })).await;
    t.act("sales.sales_order", &id(&order), "confirmed").await;
    assert_eq!(t.stock(&id(&product)).await, 10.0);
    let shipment = t
        .list("logistics.shipment", &[("source_id", &id(&order))])
        .await
        .remove(0);
    assert_eq!(f(&shipment["weight"]), 8.0);
    let vehicle = t
        .create(
            "logistics.vehicle",
            json!({ "plate": "DEL-1", "capacity": 5 }),
        )
        .await;
    let driver = t
        .create(
            "logistics.driver",
            json!({ "name": "Driver A", "license": "B2" }),
        )
        .await;
    t.update(
        "logistics.shipment",
        &id(&shipment),
        json!({ "vehicle": id(&vehicle), "driver": id(&driver) }),
    )
    .await;
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "logistics.shipment",
                &id(&shipment),
                "dispatched"
            )
            .await
            .is_err()
    );
    t.update(
        "logistics.shipment",
        &id(&shipment),
        json!({ "lines": [{ "product": id(&product), "qty": 2, "price": 100 }] }),
    )
    .await;
    t.act("logistics.shipment", &id(&shipment), "dispatched")
        .await;
    let scan = json!({ "shipment": id(&shipment), "status": "in_transit", "description": "Depot scan", "occurred_at": chrono::Utc::now().to_rfc3339(), "carrier_event_id": "scan-1" });
    t.create("logistics.tracking_event", scan.clone()).await;
    assert!(
        t.try_create("logistics.tracking_event", scan)
            .await
            .is_err()
    );
    kernel
        .logistics_confirm_shipment_delivery(
            &t.a,
            &t.t,
            &id(&shipment),
            json!({ "received_by": "Customer", "delivered_lines": [{ "product": id(&product), "qty": 2, "price": 100 }] })
                .as_object()
                .unwrap()
                .clone(),
        )
        .await
        .unwrap();
    assert_eq!(t.stock(&id(&product)).await, 8.0);
    assert_eq!(
        t.get("sales.sales_order", &id(&order)).await["status"],
        "partially_delivered"
    );
    let second = t.create("logistics.shipment", json!({ "source": "sales_order", "source_id": id(&order), "party": id(&party), "warehouse": warehouse, "destination": "Destination A", "vehicle": id(&vehicle), "driver": id(&driver), "lines": [{ "product": id(&product), "qty": 2, "price": 100 }] })).await;
    t.act("logistics.shipment", &id(&second), "dispatched")
        .await;
    kernel
        .logistics_confirm_shipment_delivery(
            &t.a,
            &t.t,
            &id(&second),
            json!({ "received_by": "Customer" })
                .as_object()
                .unwrap()
                .clone(),
        )
        .await
        .unwrap();
    assert_eq!(t.stock(&id(&product)).await, 6.0);
    assert_eq!(
        t.get("sales.sales_order", &id(&order)).await["status"],
        "delivered"
    );
    assert_eq!(
        t.list("accounting.invoice", &[("source_id", &id(&order))])
            .await
            .len(),
        1
    );
    for _ in 0..2 {
        let queued_order = t.create("sales.sales_order", json!({ "party": id(&party), "warehouse": warehouse, "shipping_address": "Destination A", "lines": [{ "product": id(&product), "qty": 1, "price": 100 }] })).await;
        t.act("sales.sales_order", &id(&queued_order), "confirmed")
            .await;
    }
    let (status, board) = t
        .api(
            "GET",
            "/reports/logistics/delivery-board?limit=1&offset=0",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "delivery board page: {board}");
    let item_count = board["itemCount"].as_i64().unwrap_or_default();
    assert!(item_count >= 2);
    assert_eq!(
        item_count,
        board["counts"]["created"].as_i64().unwrap_or_default()
            + board["counts"]["dispatched"].as_i64().unwrap_or_default()
            + board["counts"]["failed"].as_i64().unwrap_or_default()
            + board["counts"]["partial"].as_i64().unwrap_or_default()
    );
    assert_eq!(board["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(board["pageSize"], 1);
    assert_eq!(board["offset"], 0);
    assert_eq!(board["hasMore"], true);
    let (status, last_page) = t
        .api(
            "GET",
            "/reports/logistics/delivery-board?limit=1&offset=1",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "delivery board last page: {last_page}");
    assert_eq!(last_page["itemCount"], board["itemCount"]);
    assert_eq!(last_page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(last_page["offset"], 1);
    assert_eq!(last_page["hasMore"], false);
    println!(
        "✔ logistics: load limits, partial deliveries, immutable deduplicated tracking, single stock issue"
    );
}

async fn restaurant(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["restaurant", "accounting"]).await;
    let warehouse = t.warehouse().await;
    let table = t
        .create("restaurant.table", json!({ "name": "Table A", "seats": 4 }))
        .await;
    let reservation_start = chrono::Utc::now() + chrono::Duration::hours(2);
    let reservation_end = reservation_start + chrono::Duration::hours(1);
    let reservation = t
        .create(
            "restaurant.reservation",
            json!({
                "guest_name": "Reservation guest",
                "table": id(&table),
                "guest_count": 4,
                "starts_at": reservation_start.to_rfc3339(),
                "ends_at": reservation_end.to_rfc3339()
            }),
        )
        .await;
    assert_eq!(reservation["status"], "requested");
    t.act("restaurant.reservation", &id(&reservation), "confirmed")
        .await;
    let overlap_start = reservation_start + chrono::Duration::minutes(30);
    let overlap = t
        .create(
            "restaurant.reservation",
            json!({
                "guest_name": "Overlapping guest",
                "table": id(&table),
                "guest_count": 2,
                "starts_at": overlap_start.to_rfc3339(),
                "ends_at": (overlap_start + chrono::Duration::hours(1)).to_rfc3339()
            }),
        )
        .await;
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "restaurant.reservation",
                &id(&overlap),
                "confirmed"
            )
            .await
            .is_err()
    );
    assert!(
        t.try_create(
            "restaurant.reservation",
            json!({
                "guest_name": "Oversized party",
                "table": id(&table),
                "guest_count": 5,
                "starts_at": (reservation_end + chrono::Duration::hours(1)).to_rfc3339(),
                "ends_at": (reservation_end + chrono::Duration::hours(2)).to_rfc3339()
            }),
        )
        .await
        .is_err()
    );
    let ingredient = t
        .create(
            "master-data.product",
            json!({ "sku": "FLOUR", "name": "Flour", "cost": 5 }),
        )
        .await;
    let dish = t.create("master-data.product", json!({ "sku": "DISH", "name": "Dish", "kind": "service", "tracked": false, "price": 100 })).await;
    let drink = t
        .create(
            "master-data.product",
            json!({ "sku": "DRINK", "name": "Drink", "price": 20, "cost": 10 }),
        )
        .await;
    for (product, qty) in [(&ingredient, 20), (&drink, 10)] {
        t.create("inventory.stock_move", json!({ "product": id(product), "warehouse": warehouse, "qty": qty, "direction": "in" })).await;
    }
    for (product, station) in [(&dish, "kitchen"), (&drink, "bar")] {
        t.create(
            "restaurant.menu_item",
            json!({ "product": id(product), "station": station, "available": true }),
        )
        .await;
    }
    t.create("restaurant.recipe", json!({ "product": id(&dish), "output_qty": 2, "ingredients": [{ "product": id(&ingredient), "qty": 3 }] })).await;
    let order = t.create("restaurant.table_order", json!({ "table": id(&table), "warehouse": warehouse, "method": "cash", "lines": [{ "product": id(&dish), "qty": 2, "price": 100 }, { "product": id(&drink), "qty": 1, "price": 20 }] })).await;
    t.act("restaurant.table_order", &id(&order), "sent").await;
    let tickets = t
        .list("restaurant.kitchen_ticket", &[("order", &id(&order))])
        .await;
    assert_eq!(tickets.len(), 2);
    let second_table = t
        .create("restaurant.table", json!({ "name": "Table B", "seats": 2 }))
        .await;
    let service_dish = t
        .create(
            "master-data.product",
            json!({ "sku": "KDS-SERVICE", "name": "Counter service", "kind": "service", "tracked": false, "price": 5 }),
        )
        .await;
    t.create(
        "restaurant.menu_item",
        json!({ "product": id(&service_dish), "station": "kitchen", "available": true }),
    )
    .await;
    let second_order = t.create("restaurant.table_order", json!({ "table": id(&second_table), "warehouse": warehouse, "method": "cash", "lines": [{ "product": id(&service_dish), "qty": 1, "price": 5 }] })).await;
    t.act("restaurant.table_order", &id(&second_order), "sent")
        .await;
    let (status, first_page) = t
        .api(
            "GET",
            "/reports/restaurant/kitchen-board?station=kitchen&limit=1&offset=0",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "kitchen board page: {first_page}");
    assert_eq!(first_page["itemCount"], 2);
    assert_eq!(first_page["counts"]["queued"], 2);
    assert_eq!(first_page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(first_page["hasMore"], true);
    let (status, last_page) = t
        .api(
            "GET",
            "/reports/restaurant/kitchen-board?station=kitchen&limit=1&offset=1",
            json!(null),
        )
        .await;
    assert_eq!(status, 200, "kitchen board last page: {last_page}");
    assert_eq!(last_page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(last_page["hasMore"], false);
    assert!(
        kernel
            .act(&t.a, &t.t, "restaurant.table_order", &id(&order), "served")
            .await
            .is_err()
    );
    for ticket in tickets {
        for action in ["preparing", "ready"] {
            t.act("restaurant.kitchen_ticket", &id(&ticket), action)
                .await;
        }
    }
    for action in ["served", "completed"] {
        t.act("restaurant.table_order", &id(&order), action).await;
    }
    assert_eq!(t.stock(&id(&ingredient)).await, 17.0);
    assert_eq!(t.stock(&id(&drink)).await, 9.0);
    assert_eq!(
        f(&t.list("accounting.payment", &[("source_id", &id(&order))])
            .await[0]["amount"]),
        220.0
    );
    let second_ticket = t
        .list(
            "restaurant.kitchen_ticket",
            &[("order", &id(&second_order))],
        )
        .await
        .remove(0);
    for action in ["preparing", "ready"] {
        t.act("restaurant.kitchen_ticket", &id(&second_ticket), action)
            .await;
    }
    for action in ["served", "completed"] {
        t.act("restaurant.table_order", &id(&second_order), action)
            .await;
    }
    assert!(
        kernel
            .act(
                &t.a,
                &t.t,
                "restaurant.table_order",
                &id(&order),
                "completed"
            )
            .await
            .is_err()
    );
    println!(
        "✔ restaurant: kitchen/bar routing, readiness, recipe quantities, ingredient issues and settlement"
    );
}

async fn tickets(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["events", "accounting"]).await;
    let party = t
        .create("master-data.party", json!({ "name": "Event visitor" }))
        .await;
    let tax = t
        .create(
            "master-data.tax",
            json!({ "name": "Ticket tax", "rate": 10 }),
        )
        .await;
    let event = t.create("events.event", json!({ "name": "Capacity event", "venue": "Hall", "starts_at": (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339(), "capacity": 1, "ticket_price": 110, "ticket_tax": id(&tax) })).await;
    t.act("events.event", &id(&event), "published").await;
    let ticket = t.create("events.ticket", json!({ "event": id(&event), "party": id(&party), "method": "cash", "refund_reason": "Visitor cancellation" })).await;
    assert_eq!(f(&ticket["price"]), 110.0);
    assert_eq!(f(&ticket["net_amount"]), 100.0);
    assert_eq!(f(&ticket["tax_amount"]), 10.0);
    assert!(
        t.try_create("events.ticket", json!({ "event": id(&event) }))
            .await
            .is_err()
    );
    t.act("events.ticket", &id(&ticket), "sold").await;
    t.act("events.ticket", &id(&ticket), "refunded").await;
    let payments = t
        .list("accounting.payment", &[("source_id", &id(&ticket))])
        .await;
    assert_eq!(payments.len(), 2);
    assert_eq!(payments.iter().map(|p| f(&p["amount"])).sum::<f64>(), 0.0);
    let replacement = t
        .create(
            "events.ticket",
            json!({ "event": id(&event), "party": id(&party), "method": "cash" }),
        )
        .await;
    for action in ["sold", "checked_in"] {
        t.act("events.ticket", &id(&replacement), action).await;
    }
    assert!(
        kernel
            .act(&t.a, &t.t, "events.ticket", &id(&replacement), "refunded")
            .await
            .is_err()
    );
    println!(
        "✔ event tickets: capacity, tax snapshots, sale/refund journals, released seats and admission"
    );
}

async fn projects(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["construction"]).await;
    let project = t
        .create(
            "project.project",
            json!({ "name": "Construction project", "budget": 1000 }),
        )
        .await;
    t.act("project.project", &id(&project), "started").await;
    let first = t
        .create(
            "project.task",
            json!({ "project": id(&project), "title": "Foundation" }),
        )
        .await;
    let second = t
        .create(
            "project.task",
            json!({ "project": id(&project), "title": "Structure" }),
        )
        .await;
    t.create(
        "project.task_dependency",
        json!({ "predecessor": id(&first), "successor": id(&second) }),
    )
    .await;
    assert!(
        t.try_create(
            "project.task_dependency",
            json!({ "predecessor": id(&second), "successor": id(&first) })
        )
        .await
        .is_err()
    );
    for task in [&first, &second] {
        t.act("project.task", &id(task), "started").await;
    }
    assert!(
        kernel
            .act(&t.a, &t.t, "project.task", &id(&second), "done")
            .await
            .is_err()
    );
    let sheet = t.create("project.timesheet", json!({ "project": id(&project), "task": id(&first), "hours": 2.5, "rate": 12.34, "date": "2026-11-01" })).await;
    assert_eq!(f(&sheet["amount"]), 30.85);
    let boq = t.create("construction.boq", json!({ "project": id(&project), "items": [{ "description": "Concrete", "qty": 2.5, "unit": "m3", "unit_price": 100 }] })).await;
    assert_eq!(f(&boq["total"]), 250.0);
    let vendor = t
        .create(
            "master-data.party",
            json!({ "name": "Subcontractor", "is_supplier": true }),
        )
        .await;
    let sub = t.create("construction.subcontract", json!({ "project": id(&project), "vendor": id(&vendor), "value": 250, "scope": "Foundation" })).await;
    t.act("construction.subcontract", &id(&sub), "signed").await;
    let site = t
        .create(
            "construction.site",
            json!({ "project": id(&project), "name": "Site A" }),
        )
        .await;
    let diary = json!({ "site": id(&site), "date": "2026-11-01", "notes": "Completed foundation" });
    t.create("construction.site_diary", diary.clone()).await;
    assert!(
        t.try_create("construction.site_diary", diary)
            .await
            .is_err()
    );
    assert!(
        kernel
            .act(&t.a, &t.t, "project.project", &id(&project), "completed")
            .await
            .is_err()
    );
    for task in [&first, &second] {
        t.act("project.task", &id(task), "done").await;
    }
    t.act("construction.subcontract", &id(&sub), "completed")
        .await;
    t.act("project.project", &id(&project), "completed").await;
    assert!(
        t.try_create(
            "project.timesheet",
            json!({ "project": id(&project), "hours": 1, "rate": 10 })
        )
        .await
        .is_err()
    );
    println!(
        "✔ project/construction: dependencies, cycle guard, timesheet valuation, BOQ, subcontract and close"
    );
}

async fn learning(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["lms"]).await;
    let learner = t
        .create("master-data.party", json!({ "name": "Learner" }))
        .await;
    let course = t.create("lms.course", json!({ "title": "Training" })).await;
    assert!(
        kernel
            .act(&t.a, &t.t, "lms.course", &id(&course), "published")
            .await
            .is_err()
    );
    let first = t
        .create(
            "lms.lesson",
            json!({ "course": id(&course), "title": "One" }),
        )
        .await;
    let second = t
        .create(
            "lms.lesson",
            json!({ "course": id(&course), "title": "Two" }),
        )
        .await;
    t.act("lms.course", &id(&course), "published").await;
    let enrollment = t
        .create(
            "lms.enrollment",
            json!({ "course": id(&course), "learner": id(&learner) }),
        )
        .await;
    assert!(
        t.try_create(
            "lms.enrollment",
            json!({ "course": id(&course), "learner": id(&learner) })
        )
        .await
        .is_err()
    );
    assert!(
        kernel
            .act(&t.a, &t.t, "lms.enrollment", &id(&enrollment), "completed")
            .await
            .is_err()
    );
    for (lesson, expected) in [(&first, 50.0), (&second, 100.0)] {
        let progress = json!({ "enrollment": id(&enrollment), "lesson": id(lesson) });
        t.create("lms.lesson_progress", progress.clone()).await;
        assert!(t.try_create("lms.lesson_progress", progress).await.is_err());
        assert_eq!(
            f(&t.get("lms.enrollment", &id(&enrollment)).await["progress"]),
            expected
        );
    }
    assert_eq!(
        t.get("lms.enrollment", &id(&enrollment)).await["status"],
        "completed"
    );
    t.act("lms.course", &id(&course), "archived").await;
    println!(
        "✔ LMS: publish requirements, duplicate enrollment/progress, automatic completion and archival"
    );
}

async fn insurance(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["insurance"]).await;
    let (_, reviewer_token) = kernel
        .add_user(
            &t.t,
            "Independent claims reviewer",
            None,
            None,
            &["admin".into()],
        )
        .await
        .unwrap();
    let (_, reviewer, _) = kernel.authenticate(&reviewer_token.unwrap()).await.unwrap();
    let (_, payer_token) = kernel
        .add_user(
            &t.t,
            "Independent claims payer",
            None,
            None,
            &["admin".into()],
        )
        .await
        .unwrap();
    let (_, payer, _) = kernel.authenticate(&payer_token.unwrap()).await.unwrap();
    let party = t
        .create("master-data.party", json!({ "name": "Insured party" }))
        .await;
    let policy = t.create("insurance.policy", json!({ "number": "POL-1", "party": id(&party), "product": "Property", "premium": 100, "coverage_limit": 1000, "start_date": "2026-01-01", "end_date": "2026-12-31" })).await;
    t.act("insurance.policy", &id(&policy), "activated").await;
    let claim = t.create("insurance.claim", json!({ "number": "CL-1", "policy": id(&policy), "amount": 700, "incident_date": "2026-10-01", "description": "Storm damage" })).await;
    kernel
        .act(&reviewer, &t.t, "insurance.claim", &id(&claim), "approved")
        .await
        .unwrap();
    assert!(
        kernel
            .act(&t.a, &t.t, "insurance.claim", &id(&claim), "paid")
            .await
            .is_err()
    );
    let expense = t
        .create(
            "accounting.account",
            json!({ "code": "CLAIM-EXP", "name": "Claim payout expense", "kind": "expense" }),
        )
        .await;
    t.update(
        "insurance.claim",
        &id(&claim),
        json!({ "expense_account": id(&expense), "method": "bank" }),
    )
    .await;
    kernel
        .act(&payer, &t.t, "insurance.claim", &id(&claim), "paid")
        .await
        .unwrap();
    let payouts = t
        .list("accounting.journal_entry", &[("source_id", &id(&claim))])
        .await;
    assert_eq!(payouts.len(), 1);
    assert_eq!(payouts[0]["status"], "posted");
    assert_eq!(payouts[0]["lines"].as_array().unwrap().len(), 2);
    let second = t.create("insurance.claim", json!({ "number": "CL-2", "policy": id(&policy), "amount": 400, "incident_date": "2026-10-02", "description": "Further damage" })).await;
    assert!(
        kernel
            .act(&t.a, &t.t, "insurance.claim", &id(&second), "approved")
            .await
            .is_err()
    );
    assert!(
        kernel
            .act(&t.a, &t.t, "insurance.policy", &id(&policy), "cancelled")
            .await
            .is_err()
    );
    assert!(
        kernel
            .update(
                &t.a,
                &t.t,
                "insurance.claim",
                &id(&claim),
                o(json!({ "amount": 1 }))
            )
            .await
            .is_err()
    );
    println!("✔ insurance: policy dates, aggregate claims limit and immutable paid claims");
}

async fn agriculture(kernel: &Arc<Kernel>) {
    let t = Ctx::new(kernel, None, &["agriculture"]).await;
    let warehouse = t.warehouse().await;
    let farm = t
        .create("agriculture.farm", json!({ "name": "Farm A", "area": 10 }))
        .await;
    let cycle = t.create("agriculture.crop_cycle", json!({ "farm": id(&farm), "crop": "Rice", "planted_on": "2026-01-01", "expected_harvest": "2026-11-01" })).await;
    let seed = t
        .create(
            "master-data.product",
            json!({ "sku": "SEED", "name": "Seed", "cost": 2 }),
        )
        .await;
    let crop = t
        .create(
            "master-data.product",
            json!({ "sku": "CROP", "name": "Crop", "cost": 3 }),
        )
        .await;
    t.create(
        "inventory.stock_move",
        json!({ "product": id(&seed), "warehouse": warehouse, "qty": 10, "direction": "in" }),
    )
    .await;
    t.create("agriculture.input_application", json!({ "cycle": id(&cycle), "kind": "seed", "product": id(&seed), "qty": 4, "warehouse": warehouse, "date": "2026-01-02" })).await;
    assert_eq!(t.stock(&id(&seed)).await, 6.0);
    t.create("agriculture.harvest", json!({ "cycle": id(&cycle), "product": id(&crop), "qty": 100, "warehouse": warehouse, "date": "2026-11-01", "lot_code": "HARVEST-1" })).await;
    assert_eq!(t.stock(&id(&crop)).await, 100.0);
    t.act("agriculture.crop_cycle", &id(&cycle), "harvested")
        .await;
    assert!(
        t.try_create(
            "agriculture.input_application",
            json!({ "cycle": id(&cycle), "kind": "water", "qty": 1, "date": "2026-11-02" })
        )
        .await
        .is_err()
    );
    println!(
        "✔ agriculture: growing cycle, input stock consumption, harvest lot and closed-cycle protection"
    );
}
