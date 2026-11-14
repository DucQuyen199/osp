# ADR-0001: Modular monolith thay vì microservice

- **Trạng thái:** Chấp nhận · 2026-11
- **Bối cảnh:** Cần nhiều "phần mềm" (CRM, ERP, kế toán…) bán/triển khai riêng được nhưng nối liền với nhau, với đội nhỏ.
- **Quyết định:** Một tiến trình, nhiều module độc lập về *mã và khai báo* (mỗi module là một package, chạy riêng bằng `--modules=`), chung một kernel, một giao dịch.
- **Lý do:** Giao dịch xuyên module (bán hàng → kho → kế toán) cần nhất quán mạnh; microservice sẽ buộc phải làm saga/bù trừ ngay từ đầu. Vận hành một tiến trình đơn giản hơn nhiều. Ranh giới module vẫn rõ (không import chéo; chỉ nói chuyện qua dữ liệu gốc và sự kiện), nên tách service về sau là khả thi.
- **Đánh đổi:** Thông lượng ghi bị giới hạn bởi một hàng đợi (đo: ~340 chuỗi liên module/giây). Không scale ngang bản ghi.
- **Khi nào xem lại:** Khi cần > vài chục người ghi đồng thời liên tục, hoặc cần triển khai độc lập từng module ở các máy khác nhau.
