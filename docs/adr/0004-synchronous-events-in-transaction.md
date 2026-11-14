# ADR-0004: Sự kiện xử lý đồng bộ trong cùng giao dịch

- **Trạng thái:** Chấp nhận · 2026-11
- **Bối cảnh:** Luồng xác nhận đơn cần nhất quán giữa hóa đơn, cam kết tồn và xuất kho. Đơn trực tiếp xuất kho ngay; đơn qua Logistics chỉ xuất kho sau khi vận đơn giao thành công.
- **Quyết định:** Sự kiện được phân phối **đồng bộ, trong giao dịch của thao tác gốc**. Mỗi luật chạy trong savepoint riêng; lỗi luật được cô lập và ghi lại, thao tác gốc không bị hủy. Độ sâu chuỗi tối đa 12.
- **Lý do:** Nhất quán mạnh, hoàn tác sạch, test xác định, dễ suy luận. Bản đồ nhân quả (`causationId`) có sẵn để hiển thị.
- **Đánh đổi:** (1) Thao tác gốc chậm hơn theo độ dài chuỗi (≈3 ms cho chuỗi ~10 bước). (2) Một luật lỗi không làm hỏng thao tác gốc → có thể có "thiếu hóa đơn" được ghi nhận bằng `✕` thay vì chặn; người vận hành phải theo dõi nhật ký sự kiện. (3) Handler bằng mã không được làm I/O thật. (4) Không thể gọi hệ thống ngoài (HĐĐT, ngân hàng, Zalo) trực tiếp trong luật.
- **Hướng đi cho tích hợp ngoài:** Luật chỉ ghi một bản ghi "yêu cầu" (ví dụ `einvoice.einvoice` trạng thái `pending`); một **worker outbox** riêng gửi ra ngoài, retry, rồi chuyển trạng thái (`issued`/`failed`). Kernel không đổi. (Chưa làm — xem lộ trình.)
