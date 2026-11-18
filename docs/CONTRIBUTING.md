# Đóng góp và quy trình làm việc

## Thiết lập

```bash
cargo --version
npm install
npm run dev
```

`npm run dev` khởi chạy máy chủ Rust và Vite cùng lúc. Vite mở giao diện tại `http://127.0.0.1:5173` và chuyển tiếp `/api` sang Rust ở cổng 3000. Bản phát triển dùng PostgreSQL nhúng; cấu hình `DATABASE_URL` để chạy với PostgreSQL riêng.

## Quy ước kiến trúc

- Nghiệp vụ sản xuất thuộc bounded context Rust trong `server/src/modules/`; Axum/Tower composition root ở `server/src/delivery.rs`, HTTP adapter ở `server/src/http.rs`; transaction và lược đồ ở kernel/schema Rust.
- Catalog module và ngành thuộc `definitions/modules/*.json` và `definitions/verticals/*.json`. Rule catalog chỉ mô tả tích hợp để runtime Rust thực thi.
Runtime TypeScript đã được gỡ. Node.js chỉ còn chạy công cụ phát triển, sao lưu và E2E; nghiệp vụ production chạy trong Rust.
- Dùng transaction PostgreSQL, tenant scope và row/advisory lock cho kiểm tra phụ thuộc dữ liệu có thể bị tranh chấp.
- Dùng `required: true` cho tích hợp mà thất bại phải rollback thao tác nguồn.
- Ngôn ngữ thông báo/tài liệu là tiếng Việt; định danh và mã lỗi là tiếng Anh; entity/trường dùng `snake_case`, module dùng `kebab-case`.

## Kiểm tra phù hợp

| Lệnh | Phạm vi |
|---|---|
| `cargo fmt --manifest-path server/Cargo.toml` | Định dạng Rust |
| `cargo check --manifest-path server/Cargo.toml --no-default-features --all-targets` | Biên dịch server và CLI Rust |
| `npm run lint` | Nhất quán catalog module/ngành |
| `npm run docs` | Sinh catalog, bản đồ tích hợp, ngành và OpenAPI |
| `npm test` | Bộ kiểm thử tương thích hiện có |
| `cargo test --manifest-path server/Cargo.toml --no-default-features` | Test domain và HTTP không cần PostgreSQL |
| `npm run e2e` | Chrome/Edge và axe-core trên cơ sở dữ liệu tạm riêng |
| `npm run test:container` | Image Linux đã build, luồng bán hàng và diễn tập pg_dump, mã hóa backup AES-GCM, pg_restore trong Compose project tạm riêng |

Trước khi chạy `test:container`, build image bằng
`docker build -t osp-suite:rust-web-verification .` hoặc đặt `OSP_VERIFY_IMAGE`
trỏ tới image cần kiểm tra. Công cụ tạo credential, container/network/volume riêng,
không đọc cấu hình dịch vụ production và tự dọn các tài nguyên do chính nó tạo.
Trong PowerShell có execution policy hạn chế, dùng `npm.cmd` thay cho `npm`.

Runtime TypeScript đã được gỡ. Node.js chỉ còn chạy công cụ phát triển, sao lưu và E2E; nghiệp vụ production chạy trong Rust.

## Thêm hoặc đổi nghiệp vụ

1. Tạo/đổi schema và rule trong catalog JSON bằng `npm run new:module` hoặc sửa tệp tương ứng.
2. Cài invariant, kiểm tra tenant, concurrency, tính toán và giao dịch trong bounded context Rust; đăng ký trong `server/src/modules/mod.rs`.
3. Cập nhật changelog và tài liệu sinh tự động bằng `npm run docs`.
4. Chạy các bước biên dịch/lint phù hợp với thay đổi. Không phát hành nếu Rust runtime không thể nạp catalog.

## Giao diện

Client React nằm trong `client/`; API, trạng thái và tiện ích dùng chung nằm ở `client/src/lib/`; token và CSS vẫn dùng chung từ `client/public/app/styles/`. Tuân [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md), hỗ trợ bàn phím và không chèn dữ liệu người dùng bằng HTML thô. Các bounded context Rust mới theo cấu trúc `mod.rs`, `domain.rs`, `application.rs`, `persistence.rs`; khi mở rộng context cũ, chuyển từng luồng theo cấu trúc đó.
