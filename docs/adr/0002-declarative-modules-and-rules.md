# ADR-0002: Module và luật tích hợp khai báo

- **Trạng thái:** Chấp nhận · 2026-11
- **Bối cảnh:** 49 module, 151 loại dữ liệu, hàng chục luồng liên module. Viết bằng mã sẽ lặp lại và không phân tích được.
- **Quyết định:** Module là dữ liệu thuần (entity, trường, máy trạng thái, luật). Luật tích hợp có tập thao tác cố định (`create/update/upsert/action`, `forEach`, `inc`, biểu thức nhỏ không dùng `eval`). Mã chỉ là lối thoát (`handlers`).
- **Lý do:** (1) Phân tích tĩnh: `lint` bắt lỗi sai tên trường/sự kiện/thiếu trường bắt buộc/phụ thuộc thiếu trước khi chạy. (2) Từ một khai báo sinh ra API, OpenAPI, giao diện, phân quyền, tài liệu, bản đồ tích hợp. (3) An toàn: không thực thi mã bên thứ ba trong luồng chính. (4) Quy ước "module phản ứng sở hữu luật" giữ module nguồn không phải sửa.
- **Đánh đổi:** Nghiệp vụ phức tạp (tính lương theo bậc thuế, phân bổ chi phí) không diễn đạt được bằng luật; cần `handlers` hoặc mở rộng tập thao tác.
- **Hệ quả:** Cú pháp luật là một hợp đồng công khai; đổi nó là thay đổi lớn.
