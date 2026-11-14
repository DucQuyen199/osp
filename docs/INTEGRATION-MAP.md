# Bản đồ tích hợp giữa các module

> Tệp này được sinh tự động bởi `npm run docs`. Đừng sửa tay.

Mỗi mũi tên là một hoặc nhiều **luật tích hợp**: module nguồn phát sự kiện, module đích tự phản ứng. Nếu module đích chưa bật cho tenant, luật tự bỏ qua; bật thêm module thì luồng tự nối vào, không cần cấu hình.

**0 luật** nối **0 module**.

```mermaid
flowchart LR
```

## Chi tiết từng luật

| Sự kiện nguồn | Module phản ứng | Hành động | Ý nghĩa |
|---|---|---|---|

## Module trung tâm (nhận nhiều luồng nhất)

