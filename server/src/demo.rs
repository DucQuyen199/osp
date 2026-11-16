//! Nạp dữ liệu mẫu để dùng thử/trình diễn. Chỉ tạo cho module đang bật; đi qua cùng đường nghiệp vụ như người dùng thật
//! (nên các luồng liên module tự chạy). Seed nội bộ dùng Actor::System;
//! thao tác tiếp theo của người dùng vẫn phải qua cùng validator và transaction.
use crate::kernel::{Actor, Kernel, Obj, Tenant};
use chrono::{Duration, Utc};
use serde_json::{Value, json};

async fn mk(k: &Kernel, t: &Tenant, q: &str, data: Value) -> Option<String> {
    let o: Obj = data.as_object()?.clone();
    match k.create(&Actor::System, t, q, o).await {
        Ok(v) => v["id"].as_str().map(String::from),
        Err(e) => {
            tracing::debug!(entity = q, error = %e, "demo: bỏ qua bản ghi");
            None
        }
    }
}

async fn act(k: &Kernel, t: &Tenant, q: &str, id: &Option<String>, action: &str) {
    if let Some(id) = id {
        if let Err(error) = k.act(&Actor::System, t, q, id, action).await {
            tracing::warn!(entity = q, action, error = %error, "demo action failed");
        }
    }
}

pub async fn seed(k: &Kernel, t: &Tenant) {
    let has = |m: &str| t.has_module(m);
    let day = |d: i64| {
        (Utc::now() + Duration::days(d))
            .format("%Y-%m-%d")
            .to_string()
    };

    let mut customers = Vec::new();
    for (name, phone) in [
        ("Công ty TNHH An Phát", "0901 234 567"),
        ("Nguyễn Thị Hoa", "0912 345 678"),
        ("Trần Văn Minh", "0933 456 789"),
        ("Công ty CP Đại Dương", "0988 111 222"),
        ("Lê Hoàng Nam", "0977 333 444"),
        ("Phạm Thu Hà", "0966 555 666"),
    ] {
        let kind = if name.starts_with("Công ty") {
            "company"
        } else {
            "person"
        };
        customers.push(
            mk(
                k,
                t,
                "master-data.party",
                json!({ "name": name, "phone": phone, "is_customer": true, "kind": kind }),
            )
            .await,
        );
    }
    let mut suppliers = Vec::new();
    for name in ["Nhà phân phối Hưng Thịnh", "Công ty Nguyên liệu Việt"] {
        suppliers.push(
            mk(
                k,
                t,
                "master-data.party",
                json!({ "name": name, "is_supplier": true, "kind": "company" }),
            )
            .await,
        );
    }
    let mut products = Vec::new();
    for (sku, name, price, cost) in [
        ("SP001", "Cà phê rang xay 500g", 120000, 70000),
        ("SP002", "Trà ô long 250g", 95000, 55000),
        ("SP003", "Bình giữ nhiệt 500ml", 250000, 150000),
        ("SP004", "Ly sứ cao cấp", 80000, 40000),
        ("SP005", "Bánh quy bơ hộp", 65000, 35000),
        ("SP006", "Túi vải canvas", 45000, 20000),
    ] {
        products.push(mk(k, t, "master-data.product", json!({ "sku": sku, "name": name, "price": price, "cost": cost, "kind": "goods", "active": true })).await);
    }
    let pid = |i: usize| products.get(i).cloned().flatten();
    let cid = |i: usize| customers.get(i).cloned().flatten();
    let warehouse = if has("inventory") {
        mk(
            k,
            t,
            "inventory.warehouse",
            json!({ "name": "Kho trung tâm" }),
        )
        .await
    } else {
        None
    };

    if has("inventory") {
        for (i, p) in products.iter().enumerate() {
            mk(k, t, "inventory.stock_move", json!({ "product": p, "warehouse": warehouse, "qty": 60 + (i as i64) * 9, "direction": "in", "source": "demo" })).await;
        }
    }
    if has("crm") {
        let lead = mk(k, t, "crm.lead", json!({ "name": "Võ Thanh Sơn", "email": "son@example.vn", "phone": "0905 000 111", "source": "Website" })).await;
        act(k, t, "crm.lead", &lead, "contacted").await;
        mk(
            k,
            t,
            "crm.lead",
            json!({ "name": "Đặng Mỹ Linh", "email": "linh@example.vn", "source": "Facebook" }),
        )
        .await;
        mk(
            k,
            t,
            "crm.lead",
            json!({ "name": "Công ty Bình Minh", "source": "Giới thiệu" }),
        )
        .await;
        let d1 = mk(k, t, "crm.deal", json!({ "title": "Hợp đồng cung cấp quý 4", "party": cid(0), "amount": 1_200_000, "warehouse": warehouse, "lines": [{ "product": pid(0), "qty": 10, "price": 120000 }], "stage": "Thương lượng" })).await;
        mk(k, t, "crm.deal", json!({ "title": "Đơn hàng quà tặng cuối năm", "party": cid(3), "amount": 18_500_000, "stage": "Báo giá" })).await;
        if warehouse.is_some() {
            act(k, t, "crm.deal", &d1, "won").await;
        }
    }
    if has("sales") {
        let lines = |i: usize, j: usize| json!([{ "product": pid(i), "qty": 3, "price": 120000 }, { "product": pid(j), "qty": 2, "price": 250000 }]);
        let o1 = mk(
            k,
            t,
            "sales.sales_order",
            json!({ "party": cid(1), "warehouse": warehouse, "lines": lines(0, 2), "order_date": day(-2) }),
        )
        .await;
        act(k, t, "sales.sales_order", &o1, "confirmed").await;
        let o2 = mk(
            k,
            t,
            "sales.sales_order",
            json!({ "party": cid(2), "warehouse": warehouse, "lines": lines(1, 3), "order_date": day(-1) }),
        )
        .await;
        act(k, t, "sales.sales_order", &o2, "confirmed").await;
        mk(
            k,
            t,
            "sales.sales_order",
            json!({ "party": cid(4), "warehouse": warehouse, "lines": lines(4, 5), "order_date": day(0) }),
        )
        .await;
    }
    if has("pos") {
        if let Some(warehouse_id) = &warehouse {
            let session = mk(
                k,
                t,
                "pos.pos_session",
                json!({ "warehouse": warehouse_id, "cashier": "Demo", "opening_cash": 500000 }),
            )
            .await;
            let prices = [120000_i64, 95000, 250000, 80000, 65000, 45000];
            for (c, p, q) in [(0, 0, 2), (1, 1, 1), (2, 4, 3)] {
                let price = prices[p];
                let cash_received = price * q;
                let o = mk(k, t, "pos.pos_order", json!({ "party": cid(c), "warehouse": warehouse_id, "session": session, "method": "cash", "cash_received": cash_received, "lines": [{ "product": pid(p), "qty": q, "price": price }] })).await;
                act(k, t, "pos.pos_order", &o, "completed").await;
            }
        }
    }
    if has("purchasing") {
        if let Some(Some(s0)) = suppliers.first() {
            let po = mk(k, t, "purchasing.purchase_order", json!({ "supplier": s0, "warehouse": warehouse, "lines": [{ "product": pid(0), "qty": 50, "price": 70000 }], "expected_date": day(5) })).await;
            act(k, t, "purchasing.purchase_order", &po, "submitted").await;
            if !has("workflow-approval") {
                act(k, t, "purchasing.purchase_order", &po, "approved").await;
            }
        }
    }
    if has("hrm") {
        let dept = mk(k, t, "hrm.department", json!({ "name": "Kinh doanh" })).await;
        mk(k, t, "hrm.department", json!({ "name": "Kế toán" })).await;
        for (name, salary) in [
            ("Nguyễn Văn An", 15_000_000),
            ("Trần Thị Bích", 12_000_000),
            ("Lê Quốc Cường", 18_000_000),
        ] {
            mk(k, t, "hrm.employee", json!({ "name": name, "department": dept, "base_salary": salary, "hire_date": day(-200) })).await;
        }
    }
    if has("helpdesk") {
        mk(k, t, "helpdesk.ticket", json!({ "subject": "Giao hàng chậm hơn dự kiến", "party": cid(1), "priority": "high", "channel": "Zalo" })).await;
        mk(k, t, "helpdesk.ticket", json!({ "subject": "Cần xuất hóa đơn công ty", "party": cid(0), "priority": "normal", "channel": "Email" })).await;
    }
    if has("booking") {
        let room = mk(
            k,
            t,
            "booking.resource",
            json!({ "name": "Phòng 1", "kind": "room" }),
        )
        .await;
        let svc = mk(
            k,
            t,
            "booking.service",
            json!({ "name": "Dịch vụ cơ bản", "duration_min": 60, "price": 300000 }),
        )
        .await;
        let start = (Utc::now() + Duration::days(1))
            .date_naive()
            .and_hms_opt(9, 0, 0)
            .unwrap()
            .and_utc();
        let end = start + Duration::hours(1);
        mk(k, t, "booking.booking", json!({ "party": cid(2), "resource": room, "service": svc, "starts_at": start.to_rfc3339(), "ends_at": end.to_rfc3339(), "price": 300000 })).await;
    }
    if has("project") {
        let p = mk(
            k,
            t,
            "project.project",
            json!({ "name": "Triển khai cửa hàng mới", "party": cid(0), "budget": 200_000_000 }),
        )
        .await;
        mk(
            k,
            t,
            "project.task",
            json!({ "project": p, "title": "Khảo sát mặt bằng", "assignee": "An", "due": day(7) }),
        )
        .await;
        mk(k, t, "project.task", json!({ "project": p, "title": "Lên kế hoạch nhân sự", "assignee": "Bích", "due": day(14) })).await;
    }
}
