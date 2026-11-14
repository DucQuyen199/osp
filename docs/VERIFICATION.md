# Kết quả kiểm tra — 13/11/2026

## Các bước đã đạt

| Kiểm tra | Kết quả |
|---|---|
| `npm.cmd run check` | Rust fmt/check, catalog lint, không có TypeScript, build React đạt |
| `npm.cmd test` | 16 test đạt, gồm domain, HTTP và bộ luồng PostgreSQL thật |
| `npm.cmd run e2e` | Các bước giao diện, bàn phím, di động và axe-core đạt |
| Build image Linux | `osp-suite:rust-web-verification` build được với Rust 1.89 |
| `npm.cmd run test:container` | Compose riêng, luồng bán hàng, backup/restore và restart đạt |

Kiểm tra catalog xác nhận 50 module, 182 entity, 811 sự kiện và 22 gói ngành.
API danh sách của mọi entity đã được gọi với xác thực trên PostgreSQL thật.
Điều này xác nhận hợp đồng danh sách và schema, không thay thế kiểm thử đầy đủ
mọi quy trình của từng ngành.

## Luồng nghiệp vụ đã kiểm tra trực tiếp

- Cô lập tenant/RLS, quyền đọc/ghi, máy trạng thái, audit và thu hồi phiên.
- CRM → đơn bán → hóa đơn → HĐĐT chờ provider → thu tiền.
- Mua hàng → nhận hàng → QC → tồn khả dụng; thiếu tồn rollback cả xác nhận và hóa đơn.
- POS có ca bán/kho, thu tiền, tích điểm, hoàn hàng và đảo điểm.
- Sản xuất theo BOM, khấu trừ nguyên liệu và nhập thành phẩm sau QC.
- Đặt lịch chặn trùng; khám bệnh, hoàn tất hồ sơ và phát thuốc.
- Thu phí định kỳ; retry thất bại có rollback, audit và chỉ một caller xử lý thành công.
- Vốn hóa, khấu hao và thanh lý tài sản; hoàn ứng nhân viên; tính/duyệt/trả lương.
- Bút toán cân bằng, UUID trùng ở bulk action, JSON import sai kiểu, ngày không hợp lệ.
- Ghi đồng thời không mất tồn, xóa tenant và tạo tenant cho cả 22 gói ngành.

## Triển khai và giới hạn xác minh

Image chạy trên Linux với filesystem chỉ đọc và tài khoản PostgreSQL không có
SUPERUSER/BYPASSRLS. Bản dump đã được restore sang database thứ hai; ứng dụng
khởi động lại trên database đó và đọc được phiên, đơn xác nhận và hóa đơn đã tạo.
Container/network/volume kiểm thử đã được dọn; image kiểm tra vẫn có trên máy.
Không thay đổi deployment production hiện có.

Chưa xác minh giao dịch với ngân hàng, nhà cung cấp HĐĐT/email/SMS/vận chuyển thật,
nghiệp vụ chuyên sâu ngoài catalog, chứng nhận pháp lý hay tải/HA production.
Những phần này vẫn cần đặc tả, cấu hình/tài khoản nhà cung cấp và môi trường tương
ứng; không xem báo cáo này là tuyên bố sản phẩm đã hoàn thiện thương mại.
