# ADR-0003: SQLite trước, PostgreSQL sau

- **Status:** Superseded by ADR-0007; production storage is PostgreSQL.
- **Bối cảnh:** Cần lưu bền vững, giao dịch thật, tối thiểu hạ tầng cho khách nhỏ và cho giai đoạn đầu.
- **Quyết định:** `SqliteBackend` dùng `node:sqlite` (có sẵn trong Node 24). Dữ liệu nghiệp vụ lưu dạng JSON trong bảng `records(tenant_id, qname, id)`; tenant, phiên, nhật ký nằm cùng tệp và cùng giao dịch. Hai giao diện (`Store`, `Persistence`) giữ độc lập với SQLite.
- **Lý do:** Không cần dịch vụ ngoài; sao lưu là chép một tệp (`VACUUM INTO` khi đang chạy); WAL cho đọc đồng thời; giao dịch + savepoint là điều kiện của [ADR-0004](0004-synchronous-events-in-transaction.md). Lược đồ JSON-theo-entity cho phép thêm module/trường mở rộng không cần migration.
- **Đánh đổi:** Cô lập tenant ở tầng ứng dụng (không có RLS); lọc dựa vào `json_extract`/bộ nhớ nên chậm khi một entity có hàng trăm nghìn dòng; không mã hóa at-rest; một tiến trình ghi.
- **Nâng cấp:** `PostgresStore` + `Persistence` tương ứng, bảng theo module hoặc JSONB có chỉ mục, Row-Level Security theo `tenant_id`. Không đổi kernel/module.
- **Khi nào chuyển:** > ~vài chục nghìn dòng/entity, nhiều tiến trình, yêu cầu RLS/mã hóa/HA.
