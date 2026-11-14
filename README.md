# OSP Suite

Bộ phần mềm quản trị doanh nghiệp dạng **module**: ERP, CRM, kế toán, nhân sự, kho, POS, thương mại điện tử… cho **22 ngành**. Các bounded context có mã nguồn và ranh giới riêng trong một Rust modular monolith, triển khai cùng một ứng dụng và dùng PostgreSQL chung. Các luồng liên module được điều phối bằng sự kiện trong cùng giao dịch.

| | |
|---|---|
| Module | 50 (lõi, bán hàng, chuỗi cung ứng, tài chính, nhân sự, vận hành, nền tảng, chuyên ngành) |
| Loại dữ liệu · sự kiện | 183 · 821 |
| Luồng liên module | Handler Rust trong các bounded context; catalog không còn luật nghiệp vụ JSON |
| Gói ngành | 22 |
| Kiểm tra build/catalog | `npm run check`; Rust test suite và E2E chạy riêng khi cần |

Lớp web dùng Axum, Tower HTTP và Governor cho định tuyến, streaming tệp tĩnh,
gzip, cache revalidation, tracing và quota truy cập. Quyết định dùng thư viện
được ghi tại [ADR-0008](docs/adr/0008-rust-web-libraries.md). Bộ kiểm tra
`npm run test:container` diễn tập image Linux và backup/restore trên tài nguyên
Docker tạm riêng; xem [hướng dẫn triển khai](docs/DEPLOYMENT.md).

> **Trạng thái: v0.2 — khung chạy được, chưa phải sản phẩm hoàn chỉnh để bán.** Máy chủ triển khai chính thức là Rust + PostgreSQL, có lưu trữ bền vững, đăng nhập thật, giao diện web và tài liệu đầy đủ; **chưa có** kế toán đúng chuẩn Việt Nam, hóa đơn điện tử thật, tích hợp ngân hàng/Zalo, nghiệp vụ sâu từng ngành. Xem [lộ trình](docs/ROADMAP.md).

Kiến trúc Rust modular monolith được mô tả tại [Rust modular architecture](docs/RUST-MODULAR-ARCHITECTURE.md), [hướng dẫn cấu trúc module](docs/MODULE-ARCHITECTURE.md) và [ADR-0007](docs/adr/0007-rust-bounded-contexts.md). Runtime nghiệp vụ và API dùng Rust; catalog module/ngành là JSON. Nguồn và cấu hình TypeScript đã được gỡ khỏi dự án. Client Vite/React hiện render các luồng đăng nhập, dữ liệu ERP và toàn bộ tab cài đặt tenant. Sản phẩm vẫn đang được hoàn thiện; chưa tuyên bố đủ mọi nghiệp vụ ERP để phát hành thương mại.

## Chạy bằng Docker (khuyến nghị)

Yêu cầu Docker Engine và Docker Compose.

```bash
sh deploy/create-env.sh
docker compose up --build -d
# kiểm tra nội bộ: http://127.0.0.1:3000
```

Compose chạy hai container: `osp` (Rust API và client React đã build) và `postgres` (PostgreSQL 17), dữ liệu PostgreSQL nằm trong volume `osp-postgres`. Script tạo hai mật khẩu riêng trong `.env`. Nó tạm bật signup để tạo tenant/admin đầu tiên; sau đó tắt signup theo [hướng dẫn triển khai](docs/DEPLOYMENT.md). App chỉ bind vào loopback để đặt sau reverse proxy HTTPS.

Trang đầu cho phép **đăng nhập**, **tạo doanh nghiệp theo ngành**, hoặc **dùng thử** khi bật `OSP_DEMO=1`.

Chạy trực tiếp binary Rust ngoài Docker cần `DATABASE_URL` trỏ tới PostgreSQL bằng vai trò không có `SUPERUSER` hoặc `BYPASSRLS`:

```bash
# phát triển với PostgreSQL nhúng
npm run dev

# chạy release với PostgreSQL ngoài
npm start
```

### Chạy Rust với một nhóm module
```bash
npm run build
OSP_DEFS=definitions OSP_PUBLIC=client-dist OSP_MODULES=crm,sales,accounting cargo run --manifest-path server/Cargo.toml
```

### Kiểm tra chất lượng
```bash
npm run check          # fmt + cargo check + catalog lint
npm test               # Rust unit/integration tests
npm run e2e            # giao diện bằng Chrome thật + accessibility (cần Chrome/Edge)
npm run backup         # sao lưu nóng cơ sở dữ liệu
```

## Cấu trúc

```
server/             Máy chủ Rust, kernel, API HTTP, migration PostgreSQL + RLS
platform/server     Giao diện web (public/) + design system
definitions/modules/<id>.json   Catalog schema, trạng thái, tích hợp và seed được Rust nạp trực tiếp
definitions/verticals/<id>.json Cấu hình gói ngành
tools/             lint, sinh docs, tạo module, sao lưu
tests/e2e/         Kiểm thử giao diện
docs/              Tài liệu
```

## Tài liệu

Mục lục đầy đủ: **[docs/README.md](docs/README.md)**

| | |
|---|---|
| [Kiến trúc](docs/ARCHITECTURE.md) · [ADR](docs/adr) | Các module gắn kết thế nào, vì sao thiết kế vậy |
| [Kiến trúc Rust theo bounded context](docs/RUST-MODULAR-ARCHITECTURE.md) · [ADR-0007](docs/adr/0007-rust-bounded-contexts.md) | Ranh giới module, quy tắc phụ thuộc và thứ tự port |
| [Hướng dẫn cấu trúc module](docs/MODULE-ARCHITECTURE.md) | Trách nhiệm từng lớp, quy tắc giao dịch/tenant và module BI mẫu |
| [Design system](docs/DESIGN-SYSTEM.md) | Tokens, thành phần, mẫu màn hình, truy cập, giọng văn |
| [API](docs/API.md) · [OpenAPI](docs/openapi.json) | Tích hợp |
| [Viết module / ngành](docs/MODULE-AUTHORING.md) | Thêm module, thêm ngành |
| [Triển khai](docs/DEPLOYMENT.md) | Chạy thật, sao lưu, định cỡ |
| [Bảo mật](docs/SECURITY.md) | Đã làm gì, chưa làm gì, checklist |
| [Lộ trình](docs/ROADMAP.md) | Còn thiếu gì, làm gì trước |
| [Danh mục module](docs/MODULE-CATALOG.md) · [Bản đồ tích hợp](docs/INTEGRATION-MAP.md) · [22 ngành](docs/VERTICALS.md) | Sinh tự động |

## Đóng góp
Xem [CONTRIBUTING.md](docs/CONTRIBUTING.md). Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md).
