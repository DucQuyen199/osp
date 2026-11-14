# Tài liệu OSP Suite

Chọn theo việc bạn cần làm.

| Tôi muốn… | Đọc |
|---|---|
| Hiểu hệ thống là gì và chạy thử | [../README.md](../README.md) |
| Hiểu các module nối với nhau thế nào, vì sao thiết kế vậy | [ARCHITECTURE.md](ARCHITECTURE.md) → [adr/](adr) |
| Kiến trúc Rust theo bounded context và lộ trình port | [RUST-MODULAR-ARCHITECTURE.md](RUST-MODULAR-ARCHITECTURE.md) · [ADR-0007](adr/0007-rust-bounded-contexts.md) |
| Viết module mới / thêm ngành mới | [MODULE-AUTHORING.md](MODULE-AUTHORING.md) |
| Làm giao diện nhất quán, đạt chuẩn truy cập | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) |
| Tích hợp qua API | [API.md](API.md) · [openapi.json](openapi.json) |
| Triển khai, sao lưu, vận hành | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Đánh giá bảo mật, tuân thủ | [SECURITY.md](SECURITY.md) |
| Biết còn thiếu gì, làm gì trước | [ROADMAP.md](ROADMAP.md) |
| Xem các bước kiểm thử và giới hạn đã xác minh | [VERIFICATION.md](VERIFICATION.md) |
| Đóng góp mã | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Xem lịch sử thay đổi | [../CHANGELOG.md](../CHANGELOG.md) |

## Tài liệu sinh tự động (luôn khớp mã nguồn)

| Tệp | Nội dung |
|---|---|
| [MODULE-CATALOG.md](MODULE-CATALOG.md) | 49 module: dữ liệu, máy trạng thái, luật phản ứng |
| [INTEGRATION-MAP.md](INTEGRATION-MAP.md) | Sơ đồ và bảng các luật tích hợp giữa module |
| [VERTICALS.md](VERTICALS.md) | 22 gói ngành: module, thuật ngữ, trường mở rộng, vai trò, KPI |
| [openapi.json](openapi.json) | Đặc tả OpenAPI 3.1 |

Tạo lại bằng `npm run docs`. **Đừng sửa tay.**

## Quy ước tài liệu
- Viết cho người sẽ *làm theo*: lệnh chạy được, ví dụ thật, số liệu có nguồn (đo hoặc kiểm bằng test).
- Phần "giới hạn" luôn được nêu rõ. Tài liệu nói thẳng điều chưa làm hơn là để người đọc tự phát hiện.
- Mỗi tài liệu viết tay có thể truy ngược tới mã/test chứng minh nó đúng.
