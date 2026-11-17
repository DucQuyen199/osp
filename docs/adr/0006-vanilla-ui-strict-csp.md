# ADR-0006: Giao diện thuần JavaScript dưới CSP nghiêm

- **Trạng thái:** Superseded by [ADR-0009](0009-react-vite-frontend.md) for the frontend framework; the strict CSP and semantic HTML remain in force.
- **Quyết định:** SPA bằng ES module + CSS thuần, sinh tự động từ metadata; chạy dưới `script-src 'self'; style-src 'self'`; chỉ chèn dữ liệu bằng `textContent`. Hộp thoại dùng `<dialog>` gốc.
- **Lý do:** Giao diện phải sinh hàng trăm màn hình từ khai báo nên cần một lớp mỏng, hiểu được toàn bộ; không cần framework cho mức tương tác hiện tại; CSP nghiêm loại bỏ cả lớp lỗ hổng XSS; `<dialog>` cho sẵn bẫy focus và phím Esc đúng chuẩn truy cập.
- **Đánh đổi:** Tự quản lý cập nhật DOM (render lại từng vùng) — chấp nhận ở quy mô hiện tại; chưa có kiểm thử đơn vị cho hàm giao diện (có E2E bằng Chrome thật + axe).
- **Khi nào xem lại:** Khi có màn hình tương tác dày (kanban kéo-thả, bảng nhập liệu kiểu bảng tính, biểu đồ động) — cân nhắc web components hoặc một thư viện nhỏ, vẫn giữ CSP.
