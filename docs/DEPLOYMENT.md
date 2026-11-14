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

`osp` là máy chủ Rust; `postgres` là PostgreSQL 17. Migration lược đồ và Row-Level Security chạy tự động khi máy chủ khởi động. Ứng dụng chỉ bind vào loopback; reverse proxy phải chạy cùng máy chủ hoặc được cấu hình qua kênh private. Cổng PostgreSQL không publish ra host. `DATABASE_URL` dùng role `osp_app` không phải superuser. Demo tắt mặc định. Sau khi tạo tenant/quản trị viên đầu tiên qua SSH tunnel, sửa `.env` thành `OSP_SIGNUP=0` và chạy `docker compose up -d --force-recreate osp` trước khi mở reverse proxy cho người dùng.

### Notification delivery (optional)

Communication messages remain queued unless a transport is configured. Email can use `OSP_COMM_EMAIL_ENDPOINT` or direct SMTP. For SMTP set `OSP_COMM_SMTP_HOST`, `OSP_COMM_EMAIL_FROM`, and optionally `OSP_COMM_SMTP_USERNAME` plus `OSP_COMM_SMTP_PASSWORD`; use `OSP_COMM_SMTP_MODE=implicit_tls` (default port 465) or `OSP_COMM_SMTP_MODE=starttls` (default port 587). Both modes require TLS; plaintext SMTP is not supported. `OSP_COMM_SMTP_PORT` overrides the mode's default port. When an SMTP host is set, SMTP takes precedence for email while HTTPS remains available for SMS. Without SMTP, the existing HTTPS email provider is used. HTTP provider tokens are sent as Bearer authentication and optional `*_FROM` values are included in its JSON request. A provider must accept `POST application/json` with `channel`, `to`, `from`, `subject`, `text`, `tenantId`, and `messageId`, returning 2xx after accepting the message; use `messageId` as the idempotency key. Messages with attachments also include `attachment: { filename, contentType, content }`, where `content` is UTF-8 text; providers that deliver report attachments must support this optional property. 429/5xx and network failures retry with exponential backoff up to eight attempts; permanent SMTP/provider rejections and missing tenant contacts become failed. `OSP_COMM_INTERVAL_SEC` controls the worker interval.

Initial email verification and password reset use the same worker and can use either configured email transport. Set `OSP_PUBLIC_URL` to the public HTTPS origin (localhost HTTP is allowed for local development) and configure SMTP or `OSP_COMM_EMAIL_ENDPOINT`. Signup creates the tenant and queues a one-time 24-hour verification link; it does not issue a usable login token until the email is verified. Password reset requests return the same response for existing and unknown accounts; valid requests queue a one-time token for 30 minutes, limited to three messages per account per hour. Expired links are not delivered. Successful reset changes the Argon2id password, consumes reset tokens, and revokes that user's active browser sessions and API tokens.

### E-invoice provider (optional)

The Rust worker issues posted accounting invoices and processes cancellation requests through the configured HTTPS REST contract. Set `OSP_EINVOICE_ENDPOINT`, `OSP_EINVOICE_PROVIDER`, and `OSP_EINVOICE_TOKEN` in `.env`; `OSP_EINVOICE_TIMEOUT_SEC` accepts 1–120 seconds and `OSP_EINVOICE_INTERVAL_SEC=0` disables the worker. Without an endpoint, requests remain pending. The provider must honor the `Idempotency-Key` header for safe recovery after a worker restart. The generic adapter is not certified for a vendor API; map the payload and response to the actual provider contract before enabling production issuance.

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
| `DATABASE_URL` | — | Chuỗi kết nối PostgreSQL bắt buộc khi chạy Rust production |
| `OSP_MODULES` / `--modules=` | tất cả | Danh sách module cần cài |
| `OSP_DEMO` | `1` (dev) · `0` (production) | Bật `POST /api/demo` và nút "Dùng thử" |
| `OSP_SIGNUP` | `0` trong Compose; script khởi tạo đặt `1` | Tắt sau khi tạo tenant/quản trị viên đầu tiên |
| `OSP_OUTBOX_INTERVAL_SEC` | `2` | Chu kỳ worker webhook outbox; đặt `0` để tạm dừng worker |
| `NODE_ENV=production` | — | Tắt demo mặc định, bật log truy cập JSON (mỗi dòng: thời gian, request id, IP, phương thức, đường dẫn, trạng thái, ms) |

Máy chủ tắt êm khi nhận `SIGINT`/`SIGTERM` (đóng DB).

## 3. Dữ liệu và lưu trữ PostgreSQL

PostgreSQL chứa **tất cả**: dữ liệu nghiệp vụ, doanh nghiệp, người dùng (băm mật khẩu), phiên (băm token), nhật ký sự kiện và kiểm toán. Mỗi bảng nghiệp vụ có khóa tenant và RLS bắt buộc.

| Bảng | Nội dung |
|---|---|
| `osp_tenants`, `osp_users`, `osp_sessions` | Cấu hình doanh nghiệp, người dùng và phiên |
| `osp_events`, `osp_audit`, `osp_failures`, `osp_outbox` | Nhật ký sự kiện, kiểm toán, lỗi xử lý và webhook delivery |
| `osp_schema`, `osp_schema_version` | Theo dõi migration |
| `<module>__<entity>` | Dữ liệu nghiệp vụ theo module/entity |

### Sao lưu
```bash
umask 077
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "osp-backup-$(date +%F).dump"
```

Lưu bản dump ở nơi an toàn ngoài host Docker và đặt lịch chạy định kỳ.

Bản sao lưu toàn bộ tenant cần tài khoản quản trị backup có quyền đọc qua RLS;
không dùng role ứng dụng `osp_app` không có `BYPASSRLS` để dump toàn database.
Ví dụ trên dùng tài khoản quản trị riêng của container PostgreSQL. Không đưa
credential quản trị này vào `DATABASE_URL` của ứng dụng.

Khuyến nghị: chạy hằng ngày bằng cron/Task Scheduler, giữ ≥ 7 bản, **chép ra ngoài máy chủ**, và **định kỳ thử khôi phục**.

### Khôi phục
Khôi phục cần dừng ứng dụng, dựng lại database trên môi trường đã chọn, khôi phục dump bằng `pg_restore`, rồi khởi động ứng dụng. Thử quy trình trên máy staging trước khi thao tác production; không khôi phục đè dữ liệu production khi chưa có kế hoạch và bản backup kiểm chứng.

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
- Giao diện web tải tối đa 1.000 bản ghi mỗi danh sách.
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
