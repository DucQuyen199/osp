# Khai báo module và bounded context Rust

Catalog module là JSON trong `definitions/modules/<id>.json`; gói ngành là JSON trong `definitions/verticals/<id>.json`. Rust là nơi xử lý trạng thái, bất biến dữ liệu, quyền, transaction và nghiệp vụ chéo module. Rule JSON chỉ mô tả cấu hình tích hợp để rule runtime Rust thực thi.

## Tạo module

```bash
npm run new:module -- warranty "Bảo hành" operations master-data,inventory "Quản lý thời hạn bảo hành, tiếp nhận và xử lý yêu cầu theo sản phẩm."
npm run lint
npm run docs
cargo check --manifest-path server/Cargo.toml --no-default-features
```

Lệnh yêu cầu mô tả phạm vi nghiệp vụ và các tích hợp của module để catalog không sinh placeholder `TODO`.

Lệnh tạo `definitions/modules/warranty.json` và bộ khung Rust trong
`server/src/modules/warranty/` (`mod.rs`, `domain.rs`, `application.rs`,
`persistence.rs`). Các hàm scaffold mặc định trả lỗi triển khai chưa hoàn tất,
không cho phép nghiệp vụ đi qua; thay bằng chính sách Rust thực tế trước khi
đăng ký context. Cấu trúc catalog rút gọn:

```json
{
  "id": "warranty",
  "name": "Bảo hành",
  "description": "Theo dõi bảo hành sản phẩm và xử lý yêu cầu.",
  "category": "operations",
  "version": "0.1.0",
  "depends": ["master-data", "inventory"],
  "entities": [
    {
      "name": "claim",
      "label": "Yêu cầu bảo hành",
      "fields": [
        { "name": "product", "type": "ref", "required": true, "ref": "master-data.product" },
        { "name": "description", "type": "text", "required": true },
        { "name": "status", "type": "enum", "required": false, "options": ["draft", "submitted", "approved", "rejected", "completed"] }
      ],
      "states": {
        "field": "status",
        "initial": "draft",
        "actions": {
          "submitted": { "from": ["draft", "rejected"], "to": "submitted" },
          "approved": { "from": ["submitted"], "to": "approved" },
          "rejected": { "from": ["submitted"], "to": "rejected" },
          "completed": { "from": ["approved"], "to": "completed" }
        }
      },
      "computed": {},
      "constraints": []
    }
  ],
  "rules": [],
  "seeds": []
}
```

The catalog JSON is consumed directly by Rust and used to generate OpenAPI and module documentation. Keep definitions valid against `server/src/defs.rs` and avoid handwritten/generated copies.

## Nghiệp vụ Rust

Add new bounded contexts in `server/src/modules/<context>/` with this layout:

```text
mod.rs           narrow facade registered with the shared kernel
domain.rs        deterministic validation and action policy
application.rs   command preparation and context orchestration
persistence.rs   tenant-scoped cross-record checks and concurrency locks
```

### Hợp đồng trách nhiệm

| Lớp | Được phép làm | Không làm |
|---|---|---|
| `domain.rs` | Quy tắc thuần, kiểm tra dữ liệu, quyền chuyển trạng thái, chính sách sửa/xóa | SQL, HTTP, đọc giờ hệ thống, gọi module khác |
| `application.rs` | Chuẩn hóa lệnh, tính snapshot có nguồn tin cậy, điều phối use case qua transaction kernel | Tự mở connection/commit, tin số tiền hoặc giá do client gửi |
| `persistence.rs` | Truy vấn tenant-scoped, khóa hàng/nguồn, kiểm tra duy nhất và giới hạn cạnh tranh | Quyết định HTTP, ghi qua transaction khác, dựa vào ID client chưa xác minh |
| `mod.rs` | Facade Rust hẹp và chỉ export các điểm kernel cần | Để lớp khác truy cập implementation nội bộ |

Luồng ghi chuẩn: làm sạch DTO → chuẩn hóa/tính snapshot → domain validation →
kiểm tra persistence trong cùng transaction PostgreSQL → kiểm tra quyền/trạng
thái → ghi bản ghi, audit và phát event. Bất kỳ lỗi bắt buộc nào đều phải rollback
cả giao dịch. Khi giới hạn phụ thuộc bản ghi khác có thể bị ghi đồng thời, khóa
bản ghi nguồn trước khi kiểm tra; các lệnh cạnh tranh phải lấy cùng khóa theo cùng
thứ tự. Mọi truy vấn có dữ liệu nghiệp vụ phải lọc `tenant_id`.

Không tạo đủ bốn file chỉ để có hình thức: chỉ giữ lớp có trách nhiệm thực tế.
Khi một luồng cần lớp mới, thêm một nghiệp vụ nhỏ hoàn chỉnh theo hợp đồng này,
đăng ký facade/dispatch trong kernel và mô tả API hoặc catalog tương ứng. Không
đặt logic nghiệp vụ vào handler HTTP, catalog JSON hay React. Catalog chỉ định
nghĩa entity, kiểu trường, trạng thái và tích hợp khai báo; trường do Rust tính
phải đánh dấu `system: true` và chỉ được cập nhật trong use case Rust.

Đặt `systemManaged: true` trên entity chỉ được tạo bởi luồng nghiệp vụ Rust. Kernel từ chối tạo trực tiếp qua API và giao diện ẩn nút tạo/nhập cho entity đó. Dùng thuộc tính này cho sổ cái, số dư tổng hợp và chứng từ snapshot phát sinh tự động.

The scaffold does not register or dispatch the module automatically. Its
default validators fail closed so an unfinished context cannot accept writes.
Add its Rust identifier to `server/src/modules/mod.rs`, connect domain and persistence
checks to the shared dispatchers, and add application preparation or event
handlers only when the context needs them. Remove unused placeholder layers from
small contexts after deciding their actual responsibilities.

Register each facade in `server/src/modules/mod.rs`. Database work must use the transaction passed by the kernel. Lock parent records when validating limits that could race, and keep events, required rules, and writes in one transaction. Existing flat files are compatibility contexts; move them to the directory layout when implementing a meaningful workflow change. See `payments/` and `subscription/` for current examples.

Use catalog rules for simple declarative integrations. Set `required: true` when failure must roll back the originating command. Implement complex calculations, source authenticity, concurrency controls, and financial or stock invariants in Rust. Do not implement production business rules in TypeScript or the web client.

## Gói ngành

Create `definitions/verticals/<id>.json` with `id`, `name`, `description`, `modules`, `terminology`, `customFields`, `roles`, and `kpis`. Vertical packs configure existing contexts; they do not contain business code. Every referenced module/entity must exist in the JSON catalog.

## Kiểm tra catalog

```bash
npm run lint
npm run docs
npm run export:defs
cargo check --manifest-path server/Cargo.toml --no-default-features
```

No TypeScript module source is supported. Catalog definitions are JSON; production business behavior runs in Rust.

Scheduled business jobs are declared by their Rust bounded context through `scheduled_jobs()` and executed by the shared Rust scheduler. Do not add catalog `jobs`; `npm run lint` rejects them so due conditions and state transitions cannot silently remain in JSON.
