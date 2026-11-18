# Triển khai và vận hành

## 1. Yêu cầu
- Docker Engine và Docker Compose.
- Một volume bền vững cho PostgreSQL.
- Phía trước là một **reverse proxy HTTPS** (Caddy/nginx/Traefik) — ứng dụng không tự làm TLS.

## 2. Chạy bằng Docker Compose

Trên máy chủ Linux, từ thư mục repo, tạo cấu hình bí mật:

```bash
sh deploy/create-env.sh
```

Lệnh tạo `.env` với hai mật khẩu ngẫu nhiên riêng cho PostgreSQL superuser và role ứng dụng. Tệp có quyền `600`, được Git bỏ qua và không được đưa vào image. Nếu `.env` đã tồn tại, script dừng mà không ghi đè. `OSP_SIGNUP=1` chỉ để tạo tenant/quản trị viên đầu tiên; giới hạn bước này qua SSH tunnel và giữ reverse proxy/firewall kín cho tới khi hoàn tất. Giữ bản sao bí mật trong password manager; không gửi hoặc commit tệp này.

Sau khi trỏ DNS và cấu hình reverse proxy HTTPS về `127.0.0.1:3000`:

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

`osp` là API Rust; `osp-worker` chạy scheduler và các hàng đợi webhook, thông báo, hóa đơn điện tử; `postgres` là PostgreSQL 17. Cả hai tiến trình ứng dụng chạy migration có khóa PostgreSQL khi khởi động. API chỉ bind vào loopback; worker không mở cổng HTTP. Cổng PostgreSQL không publish ra host. `DATABASE_URL` dùng role `osp_app` không phải superuser. Demo tắt mặc định. Sau khi tạo tenant/quản trị viên đầu tiên qua SSH tunnel, sửa `.env` thành `OSP_SIGNUP=0` và chạy `docker compose up -d --force-recreate osp` trước khi mở reverse proxy cho người dùng.

Có thể tăng riêng số worker mà không nhân bản cổng API:

```bash
docker compose up -d --scale osp-worker=3
docker compose ps
```

Các worker claim hàng đợi bằng khóa PostgreSQL (`SKIP LOCKED`) và lease; có thể chạy nhiều bản sao cùng lúc. Scheduler cũng có thể chạy trên nhiều worker; các job được khóa và kiểm tra lại trước khi chuyển trạng thái. Thay đổi số worker theo tải và giới hạn kết nối PostgreSQL; tăng replica không thay thế việc đo tải trên hạ tầng production.

### Notification delivery (optional)

Communication messages remain queued unless a transport is configured. Email can use `OSP_COMM_EMAIL_ENDPOINT` or direct SMTP. For SMTP set `OSP_COMM_SMTP_HOST`, `OSP_COMM_EMAIL_FROM`, and optionally `OSP_COMM_SMTP_USERNAME` plus `OSP_COMM_SMTP_PASSWORD`; use `OSP_COMM_SMTP_MODE=implicit_tls` (default port 465) or `OSP_COMM_SMTP_MODE=starttls` (default port 587). Both modes require TLS; plaintext SMTP is not supported. `OSP_COMM_SMTP_PORT` overrides the mode's default port. When an SMTP host is set, SMTP takes precedence for email while HTTPS remains available for SMS. Without SMTP, the existing HTTPS email provider is used. HTTP provider tokens are sent as Bearer authentication and optional `*_FROM` values are included in its JSON request. A provider must accept `POST application/json` with `channel`, `to`, `from`, `subject`, `text`, `tenantId`, and `messageId`, returning 2xx after accepting the message; use `messageId` as the idempotency key. Messages with attachments also include `attachment: { filename, contentType, content }`, where `content` is UTF-8 text; providers that deliver report attachments must support this optional property. 429/5xx and network failures retry with exponential backoff up to eight attempts; permanent SMTP/provider rejections and missing tenant contacts become failed. `OSP_COMM_INTERVAL_SEC` controls the worker interval.

Initial email verification and password reset use the same worker and can use either configured email transport. `OSP_COMM_CONCURRENCY` controls simultaneous deliveries per worker (1–64, default 4); scale with care to the provider's rate limit. Set `OSP_PUBLIC_URL` to the public HTTPS origin (localhost HTTP is allowed for local development) and configure SMTP or `OSP_COMM_EMAIL_ENDPOINT`. Signup creates the tenant and queues a one-time 24-hour verification link; it does not issue a usable login token until the email is verified. Password reset requests return the same response for existing and unknown accounts; valid requests queue a one-time token for 30 minutes, limited to three messages per account per hour. Expired links are not delivered. Successful reset changes the Argon2id password, consumes reset tokens, and revokes that user's active browser sessions and API tokens.

### Optional authenticator MFA

Before users enable TOTP, configure `OSP_TOTP_ENCRYPTION_KEY` with the Base64 encoding of 32 random bytes (generate with `openssl rand -base64 32`). Keep the same value in the secret manager and every app replica; do not commit it or change it during an ordinary deployment. The key encrypts each authenticator secret with AES-256-GCM. If it is missing or changed, users with MFA enabled cannot complete login until an administrator resets their MFA. A tenant admin can reset a user's MFA from **Settings → Users** with a recorded reason; this revokes that user's sessions and API tokens. Each user enables MFA from the account menu, confirms a live TOTP code, then must save the one-time recovery codes. Login challenges expire after five minutes and allow five attempts.

### Optional Prometheus metrics

Set `OSP_METRICS_TOKEN` to a random secret of at least 32 characters to enable `GET /metrics`. Without it, the endpoint returns 404. Scrapes require `Authorization: Bearer <token>`. In addition to aggregate HTTP request counts by status class and response-time histogram, it exposes total counts of open workflow/job failures and dead-letter integration deliveries. These gauges contain no tenant labels or identifiers. Use [`prometheus-alerts.yml`](prometheus-alerts.yml) as a starting point for Prometheus rules, change its `job="osp"` selector to match the scrape job name you configure, then configure an Alertmanager receiver for email/chat/on-call delivery and adjust the `for` interval or threshold to your service objectives. Keep the scrape on a private network or use HTTPS through the reverse proxy, and store the token in the secret manager.

### Optional distributed tracing

Run an OpenTelemetry Collector or another OTLP/HTTP receiver, then set `OTEL_EXPORTER_OTLP_ENDPOINT` to its base URL (for example `http://otel-collector:4318`) or set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the complete trace URL (for example `http://otel-collector:4318/v1/traces`). Tracing stays disabled when neither endpoint is set. This build exports HTTP/protobuf batches over HTTP; the exporter also accepts the standard OTLP headers and timeout variables. Incoming W3C `traceparent` is continued. Only HTTP request spans are exported, with method and request ID; URL paths and worker events are excluded to avoid tenant or record identifiers. Keep collector access private or use HTTPS, and put credentials in the secret manager. The provider flushes its batch during graceful shutdown.

### E-invoice provider (optional)

The Rust worker issues posted accounting invoices and processes cancellation requests through registered `EInvoiceProvider` adapters. The default worker registers the HTTPS REST adapter when `OSP_EINVOICE_ENDPOINT` is set; `OSP_EINVOICE_PROVIDER` names that adapter (defaults to `rest`) and `OSP_EINVOICE_TOKEN` supplies its optional bearer token. `OSP_EINVOICE_TIMEOUT_SEC` accepts 1–120 seconds, `OSP_EINVOICE_CONCURRENCY` accepts 1–16 (default 2) to control simultaneous requests per worker, and `OSP_EINVOICE_INTERVAL_SEC=0` disables the worker. Transient network, HTTP 408/425/429, and 5xx errors retry automatically up to eight attempts with a one-minute to 64-minute exponential delay; permanent provider rejections remain failed for operator review. Manual retry resets the attempt counter. Without a configured adapter, requests remain pending.

Deployments can register multiple compiled adapters with `EInvoiceProviderRegistry` and start the worker with `spawn_einvoice_worker_with_registry`. A tenant's `einvoiceProvider` setting selects the adapter code for newly queued invoices, and that code is snapshotted on the request so later setting changes do not reroute work already queued. If the tenant has no override, the registry default is used. Adapter credentials must be resolved from environment variables or a secret manager inside the adapter; do not put provider tokens, certificates, or passwords in tenant settings. The REST adapter sends `X-OSP-Tenant-ID` and a tenant-scoped `Idempotency-Key`, which its receiver must honor for safe recovery after a worker restart.

### SePay eInvoice API v1

The built-in SePay eInvoice v1 adapter is enabled when `OSP_SEPAY_EINVOICE_CLIENT_ID` is set. Configure `OSP_SEPAY_EINVOICE_CLIENT_SECRET`, `OSP_SEPAY_EINVOICE_BASE_URL` (defaults to `https://einvoice-api.sepay.vn`; use `https://einvoice-api-sandbox.sepay.vn` for sandbox), `OSP_SEPAY_EINVOICE_PAYMENT_METHOD`, and `OSP_SEPAY_EINVOICE_TENANT_CONFIG`. The latter is a server-side JSON object keyed by OSP tenant ID, with each value containing that tenant's `providerAccountId`, `templateCode`, and `invoiceSeries`. Every tenant using SePay must have an explicit map entry; the adapter fails closed without one. The tenant setting remains only `{ "einvoiceProvider": "sepay" }`, and credentials and account identifiers are never stored in tenant settings. `OSP_SEPAY_EINVOICE_TIMEOUT_SEC` is optional (1–120 seconds).

SePay issuance is asynchronous. The adapter stores the provider tracking code in the durable e-invoice request and the worker polls it on later claims; `Pending` never changes the request to `issued`. Unknown create outcomes are marked for reconciliation, and retries only query the stable invoice reference code; they never submit another create request. Before the adapter makes a network request, it requires a buyer name, currency code (`VND`, `USD`, or `CAD`), ISO invoice date, and line item names, units, quantities, prices, and explicit tax rates. Party contact/tax fields and product name/SKU/unit are snapshotted from the same tenant's records. Missing line tax rates are not inferred. SePay cancellation is not implemented by this adapter, so cancellation requests fail closed.

The REST adapter implements the OSP JSON contract and is not certified for VNPT, Viettel, MISA, or another vendor API. A production adapter requires that provider's current API specification, sandbox account, credentials, invoice-signing certificate where applicable, and successful sandbox issuance/cancellation before production enablement.

Máy cục bộ có thể tạo SSH tunnel bằng lệnh `ssh -L 3000:127.0.0.1:3000` với tài khoản và máy chủ của bạn, mở `http://127.0.0.1:3000`, tạo doanh nghiệp và tài khoản admin, rồi đóng tunnel. Khi signup đã tắt và health check xanh, mới trỏ domain/reverse proxy vào app.

Không thay mật khẩu trong `.env` rồi kỳ vọng volume hiện hữu tự đổi theo. PostgreSQL chỉ khởi tạo role từ các biến đó khi volume được tạo lần đầu; đổi mật khẩu role đang dùng cần thao tác SQL có kế hoạch và cập nhật đồng thời cấu hình ứng dụng.

Chạy **chỉ một số module** (mô hình bán/triển khai từng phần mềm; tự kéo theo module phụ thuộc + module lõi):
```bash
OSP_MODULES=crm,sales,accounting npm run dev
# hoặc OSP_MODULES=crm,sales,accounting
# hoặc trong thư mục từng module:  cd modules/crm && npm run dev
```
Doanh nghiệp tạo ra chỉ chọn được trong số module đã cài; module không có sẽ bị bỏ qua kèm cảnh báo.

### Biến môi trường

| Biến / cờ | Mặc định | Ý nghĩa |
|---|---|---|
| `OSP_PORT` / `PORT` / `--port=` | `3000` | Cổng lắng nghe |
| `OSP_PROCESS_ROLE` | `all` | `api` chỉ phục vụ HTTP, `worker` chỉ chạy tác vụ nền, `all` chạy cả hai; Compose đặt riêng role cho từng service |
| `OSP_RATE_LIMIT` | `600` | Hạn mức API theo IP hiệu dụng mỗi phút; bộ đếm hiện giữ trong bộ nhớ của từng tiến trình |
| `OSP_TRUSTED_PROXIES` | rỗng | Danh sách IP/CIDR reverse proxy tin cậy, phân cách bằng dấu phẩy. Chỉ khi peer trực tiếp thuộc danh sách, ứng dụng mới đọc `X-Forwarded-For` từ phải sang trái để xác định IP client và bỏ qua các hop proxy đã tin cậy. Ví dụ: `127.0.0.1/32,10.0.0.0/8`. Không đưa IP client hoặc mạng Internet vào danh sách này. |
| `DATABASE_URL` | — | Chuỗi kết nối PostgreSQL bắt buộc; `sslmode` nhận `prefer`, `require` hoặc `disable` |
| `OSP_MODULES` / `--modules=` | tất cả | Danh sách module cần cài |
| `OSP_JOBS_INTERVAL_SEC` | `60` | Chu kỳ scheduler; đặt `0` để tắt cả job và bank feed schedules. Bank feed schedule dùng chung worker tick. |
| `OSP_COMM_CONCURRENCY` | `4` | Số lần gửi đồng thời trên mỗi worker (1–64); giới hạn theo rate limit của nhà cung cấp |
| `OSP_EINVOICE_CONCURRENCY` | `2` | Số request hóa đơn điện tử đồng thời trên mỗi worker (1–16); điều chỉnh theo provider |
| `OSP_DEMO` | `1` (dev) · `0` (production) | Bật `POST /api/demo` và nút "Dùng thử" |
| `OSP_SIGNUP` | `0` trong Compose; script khởi tạo đặt `1` | Tắt sau khi tạo tenant/quản trị viên đầu tiên |
| `OSP_TOTP_ENCRYPTION_KEY` | rỗng | Khóa Base64 32 byte để mã hóa bí mật TOTP; bắt buộc trước khi bất kỳ người dùng nào bật MFA |
| `OSP_METRICS_TOKEN` | rỗng | Bật `/metrics` khi là bí mật ngẫu nhiên từ 32 ký tự; giữ endpoint trong mạng giám sát riêng |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | rỗng | Bật trace OTLP/HTTP khi cấu hình URL gốc; exporter tự thêm `/v1/traces` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | rỗng | Bật trace OTLP/HTTP với URL đầy đủ; ưu tiên hơn endpoint chung |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | rỗng | Header xác thực/định tuyến của exporter; lưu token trong secret manager |
| `OSP_OUTBOX_INTERVAL_SEC` | `2` | Chu kỳ worker webhook outbox; đặt `0` để tạm dừng worker |
| `NODE_ENV=production` | — | Tắt demo mặc định, bật log truy cập JSON (thời gian, request ID, phương thức, trạng thái, thời gian xử lý) |

Máy chủ tắt êm khi nhận `SIGINT`/`SIGTERM` (đóng DB).

`DATABASE_URL` hỗ trợ `sslmode=disable`, `prefer` (mặc định) và `require`.
Connector Rustls xác minh chuỗi chứng chỉ và hostname theo CA hệ điều hành; chế
độ `prefer` chỉ rơi về kết nối rõ nếu máy chủ không hỗ trợ TLS. Với PostgreSQL
managed hoặc mạng không tin cậy, đặt `sslmode=require`. Cài CA riêng vào trust
store của hệ điều hành hoặc đặt `SSL_CERT_FILE` trỏ đến PEM CA. Chỉ dùng
`sslmode=disable` cho mạng cô lập có kiểm soát.

## 3. Dữ liệu và lưu trữ PostgreSQL

PostgreSQL chứa **tất cả**: dữ liệu nghiệp vụ, doanh nghiệp, người dùng (băm mật khẩu, bí mật MFA đã mã hóa), phiên (băm token), nhật ký sự kiện và kiểm toán. Mỗi bảng nghiệp vụ có khóa tenant và RLS bắt buộc.

| Bảng | Nội dung |
|---|---|
| `osp_tenants`, `osp_users`, `osp_sessions` | Cấu hình doanh nghiệp, người dùng và phiên |
| `osp_events`, `osp_audit`, `osp_failures`, `osp_outbox` | Nhật ký sự kiện, kiểm toán, lỗi xử lý và webhook delivery |
| `osp_schema`, `osp_schema_version` | Theo dõi migration |
| `<module>__<entity>` | Dữ liệu nghiệp vụ theo module/entity |

### Sao lưu
```bash
umask 077
export OSP_BACKUP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm run backup -- "data/backup/osp-$(date +%F).dump.enc"
```

`npm run backup` xác minh archive bằng `pg_restore --list` trước khi hoàn tất. Khi
đặt `OSP_BACKUP_ENCRYPTION_KEY` (32 byte, 64 ký tự hex hoặc base64), archive được
mã hóa AES-256-GCM; nếu không đặt khóa, công cụ cảnh báo và tạo dump rõ như trước.
Lưu khóa trong secret manager tách khỏi bản backup, giữ lại khóa tương ứng với
từng thế hệ backup, và định kỳ thử khôi phục. Mất khóa thì không thể giải mã.

Giải mã và kiểm tra archive trong thư mục tạm có quyền truy cập hạn chế:
```bash
node tools/decrypt-backup.mjs data/backup/osp-YYYY-MM-DD.dump.enc /secure-temp/osp.dump
pg_restore --exit-on-error --dbname "$DATABASE_URL" /secure-temp/osp.dump
rm -f /secure-temp/osp.dump
```

Lưu bản sao lưu ngoài host Docker. Mã hóa archive không thay thế mã hóa ổ đĩa
hoặc volume PostgreSQL đang chạy; hãy cấu hình mã hóa storage ở hạ tầng.

Bản sao lưu toàn bộ tenant cần tài khoản quản trị backup có quyền đọc qua RLS;
không dùng role ứng dụng `osp_app` không có `BYPASSRLS` để dump toàn database.
Ví dụ trên dùng tài khoản quản trị riêng của container PostgreSQL. Không đưa
credential quản trị này vào `DATABASE_URL` của ứng dụng.

Khuyến nghị: chạy hằng ngày bằng cron/Task Scheduler, giữ ≥ 7 bản, **chép ra ngoài máy chủ**, và **định kỳ thử khôi phục**.

### Khôi phục
Khôi phục cần dừng ứng dụng, dựng lại database trên môi trường đã chọn, giải mã archive (nếu được mã hóa), khôi phục bằng `pg_restore`, rồi khởi động ứng dụng. Thử quy trình trên máy staging trước khi thao tác production; không khôi phục đè dữ liệu production khi chưa có kế hoạch và bản backup kiểm chứng.

### Nâng cấp
Lược đồ DB có phiên bản (`schema_version`); khi khởi động, các migration chưa chạy được áp dụng tự động trong một giao dịch. **Luôn sao lưu trước khi nâng cấp.** Không hỗ trợ hạ cấp.

## 4. Reverse proxy

**Caddy** (tự cấp HTTPS):
```
osp.congty.vn {
  encode gzip
  reverse_proxy 127.0.0.1:3000
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
```

**nginx:**
```nginx
server {
  listen 443 ssl http2;
  server_name osp.congty.vn;
  # ssl_certificate ...; ssl_certificate_key ...;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  client_max_body_size 6m;                    # nhập CSV tối đa 5 MB
  limit_req_zone $binary_remote_addr zone=osp:10m rate=20r/s;

  location / {
    limit_req zone=osp burst=40 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Request-Id $request_id;
    proxy_read_timeout 35s;
  }
}
```
Vì ứng dụng thấy IP của proxy, **giới hạn tốc độ theo IP phải đặt ở proxy** (xem [SECURITY.md](SECURITY.md)).

## 5. Docker

[`Dockerfile`](../Dockerfile) build Rust nhiều tầng, chạy bằng user không đặc quyền; [`docker-compose.yml`](../docker-compose.yml) cung cấp PostgreSQL và volume:
```bash
docker compose up --build -d
```
Kiểm tra `docker compose ps` phải hiển thị cả `osp` và `postgres` ở trạng thái healthy.

## 6. Kiểm tra và giới hạn

Test `flows.rs` có phép đo tham khảo trên kernel + PostgreSQL thật; xem bằng
`cargo test --manifest-path server/Cargo.toml --test flows -- --nocapture`.
Đây là debug build, không qua mạng và không phải số đo tải HTTP production.
Các số đo của runtime cũ đã được gỡ để tránh dùng chúng định cỡ máy chủ Rust.

**Hệ quả khi định cỡ**
- PostgreSQL cho phép nhiều tiến trình/container cùng truy cập; thao tác ghi cùng tenant được khóa tư vấn trong giao dịch để giữ tính nhất quán.
- Lọc, sắp xếp và phân trang chạy trong PostgreSQL; cần tối ưu chỉ mục theo workload thực tế khi dữ liệu lớn.
- Danh sách CRUD tải tối đa 25 dòng mỗi trang qua PostgreSQL; workflow đối chiếu có thể nạp nhiều trang qua helper dùng chung. Cần xem xét tải DB và bộ nhớ trình duyệt cho workflow trên tenant có lượng dữ liệu lớn.
- Các replica dùng PostgreSQL chung và khóa transaction theo tenant; quota Governor hiện theo từng tiến trình. Cần giới hạn tổng tại proxy khi chạy nhiều replica.

Diễn tập Linux độc lập, bao gồm khôi phục database thật:

```bash
docker build -t osp-suite:rust-web-verification .
npm run test:container
```

Công cụ kiểm tra health, API bán hàng, RLS với role ứng dụng, `pg_dump`/`pg_restore`,
khởi động lại và dữ liệu/phiên đã khôi phục. Nó dùng project, credential và volume
tạm riêng; không triển khai lên môi trường production hiện có.

## 7. Vận hành hằng ngày

| Việc | Cách |
|---|---|
| Kiểm sống | `GET /api/health` → `{status:"ok", modules, tenants}` |
| Tra lỗi người dùng báo | Lấy `requestId` trong phản hồi lỗi → tìm trong log truy cập |
| Xem ai làm gì | Cài đặt → Nhật ký (hoặc `GET /api/t/:tid/audit`) |
| Chuỗi tự động chạy sai | Cài đặt → Dòng sự kiện; mục `✕ <module>: <lý do>` |
| Thu hồi truy cập khẩn cấp | Khóa người dùng (thu hồi mọi phiên/token) hoặc thu hồi từng token |
| Xóa doanh nghiệp theo yêu cầu | Cài đặt → Dữ liệu → Khu vực nguy hiểm (nhớ xuất dữ liệu trước) |

## 8. Danh sách kiểm trước khi đưa vào dùng thật
- [ ] Đã qua [checklist bảo mật](SECURITY.md#9-checklist-triển-khai-production)
- [ ] `npm run check` và `npm run e2e` đều đạt
- [ ] Sao lưu tự động + **đã thử khôi phục ít nhất một lần**
- [ ] HTTPS, HSTS, giới hạn tốc độ ở proxy
- [ ] Đã quyết định `OSP_SIGNUP`, `OSP_DEMO`
- [ ] Có người nhận cảnh báo khi dịch vụ ngừng
# Optional single sign-on (OIDC)

OSP can use one OpenID Connect provider for all tenant accounts. Set `OSP_OIDC_ISSUER_URL`, `OSP_OIDC_CLIENT_ID`, and `OSP_OIDC_CLIENT_SECRET`, then set `OSP_OIDC_REDIRECT_URI` to the public callback page, normally `https://your-host/oidc-callback.html`. Register that exact redirect URI at the provider and keep `OSP_PUBLIC_URL` on the same HTTPS origin. The provider must return an ID token with a verified email claim. The sign-in button appears when all settings are valid.

The authorization-code flow uses PKCE, state, nonce, TLS discovery, and a short-lived encrypted HttpOnly cookie. The first sign-in links only to an existing, active account in the entered tenant with an exactly matching verified email; it never creates accounts or assigns roles. Later sign-ins use the provider issuer and subject pair. Existing MFA remains required. The OIDC client secret must contain at least 32 bytes and is also used to encrypt the short-lived flow cookie, so keep it stable across replicas and deployments.

## Bank-feed webhooks

Expose `POST /api/hooks/bank-feed/{tenantId}/{connectorId}` over HTTPS and preserve the original JSON body and provider headers through the reverse proxy. Set one runtime secret variable per enabled connector using the `OSP_BANK_WEBHOOK_SECRET_<UPPERCASE_NAME>` prefix; configure only the variable name and account mapping fields on the connector. SePay requires an HMAC-SHA256 webhook with JSON and a matching `webhook_account_number`; Casso legacy webhook uses the provider's `secure-token` header and matching `webhook_account_id`. Never place the secret value in connector JSON or source control. Casso V2 is not enabled because its published payload does not identify signed transaction direction or the Casso subaccount required for safe mapping.
