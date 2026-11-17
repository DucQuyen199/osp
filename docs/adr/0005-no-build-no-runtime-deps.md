# ADR-0005: Không bước build, không phụ thuộc runtime

- **Trạng thái:** Superseded by [ADR-0009](0009-react-vite-frontend.md) for browser UI builds; Rust remains the production business/API runtime and Node is not required at runtime.
- **Quyết định:** Runtime nghiệp vụ chạy bằng Rust. Node.js chỉ chạy script công cụ `.mjs` và E2E; dự án không biên dịch hoặc chạy TypeScript. Mã chạy thật (kernel, server, module) **không có dependency npm**. `puppeteer-core` và `axe-core` chỉ là devDependency dùng cho E2E.
- **Lý do:** Khởi động tức thì, không toolchain build, bề mặt tấn công chuỗi cung ứng gần như bằng 0, dễ audit.
- **Đánh đổi:** Phải tự viết các phần nhỏ (router, CSV, băm mật khẩu bằng `node:crypto`); `node:sqlite` ở Node 24 còn đánh dấu *experimental* (in cảnh báo khi chạy); ràng buộc cú pháp TS.
- **Giảm rủi ro:** `node:sqlite` nằm sau giao diện `Store`; đổi sang driver khác chỉ sửa một tệp. Test bao phủ lớp lưu trữ.
