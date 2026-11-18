//! Test tích hợp trên PostgreSQL thật (bản nhúng, vai trò không phải superuser nên RLS có hiệu lực).
//! Một hàm test duy nhất chạy tuần tự các kịch bản để dùng chung một tiến trình PostgreSQL và tắt nó gọn gàng.
#![cfg(feature = "embedded-pg")]
use futures::future::BoxFuture;
use osp_server::error::{ApiError, R};
use osp_server::kernel::data::ListQuery;
use osp_server::kernel::io::ImportInput;
use osp_server::kernel::tenants::{AdminInput, CreateTenant};
use osp_server::kernel::{Actor, Kernel, Obj, Tenant};
use osp_server::modules::einvoice::{
    CancellationResult, EInvoiceProvider, IssueResult, run_once_with_provider,
};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

#[derive(Default)]
struct RecordingEInvoiceProvider {
    issues: Mutex<Vec<(String, Value)>>,
    cancellations: Mutex<Vec<(String, String, String)>>,
}

impl EInvoiceProvider for RecordingEInvoiceProvider {
    fn code(&self) -> &str {
        "test-provider"
    }

    fn issue<'a>(
        &'a self,
        tenant_id: &'a str,
        request: &'a Value,
    ) -> BoxFuture<'a, R<IssueResult>> {
        Box::pin(async move {
            let key = request
                .get("idempotency_key")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApiError::validation("einvoice", vec!["Missing idempotency key".into()])
                })?
                .to_owned();
            self.issues
                .lock()
                .expect("provider issue log lock")
                .push((tenant_id.to_owned(), request.clone()));
            Ok(IssueResult {
                provider_reference: Some(key.clone()),
                serial: Some("TEST".into()),
                number: format!("TEST-{key}"),
                lookup_code: Some(format!("LOOKUP-{key}")),
                response: json!({ "accepted": true }),
            })
        })
    }

    fn cancel<'a>(
        &'a self,
        tenant_id: &'a str,
        provider_reference: &'a str,
        reason: &'a str,
    ) -> BoxFuture<'a, R<CancellationResult>> {
        Box::pin(async move {
            self.cancellations
                .lock()
                .expect("provider cancellation log lock")
                .push((
                    tenant_id.to_owned(),
                    provider_reference.to_owned(),
                    reason.to_owned(),
                ));
            Ok(CancellationResult {
                provider_reference: Some(provider_reference.to_owned()),
                response: json!({ "accepted": true, "tenantId": tenant_id }),
            })
        })
    }
}

#[path = "scenarios/commerce.rs"]
mod commerce;
#[path = "scenarios/finance.rs"]
mod finance;
#[path = "scenarios/operations.rs"]
mod operations;
#[path = "scenarios/support.rs"]
mod support;
#[path = "scenarios/verticals.rs"]
mod verticals;

fn o(v: Value) -> Obj {
    v.as_object().cloned().expect("object")
}
fn id(v: &Value) -> String {
    v["id"].as_str().expect("id").to_string()
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}

struct Ctx {
    k: Arc<Kernel>,
    t: Arc<Tenant>,
    a: Actor,
    token: String,
}

impl Ctx {
    async fn new(k: &Arc<Kernel>, vertical: Option<&str>, modules: &[&str]) -> Ctx {
        let (t, token, warnings) = k
            .create_tenant(CreateTenant {
                name: "Test Co".into(),
                vertical: vertical.map(String::from),
                modules: modules.iter().map(|s| s.to_string()).collect(),
                admin: None,
                require_email_verification: false,
            })
            .await
            .expect("create tenant");
        assert!(warnings.is_empty(), "{warnings:?}");
        let (_, a, _) = k.authenticate(&token).await.expect("auth");
        Ctx {
            k: k.clone(),
            t,
            a,
            token,
        }
    }
    async fn refresh(&mut self) {
        self.t = self.k.tenant(&self.t.id).await.unwrap();
    }
    async fn create(&self, q: &str, v: Value) -> Value {
        // Opening stock is an internal fixture; user-facing stock changes use
        // approved counts, receipts, transfers, or source business actions.
        let actor = if q == "inventory.stock_move" {
            &Actor::System
        } else {
            &self.a
        };
        self.k
            .create(actor, &self.t, q, o(v))
            .await
            .unwrap_or_else(|e| panic!("create {q}: {e}"))
    }
    async fn try_create(&self, q: &str, v: Value) -> Result<Value, String> {
        self.k.create(&self.a, &self.t, q, o(v)).await.map_err(|e| {
            assert_ne!(e.code, "INTERNAL", "create {q}: {}", e.message);
            e.code
        })
    }
    async fn act(&self, q: &str, id: &str, action: &str) -> Value {
        self.k
            .act(&self.a, &self.t, q, id, action)
            .await
            .unwrap_or_else(|e| panic!("act {q}.{action}: {e}"))
    }
    async fn get(&self, q: &str, id: &str) -> Value {
        self.k.get(&self.a, &self.t, q, id).await.unwrap()
    }
    async fn list(&self, q: &str, filter: &[(&str, &str)]) -> Vec<Value> {
        let lq = ListQuery {
            filter: filter
                .iter()
                .map(|(a, b)| (a.to_string(), b.to_string()))
                .collect(),
            limit: 1000,
            offset: 0,
            q: None,
            sort: None,
            desc: false,
        };
        self.k.list(&self.a, &self.t, q, &lq).await.unwrap()["items"]
            .as_array()
            .cloned()
            .unwrap()
    }
    async fn stock(&self, product: &str) -> f64 {
        self.list("inventory.stock_level", &[("product", product)])
            .await
            .first()
            .map(|r| f(&r["qty"]))
            .unwrap_or(0.0)
    }
    async fn warehouse(&self) -> String {
        id(&self
            .create("inventory.warehouse", json!({ "name": "Kho kiểm thử" }))
            .await)
    }
    async fn update(&self, q: &str, record: &str, values: Value) -> Value {
        self.k
            .update(&self.a, &self.t, q, record, o(values))
            .await
            .unwrap_or_else(|error| panic!("update {q}: {error}"))
    }
    async fn api(&self, method: &str, path: &str, payload: Value) -> (u16, Value) {
        let app = osp_server::router(osp_server::app_state(
            self.k.clone(),
            osp_server::http::AppConfig {
                demo: false,
                signup: false,
                log: false,
                rate_limit_per_min: 10000,
                public_dir: PathBuf::from("unused"),
            },
        ));
        let request = axum::http::Request::builder()
            .method(method)
            .uri(format!("/api/t/{}{}", self.t.id, path))
            .header("authorization", format!("Bearer {}", self.token))
            .header("content-type", "application/json")
            .extension(axum::extract::ConnectInfo(
                "127.0.0.1:1234".parse::<std::net::SocketAddr>().unwrap(),
            ))
            .body(axum::body::Body::from(payload.to_string()))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status().as_u16();
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), 5_000_000)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&body).expect("JSON API response"),
        )
    }
}

fn lines(product: &str, qty: i64, price: i64) -> Value {
    json!([{ "product": product, "qty": qty, "price": price }])
}

#[test]
fn all_flows() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(4)
        .thread_stack_size(osp_server::WORKER_STACK_BYTES)
        .build()
        .unwrap()
        .block_on(all_flows_in_runtime());
}

async fn all_flows_in_runtime() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("osp_server=warn")
        .try_init();
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("pg-{}", std::process::id()));
    let port = 55000 + (std::process::id() % 900) as u16;
    let (pg, url) = osp_server::embedded::start(dir.clone(), port)
        .await
        .expect("start postgres");
    let defs = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("definitions");
    let k = Arc::new(
        osp_server::build_kernel(&url, &defs, None)
            .await
            .expect("kernel"),
    );

    let result = tokio::spawn(run(k.clone(), url.clone(), defs)).await;
    drop(k);
    let _ = pg.stop().await;
    let _ = std::fs::remove_dir_all(&dir);
    result.expect("các kịch bản phải đạt");
}

#[async_recursion::async_recursion]
async fn run(k: Arc<Kernel>, url: String, defs: PathBuf) {
    macro_rules! step {
        ($name:expr) => {
            println!("✔ {}", $name)
        };
    }

    finance::run(&k).await;
    verticals::run(&k).await;
    operations::run(&k).await;
    commerce::run(&k).await;
    support::run(&k).await;

    // ── Di trú chạy lại không đổi gì (idempotent) ──
    {
        let k2 = osp_server::build_kernel(&url, &defs, None)
            .await
            .expect("migrate lần 2");
        assert_eq!(k2.reg.entities.len(), k.reg.entities.len());
        assert_eq!(k2.reg.modules.len(), k.reg.modules.len());
        step!("di trú lược đồ idempotent cho toàn bộ catalog");
    }

    // ── Cô lập tenant: tầng ứng dụng + khóa ngoại + Row-Level Security ──
    {
        let a = Ctx::new(&k, None, &["crm"]).await;
        let b = Ctx::new(&k, None, &["crm"]).await;
        let pa = a
            .create("master-data.party", json!({ "name": "Khách của A" }))
            .await;
        assert_eq!(b.list("master-data.party", &[]).await.len(), 0);
        assert!(
            k.get(&b.a, &b.t, "master-data.party", &id(&pa))
                .await
                .is_err()
        );
        assert_eq!(
            b.try_create("crm.deal", json!({ "title": "x", "party": id(&pa) }))
                .await
                .unwrap_err(),
            "VALIDATION"
        );

        // RLS ở tầng DB: kết nối thô không đặt app.tenant_id thì không thấy dòng nào; đặt tenant B cũng không thấy dữ liệu A
        let (client, conn) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
            .await
            .unwrap();
        tokio::spawn(conn);
        let n: i64 = client
            .query_one("SELECT count(*) FROM master_data__party", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(n, 0, "không đặt tenant => RLS chặn hết");
        client
            .execute("SELECT set_config('app.tenant_id', $1, false)", &[&b.t.id])
            .await
            .unwrap();
        let n: i64 = client
            .query_one("SELECT count(*) FROM master_data__party", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(n, 0, "tenant B không thấy dữ liệu của A");
        // Giả mạo tenant_id khi ghi bị WITH CHECK chặn
        let forged = client
            .execute("INSERT INTO master_data__party (tenant_id, id, created_at, updated_at, name) VALUES ($1, gen_random_uuid(), now(), now(), 'giả mạo')", &[&a.t.id])
            .await;
        assert!(
            forged.is_err(),
            "RLS WITH CHECK phải chặn ghi sang tenant khác"
        );
        client
            .execute("SELECT set_config('app.tenant_id', $1, false)", &[&a.t.id])
            .await
            .unwrap();
        let n: i64 = client
            .query_one("SELECT count(*) FROM master_data__party", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(n, 1);
        step!("cô lập tenant: ứng dụng + khóa ngoại phức hợp + RLS");
    }

    // ── Kiểm tra dữ liệu, máy trạng thái, toàn vẹn tham chiếu, RBAC ──
    {
        let t = Ctx::new(&k, None, &["crm", "accounting"]).await;
        assert_eq!(
            t.try_create("master-data.party", json!({}))
                .await
                .unwrap_err(),
            "VALIDATION"
        );
        assert_eq!(
            t.try_create(
                "master-data.product",
                json!({ "sku": "A", "name": "B", "price": "rẻ" })
            )
            .await
            .unwrap_err(),
            "VALIDATION"
        );
        assert_eq!(
            t.try_create("master-data.party", json!({ "name": "A", "kind": "robot" }))
                .await
                .unwrap_err(),
            "VALIDATION"
        );
        assert_eq!(
            t.try_create("master-data.party", json!({ "name": "A", "bogus": 1 }))
                .await
                .unwrap_err(),
            "VALIDATION"
        );
        let p = t.create("master-data.party", json!({ "name": "A" })).await;
        let deal = t
            .create(
                "crm.deal",
                json!({ "title": "D", "party": id(&p), "amount": 1500000.5 }),
            )
            .await;
        assert_eq!(deal["status"], "open");
        assert_eq!(f(&t.get("crm.deal", &id(&deal)).await["amount"]), 1500000.5);
        assert_eq!(
            k.update(
                &t.a,
                &t.t,
                "crm.deal",
                &id(&deal),
                o(json!({ "status": "won" }))
            )
            .await
            .unwrap_err()
            .code,
            "VALIDATION"
        );

        assert_eq!(
            k.remove(&t.a, &t.t, "master-data.party", &id(&p))
                .await
                .unwrap_err()
                .code,
            "REFERENCED"
        );
        k.remove(&t.a, &t.t, "crm.deal", &id(&deal)).await.unwrap();
        k.remove(&t.a, &t.t, "master-data.party", &id(&p))
            .await
            .unwrap();

        let lead = t
            .create("crm.lead", json!({ "name": "L", "email": "a@x.vn" }))
            .await;
        assert_eq!(
            k.act(&t.a, &t.t, "crm.lead", &id(&lead), "converted")
                .await
                .unwrap_err()
                .code,
            "INVALID_STATE"
        );
        t.act("crm.lead", &id(&lead), "qualified").await;
        t.act("crm.lead", &id(&lead), "converted").await;
        let made = t.list("master-data.party", &[("email", "a@x.vn")]).await;
        assert_eq!(
            made[0]["is_customer"], true,
            "lead chuyển đổi => khách hàng"
        );

        let (viewer, vtoken) = k
            .add_user(&t.t, "V", None, None, &["viewer".into()])
            .await
            .unwrap();
        let (_, va, _) = k.authenticate(&vtoken.unwrap()).await.unwrap();
        assert_eq!(
            k.create(&va, &t.t, "master-data.party", o(json!({ "name": "B" })))
                .await
                .unwrap_err()
                .code,
            "FORBIDDEN"
        );
        assert!(
            k.list(
                &va,
                &t.t,
                "master-data.party",
                &ListQuery {
                    filter: vec![],
                    limit: 10,
                    offset: 0,
                    q: None,
                    sort: None,
                    desc: false
                }
            )
            .await
            .is_ok()
        );
        assert_eq!(
            k.audit_log(&va, &t.t, 10).await.unwrap_err().code,
            "FORBIDDEN"
        );
        assert!(
            k.audit_log(&t.a, &t.t, 100)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["action"] == "qualified" && e["detail"] == "new→qualified")
        );
        let audit_page = k
            .audit_log_page(
                &t.a,
                &t.t,
                1,
                0,
                &osp_server::kernel::rules::AuditLogFilter::default(),
            )
            .await
            .unwrap();
        assert_eq!(audit_page["pageSize"], 1);
        assert_eq!(audit_page["offset"], 0);
        assert!(audit_page["total"].as_i64().unwrap() >= 1);
        assert_eq!(audit_page["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            audit_page["hasMore"],
            audit_page["total"].as_i64().unwrap() > 1
        );
        assert!(
            audit_page["actions"]
                .as_array()
                .unwrap()
                .contains(&json!("qualified"))
        );
        let qualified_page = k
            .audit_log_page(
                &t.a,
                &t.t,
                10,
                0,
                &osp_server::kernel::rules::AuditLogFilter {
                    action: Some("qualified".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(qualified_page["total"].as_i64().unwrap() >= 1);
        assert!(
            qualified_page["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|entry| entry["action"] == "qualified")
        );
        let user_id = qualified_page["items"][0]["userId"].as_str().unwrap();
        let actor_filtered_page = k
            .audit_log_page(
                &t.a,
                &t.t,
                10,
                0,
                &osp_server::kernel::rules::AuditLogFilter {
                    user_id: Some(user_id.to_owned()),
                    action: Some("qualified".into()),
                    target: Some("crm.lead".into()),
                },
            )
            .await
            .unwrap();
        assert!(actor_filtered_page["total"].as_i64().unwrap() >= 1);
        assert!(actor_filtered_page["items"].as_array().unwrap().iter().all(
            |entry| entry["userId"] == user_id
                && entry["action"] == "qualified"
                && entry["target"].as_str().unwrap().contains("crm.lead")
        ));
        assert_eq!(
            k.audit_log_page(
                &va,
                &t.t,
                1,
                0,
                &osp_server::kernel::rules::AuditLogFilter::default()
            )
            .await
            .unwrap_err()
            .code,
            "FORBIDDEN"
        );
        let (audit_status, audit_response) = t
            .api("GET", "/audit/page?limit=1&offset=0", json!(null))
            .await;
        assert_eq!(audit_status, 200, "{audit_response}");
        assert_eq!(audit_response["items"].as_array().unwrap().len(), 1);
        assert!(audit_response["total"].as_i64().unwrap() >= 1);
        let (filtered_status, filtered_response) = t
            .api(
                "GET",
                &format!("/audit/page?limit=10&offset=0&action=qualified&userId={user_id}&target=crm.lead"),
                json!(null),
            )
            .await;
        assert_eq!(filtered_status, 200, "{filtered_response}");
        assert!(
            filtered_response["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|entry| entry["action"] == "qualified"
                    && entry["userId"] == user_id
                    && entry["target"].as_str().unwrap().contains("crm.lead"))
        );
        assert_eq!(
            k.create(&t.a, &t.t, "utilities.meter", o(json!({})))
                .await
                .unwrap_err()
                .code,
            "MODULE_NOT_ENABLED"
        );
        let _ = viewer;
        step!("validation, máy trạng thái, khóa ngoại RESTRICT, RBAC, kiểm toán");
    }

    {
        let t = Ctx::new(&k, None, &["crm"]).await;
        let mut records = vec![
            t.create("crm.lead", json!({ "name": "Bulk A" })).await,
            t.create("crm.lead", json!({ "name": "Bulk B" })).await,
        ];
        records.sort_by_key(id);
        t.act("crm.lead", &id(&records[1]), "qualified").await;
        let ids = vec![id(&records[0]), id(&records[1])];
        let (status, result) = t
            .api(
                "POST",
                "/data/crm/lead/bulk/qualified",
                json!({ "ids": ids }),
            )
            .await;
        assert_eq!(status, 409, "{result}");
        assert_eq!(t.get("crm.lead", &ids[0]).await["status"], "new");
        let (status, result) = t
            .api(
                "POST",
                "/data/crm/lead/bulk/qualified",
                json!({ "ids": [ids[0], ids[0].to_uppercase()] }),
            )
            .await;
        assert_eq!(status, 422, "{result}");
        assert_eq!(result["error"]["code"], "DUPLICATE_ID");
        t.act("crm.lead", &ids[0], "qualified").await;
        let (status, result) = t
            .api(
                "POST",
                "/data/crm/lead/bulk/converted",
                json!({ "ids": ids }),
            )
            .await;
        assert_eq!(status, 200, "{result}");
        assert_eq!(result["count"], 2);
        assert_eq!(t.list("master-data.party", &[]).await.len(), 2);
        let before = t.list("master-data.party", &[]).await.len();
        let (status, result) = t
            .api(
                "POST",
                "/import/master-data/party",
                json!([{ "name": "Must roll back" }, 12]),
            )
            .await;
        assert_eq!(status, 400, "{result}");
        assert_eq!(result["error"]["code"], "BAD_JSON");
        assert_eq!(t.list("master-data.party", &[]).await.len(), before);
        for invalid_date in ["2026-01-01suffix", "2026-11-日", "2026-02-30"] {
            assert_eq!(t.try_create("accounting.period", json!({ "name": "Bad date", "start_date": invalid_date, "end_date": "2026-12-31" })).await.unwrap_err(), "VALIDATION");
        }
        step!(
            "HTTP bulk: atomic rollback, canonical UUID duplicates, CRM conversion; strict JSON import and dates"
        );
    }

    // ── Luồng CRM -> bán hàng -> kế toán -> HĐĐT -> thu tiền ──
    {
        let t = Ctx::new(&k, None, &["crm", "sales", "accounting", "einvoice"]).await;
        let party = t
            .create("master-data.party", json!({ "name": "Công ty ABC" }))
            .await;
        let warehouse = t.warehouse().await;
        let service = t.create("master-data.product", json!({
            "sku": "CRM-SERVICE", "name": "Dịch vụ hợp đồng", "kind": "service", "price": 5_000_000
        })).await;
        let deal = t
            .create(
                "crm.deal",
                json!({ "title": "HĐ 1", "party": id(&party), "amount": 5_000_000, "warehouse": warehouse, "lines": lines(&id(&service), 1, 5_000_000) }),
            )
            .await;
        t.act("crm.deal", &id(&deal), "won").await;
        let order = &t
            .list("sales.sales_order", &[("source_id", &id(&deal))])
            .await[0];
        assert_eq!(f(&order["total"]), 5_000_000.0);
        t.act("sales.sales_order", &id(order), "confirmed").await;
        t.act("sales.sales_order", &id(order), "delivered").await;
        let inv = &t
            .list("accounting.invoice", &[("source_id", &id(order))])
            .await[0];
        assert_eq!(inv["status"], "posted");
        let e_invoice = t
            .list("einvoice.einvoice", &[("invoice", &id(inv))])
            .await
            .remove(0);
        assert_eq!(e_invoice["status"], "pending");
        let provider = RecordingEInvoiceProvider::default();
        assert!(run_once_with_provider(&k, &provider).await.unwrap() >= 1);
        let issued = t.get("einvoice.einvoice", &id(&e_invoice)).await;
        assert_eq!(issued["status"], "issued");
        assert_eq!(issued["provider"], "test-provider");
        assert_eq!(issued["number"], format!("TEST-{}", id(&e_invoice)));
        assert_eq!(issued["lookup_code"], format!("LOOKUP-{}", id(&e_invoice)));
        assert!(
            provider
                .issues
                .lock()
                .expect("provider issue log lock")
                .iter()
                .any(|(tenant_id, request)| tenant_id == &t.t.id
                    && request["idempotency_key"] == id(&e_invoice))
        );
        t.create(
            "accounting.payment",
            json!({ "party": id(&party), "amount": 5_000_000, "invoice": id(inv), "method": "transfer" }),
        )
        .await;
        assert_eq!(
            t.get("accounting.invoice", &id(inv)).await["status"],
            "paid"
        );
        let cancellation_order = t
            .create(
                "sales.sales_order",
                json!({ "party": id(&party), "warehouse": warehouse, "lines": lines(&id(&service), 1, 5_000_000) }),
            )
            .await;
        t.act("sales.sales_order", &id(&cancellation_order), "confirmed")
            .await;
        t.act("sales.sales_order", &id(&cancellation_order), "delivered")
            .await;
        let cancellation_invoice = t
            .list(
                "accounting.invoice",
                &[("source_id", &id(&cancellation_order))],
            )
            .await
            .remove(0);
        let cancellation_record = t
            .list(
                "einvoice.einvoice",
                &[("invoice", &id(&cancellation_invoice))],
            )
            .await
            .remove(0);
        run_once_with_provider(&k, &provider)
            .await
            .expect("provider issues cancellation test invoice");
        assert_eq!(
            t.get("einvoice.einvoice", &id(&cancellation_record)).await["status"],
            "issued"
        );
        let (cancel_status, cancel_result) = t
            .api(
                "POST",
                &format!(
                    "/data/einvoice/einvoice/{}/cancel_requested",
                    id(&cancellation_record)
                ),
                json!({ "cancellation_reason": "Duplicate test invoice" }),
            )
            .await;
        assert_eq!(cancel_status, 200, "{cancel_result}");
        run_once_with_provider(&k, &provider)
            .await
            .expect("provider processes invoice cancellation");
        let cancelled = t.get("einvoice.einvoice", &id(&cancellation_record)).await;
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["cancellation_reason"], "Duplicate test invoice");
        assert!(
            provider
                .cancellations
                .lock()
                .expect("provider cancellation log lock")
                .iter()
                .any(
                    |(tenant_id, provider_reference, reason)| tenant_id == &t.t.id
                        && provider_reference == &id(&cancellation_record)
                        && reason == "Duplicate test invoice"
                )
        );
        let events = k.event_log(&t.t, 500).await.unwrap();
        assert!(
            events
                .as_array()
                .unwrap()
                .iter()
                .any(|e| !e["causationId"].is_null())
        );
        step!("CRM → đơn bán → hóa đơn → HĐĐT → thu tiền");
    }

    // ── Kho: nhập/xuất, CHẶN TỒN ÂM, cảnh báo luật lỗi + thử lại, cài đặt cho phép âm ──
    {
        let mut t = Ctx::new(
            &k,
            None,
            &["sales", "purchasing", "inventory", "accounting"],
        )
        .await;
        let warehouse = t.warehouse().await;
        let cust = t.create("master-data.party", json!({ "name": "KH" })).await;
        let sup = t
            .create(
                "master-data.party",
                json!({ "name": "NCC", "is_supplier": true }),
            )
            .await;
        let prod = t
            .create(
                "master-data.product",
                json!({ "sku": "SP1", "name": "Hàng 1", "price": 100 }),
            )
            .await;
        let pid = id(&prod);

        let po = t
            .create(
                "purchasing.purchase_order",
                json!({ "supplier": id(&sup), "warehouse": warehouse, "lines": lines(&pid, 50, 60) }),
            )
            .await;
        assert_eq!(f(&po["total"]), 3000.0);
        t.act("purchasing.purchase_order", &id(&po), "submitted")
            .await;
        t.act("purchasing.purchase_order", &id(&po), "approved")
            .await;
        let receipt = t
            .create(
                "purchasing.purchase_receipt",
                json!({
                    "purchase_order": id(&po), "warehouse": warehouse, "lines": lines(&pid, 50, 60)
                }),
            )
            .await;
        t.act("purchasing.purchase_receipt", &id(&receipt), "received")
            .await;
        assert_eq!(
            t.get("purchasing.purchase_order", &id(&po)).await["status"],
            "received"
        );
        for inspection in t
            .list("quality.inspection", &[("source_id", &id(&receipt))])
            .await
        {
            t.act("quality.inspection", &id(&inspection), "passed")
                .await;
        }
        let issue_date = k.tenant(&t.t.id).await.unwrap().business_today();
        let supplier_invoice = t
            .create(
                "purchasing.supplier_invoice",
                json!({
                    "purchase_order": id(&po),
                    "supplier": id(&sup),
                    "invoice_number": "SUP-TEST-001",
                    "issue_date": issue_date.to_string(),
                    "lines": [{ "product": pid, "qty": 50, "price": 60 }]
                }),
            )
            .await;
        t.act(
            "purchasing.supplier_invoice",
            &id(&supplier_invoice),
            "approved",
        )
        .await;
        assert_eq!(t.stock(&pid).await, 50.0);
        assert_eq!(
            t.list("accounting.bill", &[("source_id", &id(&po))]).await[0]["status"],
            "posted"
        );

        let so = t
            .create(
                "sales.sales_order",
                json!({ "party": id(&cust), "warehouse": warehouse, "lines": lines(&pid, 12, 100) }),
            )
            .await;
        t.act("sales.sales_order", &id(&so), "confirmed").await;
        assert_eq!(t.stock(&pid).await, 38.0);

        // Internal ledger writes still enforce available inventory.
        let err = k
            .create(
                &Actor::System,
                &t.t,
                "inventory.stock_move",
                o(json!({ "product": pid, "warehouse": warehouse, "qty": 999, "direction": "out" })),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, "VALIDATION");
        assert!(err.message.contains("tồn"), "{}", err.message);
        assert_eq!(t.stock(&pid).await, 38.0);
        assert_eq!(
            t.list("inventory.stock_move", &[("direction", "out")])
                .await
                .len(),
            1,
            "phiếu kho bị từ chối không được lưu"
        );

        // A stock failure rolls back confirmation and its financial side effects.
        let so2 = t
            .create(
                "sales.sales_order",
                json!({
                    "party": id(&cust), "warehouse": warehouse, "lines": lines(&pid, 100, 100)
                }),
            )
            .await;
        assert!(
            k.act(&t.a, &t.t, "sales.sales_order", &id(&so2), "confirmed")
                .await
                .is_err()
        );
        assert_eq!(
            t.get("sales.sales_order", &id(&so2)).await["status"],
            "draft"
        );
        assert_eq!(t.stock(&pid).await, 38.0);
        assert!(
            t.list("accounting.invoice", &[("source_id", &id(&so2))])
                .await
                .is_empty()
        );
        t.create(
            "inventory.stock_move",
            json!({
                "product": pid, "warehouse": warehouse, "qty": 100, "direction": "in"
            }),
        )
        .await;
        t.act("sales.sales_order", &id(&so2), "confirmed").await;
        assert_eq!(t.stock(&pid).await, 38.0);
        t.act("sales.sales_order", &id(&so2), "delivered").await;
        assert_eq!(
            t.list("accounting.invoice", &[("source_id", &id(&so2))])
                .await
                .len(),
            1
        );

        k.update_settings(&t.t, &json!({ "allowNegativeStock": true }))
            .await
            .unwrap();
        t.refresh().await;
        t.create(
            "inventory.stock_move",
            json!({ "product": pid, "warehouse": warehouse, "qty": 50, "direction": "out" }),
        )
        .await;
        assert_eq!(t.stock(&pid).await, -12.0);
        step!("kho: chặn tồn âm, cảnh báo luật lỗi + thử lại, cài đặt cho phép âm");
    }

    // ── POS: trừ kho, thanh toán, tích điểm; hoàn đơn ──
    {
        let t = Ctx::new(&k, None, &["pos", "inventory", "accounting", "loyalty"]).await;
        let warehouse = t.warehouse().await;
        let session = t
            .create(
                "pos.pos_session",
                json!({ "warehouse": warehouse, "opening_cash": 0 }),
            )
            .await;
        let cust = t
            .create("master-data.party", json!({ "name": "Khách quen" }))
            .await;
        let prod = t
            .create(
                "master-data.product",
                json!({ "sku": "CF", "name": "Cà phê", "price": 45000 }),
            )
            .await;
        t.create("loyalty.member", json!({ "party": id(&cust) }))
            .await;
        t.create(
            "inventory.stock_move",
            json!({ "product": id(&prod), "warehouse": warehouse, "qty": 100, "direction": "in" }),
        )
        .await;
        let order = t.create("pos.pos_order", json!({ "party": id(&cust), "warehouse": warehouse, "session": id(&session), "method": "cash", "cash_received": 180000, "lines": lines(&id(&prod), 4, 45000) })).await;
        assert_eq!(f(&order["total"]), 180000.0);
        t.act("pos.pos_order", &id(&order), "completed").await;
        assert_eq!(t.stock(&id(&prod)).await, 96.0);
        assert_eq!(
            f(&t.list("accounting.payment", &[("source_id", &id(&order))])
                .await[0]["amount"]),
            180000.0
        );
        assert_eq!(
            f(&t.list("loyalty.member", &[("party", &id(&cust))]).await[0]["points"]),
            18.0
        );
        t.update(
            "pos.pos_order",
            &id(&order),
            json!({ "refund_reason": "Customer returned purchase" }),
        )
        .await;
        t.act("pos.pos_order", &id(&order), "refunded").await;
        assert_eq!(
            f(&t.list("loyalty.member", &[("party", &id(&cust))]).await[0]["points"]),
            0.0
        );
        assert_eq!(t.stock(&id(&prod)).await, 100.0);
        step!("POS: kho, thanh toán, điểm thưởng, hoàn đơn");
    }

    // ── Đặt lịch: chặn trùng lịch trên cùng tài nguyên ──
    {
        let t = Ctx::new(&k, None, &["booking"]).await;
        let room = t
            .create(
                "booking.resource",
                json!({ "name": "Phòng 1", "kind": "room" }),
            )
            .await;
        let room2 = t
            .create(
                "booking.resource",
                json!({ "name": "Phòng 2", "kind": "room" }),
            )
            .await;
        let b = |res: &Value, s: &str, e: &str| json!({ "resource": id(res), "starts_at": format!("2027-01-10T{s}:00Z"), "ends_at": format!("2027-01-10T{e}:00Z") });
        let first = t
            .create("booking.booking", b(&room, "09:00", "10:00"))
            .await;
        assert_eq!(
            t.try_create("booking.booking", b(&room, "09:30", "10:30"))
                .await
                .unwrap_err(),
            "CONSTRAINT"
        );
        assert_eq!(
            t.try_create("booking.booking", b(&room, "08:00", "11:00"))
                .await
                .unwrap_err(),
            "CONSTRAINT"
        );
        t.create("booking.booking", b(&room, "10:00", "11:00"))
            .await; // sát giờ: hợp lệ
        t.create("booking.booking", b(&room2, "09:30", "10:30"))
            .await; // tài nguyên khác: hợp lệ
        t.act("booking.booking", &id(&first), "cancelled").await;
        t.create("booking.booking", b(&room, "09:15", "09:45"))
            .await; // lịch đã hủy không còn chiếm chỗ
        step!("đặt lịch: chặn trùng, bỏ qua lịch đã hủy");
    }

    // ── Sản xuất: nhập thành phẩm + trừ nguyên liệu theo BOM ──
    {
        let t = Ctx::new(&k, None, &["manufacturing", "inventory", "quality"]).await;
        let warehouse = t.warehouse().await;
        let raw = t
            .create(
                "master-data.product",
                json!({ "sku": "NL", "name": "Nguyên liệu" }),
            )
            .await;
        let fin = t
            .create(
                "master-data.product",
                json!({ "sku": "TP", "name": "Thành phẩm" }),
            )
            .await;
        t.create(
            "inventory.stock_move",
            json!({ "product": id(&raw), "warehouse": warehouse, "qty": 100, "direction": "in" }),
        )
        .await;
        let bom = t.create("manufacturing.bom", json!({ "product": id(&fin), "output_qty": 2, "components": [{ "product": id(&raw), "qty": 3 }] })).await;
        let po = t
            .create(
                "manufacturing.production_order",
                json!({ "product": id(&fin), "warehouse": warehouse, "qty": 10, "bom": id(&bom) }),
            )
            .await;
        t.act("manufacturing.production_order", &id(&po), "started")
            .await;
        t.act("manufacturing.production_order", &id(&po), "done")
            .await;
        assert_eq!(t.stock(&id(&fin)).await, 0.0, "Finished goods wait for QC");
        let inspection = t
            .list("quality.inspection", &[("source_id", &id(&po))])
            .await
            .remove(0);
        t.act("quality.inspection", &id(&inspection), "passed")
            .await;
        assert_eq!(t.stock(&id(&fin)).await, 10.0);
        assert_eq!(
            t.stock(&id(&raw)).await,
            85.0,
            "10 thành phẩm × 3 / 2 = 15 nguyên liệu"
        );
        assert_eq!(
            t.list("quality.inspection", &[("source_id", &id(&po))])
                .await
                .len(),
            1
        );
        step!("sản xuất: thành phẩm nhập kho, nguyên liệu trừ theo BOM, phiếu QC");
    }

    // ── Tác vụ theo lịch: kỳ thanh toán đến hạn => hóa đơn ──
    {
        let t = Ctx::new(&k, None, &["subscription", "accounting"]).await;
        let cust = t
            .create("master-data.party", json!({ "name": "Thuê bao" }))
            .await;
        let plan = t
            .create(
                "subscription.plan",
                json!({ "name": "Gói tháng", "price": 200000, "interval": "monthly" }),
            )
            .await;
        let sub = t
            .create(
                "subscription.subscription",
                json!({ "party": id(&cust), "plan": id(&plan) }),
            )
            .await;
        let due = t.create("subscription.billing_cycle", json!({ "subscription": id(&sub), "party": id(&cust), "amount": 200000, "due_date": "2020-01-01" })).await;
        let later = t.create("subscription.billing_cycle", json!({ "subscription": id(&sub), "party": id(&cust), "amount": 200000, "due_date": "2999-01-01" })).await;
        let processed = k.run_jobs(&t.t).await.unwrap();
        assert!(
            processed > 0,
            "scheduler failures: {}",
            k.list_failures(&t.a, &t.t, "open").await.unwrap()
        );
        assert_eq!(
            t.get("subscription.billing_cycle", &id(&due)).await["status"],
            "due"
        );
        assert_eq!(
            t.get("subscription.billing_cycle", &id(&later)).await["status"],
            "pending"
        );
        let inv = &t
            .list("accounting.invoice", &[("source_id", &id(&due))])
            .await[0];
        assert_eq!(
            k.run_jobs(&t.t).await.unwrap(),
            0,
            "chạy lại không lập hóa đơn trùng"
        );
        t.create(
            "accounting.payment",
            json!({ "party": id(&cust), "amount": 200000, "invoice": id(inv), "method": "transfer" }),
        )
        .await;
        assert_eq!(
            t.get("subscription.billing_cycle", &id(&due)).await["status"],
            "paid"
        );
        step!("tác vụ theo lịch: kỳ đến hạn → hóa đơn → thu tiền → đã trả");
    }

    // Retry state and business effects commit together under the tenant lock.
    {
        let t = Ctx::new(&k, None, &["subscription"]).await;
        let party = t
            .create("master-data.party", json!({ "name": "Retry customer" }))
            .await;
        let plan = t
            .create(
                "subscription.plan",
                json!({ "name": "Retry plan", "price": 1000, "interval": "monthly" }),
            )
            .await;
        let sub = t
            .create(
                "subscription.subscription",
                json!({ "party": id(&party), "plan": id(&plan), "start": "2001-01-01" }),
            )
            .await;
        let cycle = t
            .list("subscription.billing_cycle", &[("subscription", &id(&sub))])
            .await
            .remove(0);
        let period = t.create("accounting.period", json!({ "name": "Closed for retry", "start_date": "2001-01-01", "end_date": "2001-01-31" })).await;
        t.act("accounting.period", &id(&period), "closed").await;
        assert_eq!(k.run_jobs(&t.t).await.unwrap(), 0);
        let (failure_page_status, failure_page) = t
            .api("GET", "/failures?status=open&limit=1&offset=0", json!(null))
            .await;
        assert_eq!(failure_page_status, 200, "{failure_page}");
        assert_eq!(failure_page["total"], 1, "{failure_page}");
        assert_eq!(failure_page["pageSize"], 1, "{failure_page}");
        assert_eq!(failure_page["offset"], 0, "{failure_page}");
        assert_eq!(failure_page["items"].as_array().unwrap().len(), 1);
        let failure = k.list_failures(&t.a, &t.t, "open").await.unwrap()[0].clone();
        let failure_id = id(&failure);
        assert_eq!(
            k.retry_failure(&t.a, &t.t, &failure_id)
                .await
                .unwrap_err()
                .code,
            "RETRY_FAILED"
        );
        assert!(
            t.list("accounting.invoice", &[("source_id", &id(&cycle))])
                .await
                .is_empty()
        );
        assert_eq!(
            t.get("subscription.billing_cycle", &id(&cycle)).await["status"],
            "pending"
        );
        t.act("accounting.period", &id(&period), "reopened").await;
        let (first, second) = tokio::join!(
            k.retry_failure(&t.a, &t.t, &failure_id),
            k.retry_failure(&t.a, &t.t, &failure_id),
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        let rejected = first.err().or_else(|| second.err()).unwrap();
        assert_eq!(rejected.code, "NOT_OPEN");
        assert_eq!(
            t.list("accounting.invoice", &[("source_id", &id(&cycle))])
                .await
                .len(),
            1
        );
        assert_eq!(
            k.list_failures(&t.a, &t.t, "resolved").await.unwrap()[0]["attempts"],
            3
        );
        assert_eq!(k.open_failure_count(&t.t).await.unwrap(), 0);
        step!("scheduler retries: rollback, audit, atomic resolution, competing callers");
    }

    // ── Gói ngành: thuật ngữ, trường mở rộng (jsonb), lọc và tìm kiếm ──
    {
        let t = Ctx::new(&k, Some("healthcare"), &[]).await;
        let warehouse = t.warehouse().await;
        assert_eq!(t.t.terminology["master-data.party"], "Bệnh nhân");
        let p = t
            .create(
                "master-data.party",
                json!({ "name": "Bệnh nhân Nguyễn An", "national_id": "079123" }),
            )
            .await;
        t.create("master-data.party", json!({ "name": "Trần Bình" }))
            .await;
        assert_eq!(
            t.get("master-data.party", &id(&p)).await["national_id"],
            "079123"
        );
        assert_eq!(
            t.list("master-data.party", &[("national_id", "079123")])
                .await
                .len(),
            1
        );
        let other = Ctx::new(&k, None, &["crm"]).await;
        assert_eq!(
            other
                .try_create(
                    "master-data.party",
                    json!({ "name": "X", "national_id": "1" })
                )
                .await
                .unwrap_err(),
            "VALIDATION"
        );
        let lq = ListQuery {
            filter: vec![],
            limit: 10,
            offset: 0,
            q: Some("nguyễn".into()),
            sort: Some("name".into()),
            desc: true,
        };
        let found = k.list(&t.a, &t.t, "master-data.party", &lq).await.unwrap();
        assert_eq!(found["total"], 1);
        // khám xong lập hóa đơn; phát thuốc trừ kho
        let patient = t.create("clinic.patient", json!({ "party": id(&p) })).await;
        let drug = t
            .create(
                "master-data.product",
                json!({ "sku": "PARA", "name": "Paracetamol" }),
            )
            .await;
        t.create(
            "inventory.stock_move",
            json!({ "product": id(&drug), "warehouse": warehouse, "qty": 200, "direction": "in" }),
        )
        .await;
        let enc = t
            .create(
                "clinic.encounter",
                json!({ "patient": id(&patient), "party": id(&p), "doctor": "Bác sĩ kiểm thử", "diagnosis": "Theo dõi triệu chứng", "fee": 150000 }),
            )
            .await;
        let rx = t
            .create(
                "clinic.prescription",
                json!({ "encounter": id(&enc), "warehouse": warehouse, "items": [{ "product": id(&drug), "qty": 20, "dosage": "Take as directed" }] }),
            )
            .await;
        t.act("clinic.encounter", &id(&enc), "completed").await;
        t.act("clinic.prescription", &id(&rx), "dispensed").await;
        assert_eq!(t.stock(&id(&drug)).await, 180.0);
        assert_eq!(
            f(&t.list("accounting.invoice", &[("source_id", &id(&enc))])
                .await[0]["total"]),
            150000.0
        );
        step!("gói ngành y tế: thuật ngữ, trường mở rộng, tìm kiếm, luồng khám");
    }

    // ── Mọi gói ngành tạo được tenant ──
    {
        let mut ids: Vec<String> = k.verticals.keys().cloned().collect();
        ids.sort();
        for v in &ids {
            let t = Ctx::new(&k, Some(v), &[]).await;
            assert!(t.t.has_module("master-data"));
        }
        step!(format!("{} gói ngành đều tạo được doanh nghiệp", ids.len()));
    }

    {
        let modules: Vec<&str> = k.reg.order.iter().map(String::as_str).collect();
        let t = Ctx::new(&k, None, &modules).await;
        let entities: Vec<String> = k.reg.entities.keys().cloned().collect();
        for entity in &entities {
            let path = format!("/data/{}?limit=1", entity.replace('.', "/"));
            let (status, response) = t.api("GET", &path, json!({})).await;
            assert_eq!(status, 200, "{entity}: {response}");
            assert!(response["items"].is_array(), "{entity}");
            assert!(response["total"].is_u64(), "{entity}");
        }
        let conn = k.pool.get().await.unwrap();
        let timezone: String = conn.query_one("SHOW timezone", &[]).await.unwrap().get(0);
        assert_eq!(timezone, "UTC");
        step!(format!(
            "HTTP list contracts for {} entities across {} modules; PostgreSQL dates use UTC",
            entities.len(),
            modules.len()
        ));
    }

    // ── Đăng nhập, khóa sau 5 lần sai, đổi mật khẩu thu hồi phiên, token ──
    {
        let (t, _, _) = k
            .create_tenant(CreateTenant {
                name: "Auth".into(),
                vertical: None,
                modules: vec!["crm".into()],
                admin: Some(AdminInput {
                    name: None,
                    email: Some("Boss@X.vn".into()),
                    password: Some("password-1".into()),
                }),
                require_email_verification: false,
            })
            .await
            .unwrap();
        assert_eq!(
            k.login(&t.id, "boss@x.vn", "sai").await.unwrap_err().code,
            "INVALID_CREDENTIALS"
        );
        assert_eq!(
            k.login(&t.id, "khong@x.vn", "password-1")
                .await
                .unwrap_err()
                .code,
            "INVALID_CREDENTIALS"
        );
        let ok = k.login(&t.id, "BOSS@x.vn", "password-1").await.unwrap();
        assert!(ok["token"].as_str().unwrap().starts_with("osp_"));
        assert!(ok["user"].get("passwordHash").is_none());
        for _ in 0..5 {
            assert_eq!(
                k.login(&t.id, "boss@x.vn", "sai").await.unwrap_err().code,
                "INVALID_CREDENTIALS"
            );
        }
        assert_eq!(
            k.login(&t.id, "boss@x.vn", "password-1")
                .await
                .unwrap_err()
                .code,
            "TOO_MANY_ATTEMPTS"
        );

        let (staff, _) = k
            .add_user(
                &t,
                "NV",
                Some("nv@x.vn"),
                Some("matkhau-nv-1"),
                &["viewer".into()],
            )
            .await
            .unwrap();
        let s1 = k.login(&t.id, "nv@x.vn", "matkhau-nv-1").await.unwrap();
        let tok = s1["token"].as_str().unwrap();
        assert!(k.authenticate(tok).await.is_some());
        k.update_user(&t, &staff.id, &json!({ "password": "matkhau-moi-2" }))
            .await
            .unwrap();
        assert!(
            k.authenticate(tok).await.is_none(),
            "đổi mật khẩu => phiên cũ bị thu hồi"
        );
        k.update_user(&t, &staff.id, &json!({ "disabled": true }))
            .await
            .unwrap();
        assert_eq!(
            k.login(&t.id, "nv@x.vn", "matkhau-moi-2")
                .await
                .unwrap_err()
                .code,
            "INVALID_CREDENTIALS"
        );
        let admin_id = k.list_users(&t).await.unwrap()[0].id.clone();
        assert_eq!(
            k.update_user(&t, &admin_id, &json!({ "disabled": true }))
                .await
                .unwrap_err()
                .code,
            "LAST_ADMIN"
        );
        assert_eq!(
            k.add_user(&t, "Trùng", Some("NV@x.vn"), None, &["viewer".into()])
                .await
                .unwrap_err()
                .code,
            "EMAIL_TAKEN"
        );
        assert_eq!(
            k.add_user(&t, "Yếu", None, Some("123"), &["viewer".into()])
                .await
                .unwrap_err()
                .code,
            "WEAK_PASSWORD"
        );

        let api = k
            .issue_token(&t, &admin_id, "api", Some("CI"), None, None)
            .await
            .unwrap();
        let raw = api["token"].as_str().unwrap();
        assert!(k.authenticate(raw).await.is_some());
        assert!(
            !k.list_tokens(&t).await.unwrap().to_string().contains(raw),
            "danh sách không lộ token"
        );
        assert!(
            k.revoke_token_by_id(&t, api["id"].as_str().unwrap())
                .await
                .unwrap()
        );
        assert!(k.authenticate(raw).await.is_none());
        step!("đăng nhập argon2id, khóa 5 lần sai, thu hồi phiên, API token");
    }

    // ── Xuất/nhập: CSV tất-cả-hoặc-không, chống formula injection, JSON toàn tenant ──
    {
        let t = Ctx::new(&k, None, &["crm"]).await;
        let csv = "name,phone,is_customer,kind\r\n\"Nguyễn, Văn A\",0901,true,person\r\nTrần B,0902,không,company\r\n";
        let r = k
            .import_records(
                &t.a,
                &t.t,
                "master-data.party",
                ImportInput::Csv(csv.into()),
                false,
            )
            .await
            .unwrap();
        assert_eq!(r["imported"], 2);
        let bad = k
            .import_records(
                &t.a,
                &t.t,
                "master-data.party",
                ImportInput::Csv(
                    "name,kind\r\nHợp lệ,person\r\n,person\r\nSai enum,robot\r\n".into(),
                ),
                false,
            )
            .await
            .unwrap();
        assert_eq!(bad["imported"], 0);
        assert_eq!(
            bad["errors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["row"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert_eq!(
            t.list("master-data.party", &[]).await.len(),
            2,
            "không ghi dòng nào khi có lỗi"
        );
        t.create(
            "master-data.party",
            json!({ "name": "=HYPERLINK(\"http://x\")" }),
        )
        .await;
        let out = k.export_csv(&t.a, &t.t, "master-data.party").await.unwrap();
        assert!(out.starts_with("\u{FEFF}id,"));
        assert!(out.contains("'=HYPERLINK"));
        let dump = k.export_tenant(&t.a, &t.t).await.unwrap();
        assert_eq!(dump["format"], "osp-export/1");
        assert_eq!(
            dump["data"]["master-data.party"].as_array().unwrap().len(),
            3
        );
        assert!(!dump.to_string().contains("argon2id"));
        step!("xuất/nhập CSV + JSON");
    }

    // ── Ghi đồng thời: cùng tenant tuần tự hóa bằng khóa tư vấn, không mất cập nhật ──
    {
        let t = Arc::new(Ctx::new(&k, None, &["inventory"]).await);
        let warehouse = t.warehouse().await;
        let prod = t
            .create(
                "master-data.product",
                json!({ "sku": "C", "name": "Đồng thời" }),
            )
            .await;
        let pid = id(&prod);
        let mut hs = Vec::new();
        for _ in 0..40 {
            let (t, pid, warehouse) = (t.clone(), pid.clone(), warehouse.clone());
            hs.push(tokio::spawn(async move {
                t.create(
                    "inventory.stock_move",
                    json!({ "product": pid, "warehouse": warehouse, "qty": 1, "direction": "in" }),
                )
                .await
            }));
        }
        for h in hs {
            h.await.unwrap();
        }
        assert_eq!(
            t.stock(&pid).await,
            40.0,
            "40 phiếu nhập song song phải cộng đủ 40"
        );
        assert_eq!(t.list("inventory.stock_level", &[]).await.len(), 1);
        step!("40 thao tác ghi song song: không mất cập nhật");
    }

    // ── Xóa doanh nghiệp ──
    {
        let t = Ctx::new(&k, None, &["crm"]).await;
        let p = t.create("master-data.party", json!({ "name": "A" })).await;
        t.create("crm.deal", json!({ "title": "D", "party": id(&p) }))
            .await;
        assert_eq!(
            k.delete_tenant(&t.a, &t.t, "sai").await.unwrap_err().code,
            "CONFIRM_MISMATCH"
        );
        k.delete_tenant(&t.a, &t.t, "Test Co").await.unwrap();
        assert!(k.authenticate(&t.token).await.is_none());
        assert!(k.tenant(&t.t.id).await.is_err());
        step!("xóa doanh nghiệp: sạch dữ liệu, phiên chết");
    }

    // ── Đo nhanh thông lượng (tham khảo) ──
    {
        let t = Ctx::new(&k, Some("retail"), &[]).await;
        let warehouse = t.warehouse().await;
        let cust = t
            .create("master-data.party", json!({ "name": "Bench" }))
            .await;
        let prod = t
            .create(
                "master-data.product",
                json!({ "sku": "B", "name": "Bench", "price": 1000 }),
            )
            .await;
        t.create(
            "inventory.stock_move",
            json!({ "product": id(&prod), "warehouse": warehouse, "qty": 1_000_000, "direction": "in" }),
        )
        .await;
        let n = 200;
        let t0 = std::time::Instant::now();
        for i in 0..n {
            t.create("master-data.party", json!({ "name": format!("KH {i}") }))
                .await;
        }
        let simple = t0.elapsed();
        let mut orders = Vec::new();
        for _ in 0..n {
            orders.push(id(&t
                .create(
                    "sales.sales_order",
                    json!({ "party": id(&cust), "warehouse": warehouse, "lines": lines(&id(&prod), 2, 1000) }),
                )
                .await));
        }
        let t1 = std::time::Instant::now();
        for oid in &orders {
            t.act("sales.sales_order", oid, "confirmed").await;
        }
        let chain = t1.elapsed();
        let t2 = std::time::Instant::now();
        for oid in &orders {
            t.get("sales.sales_order", oid).await;
        }
        let read = t2.elapsed();
        println!(
            "BENCH (debug build={}): tạo đơn giản {:.2} ms/op · xác nhận đơn (chuỗi liên module) {:.2} ms/op · đọc theo id {:.2} ms/op",
            cfg!(debug_assertions),
            simple.as_secs_f64() * 1000.0 / n as f64,
            chain.as_secs_f64() * 1000.0 / n as f64,
            read.as_secs_f64() * 1000.0 / n as f64
        );
        assert_eq!(k.open_failure_count(&t.t).await.unwrap(), 0);
    }
}
