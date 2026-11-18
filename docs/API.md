# Tham chiếu API

Đặc tả OpenAPI 3.1 sinh tự động từ các module đã cài: `GET /api/openapi.json` (bản đã sinh sẵn: [openapi.json](openapi.json)). Tài liệu này mô tả quy ước chung và các endpoint **quản trị** (xác thực, người dùng, xuất/nhập…) mà OpenAPI không tự suy ra được.

- Địa chỉ gốc: `http://<máy chủ>:3000` (cổng đổi bằng `OSP_PORT`).
- Mọi thân yêu cầu/phản hồi là JSON UTF-8, trừ CSV và HTML.
- Mọi phản hồi có `x-request-id` (gửi kèm khi báo lỗi). Bạn có thể gửi `x-request-id` của riêng mình (≤ 64 ký tự).

## 1. Xác thực

| Cách | Dùng cho | Hạn |
|---|---|---|
| **Phiên** — `POST /api/auth/login` | Người dùng qua giao diện | 12 giờ, thu hồi khi đăng xuất / đổi mật khẩu / khóa tài khoản |
| **API token** — tạo trong Cài đặt hoặc `POST /api/t/:tid/tokens` | Tích hợp máy-máy | Không hết hạn, hoặc `ttlDays` |

Tài khoản có MFA trả `{ "mfaRequired": true, "challengeToken", "expiresAt" }` thay vì phiên sau bước mật khẩu. Gửi `POST /api/auth/mfa/complete` với challenge token và mã TOTP hoặc mã khôi phục để nhận phiên. Challenge có hiệu lực 5 phút, tối đa 5 lượt.

Gửi: `Authorization: Bearer osp_…`. Token chỉ hiện **một lần** khi tạo; máy chủ chỉ lưu băm SHA-256. Token có đúng quyền của người dùng sở hữu nó.

### `POST /api/auth/login`
```json
{ "tenantId": "t_1a2b3c4d", "email": "chu@congty.vn", "password": "…" }
```
→ `200 { "token": "osp_…", "expiresAt": "2026-11-11T…", "user": { "id", "name", "email", "roles", "hasPassword" } }`

| Lỗi | Khi |
|---|---|
| `401 INVALID_CREDENTIALS` | Sai email/mật khẩu, hoặc tài khoản bị khóa (cùng một thông báo để không lộ tài khoản có tồn tại) |
| `429 TOO_MANY_ATTEMPTS` | 5 lần sai / 15 phút / (doanh nghiệp, email) |
| `429 RATE_LIMITED` | Quá 30 lần đăng nhập/phút từ một IP |

### `GET /api/auth/me` · `POST /api/auth/logout`
`me` trả `{ tenantId, user }`. `logout` thu hồi chính token đang dùng.

### OpenID Connect single sign-on

When the operator has configured OIDC, `GET /api/catalog` includes `oidc: true` and the login page offers the provider button. The browser starts with `POST /api/auth/oidc/start` and `{ "tenantId": "t_..." }`; the server responds with `{ "authorizationUrl" }` and sets a short-lived HttpOnly flow cookie. The browser follows the authorization URL to the provider, which must redirect to the configured callback page `/oidc-callback.html`. That page posts the returned `{ "code", "state" }` to `POST /api/auth/oidc/complete`; on success it receives the normal session response, or an MFA challenge when the account requires MFA. Flow state expires after five minutes and the authorization code can be redeemed once. Account linking requires an existing active account with the same verified email; OIDC does not provision accounts or assign roles. See [deployment configuration](DEPLOYMENT.md#optional-single-sign-on-oidc).

### MFA tài khoản

Các endpoint `/api/t/{tenantId}/auth/mfa/*` chỉ tác động tới người dùng của token hiện tại. `GET /status` trả trạng thái và số mã khôi phục còn lại. `POST /setup` nhận mật khẩu hiện tại và trả khóa TOTP tạm cùng URI `otpauth` có hiệu lực 10 phút; `POST /confirm` nhận mã 6 chữ số đang hoạt động, bật MFA và trả 10 mã khôi phục đúng một lần. `POST /disable` cần mật khẩu cùng mã TOTP/mã khôi phục, rồi thu hồi các phiên và API token khác. Mã TOTP bị phát lại bị từ chối.

Tenant admin có thể gọi `POST /api/t/{tenantId}/auth/mfa/users/{userId}/reset` với lý do 10–500 ký tự để đặt lại MFA và thu hồi toàn bộ phiên/token của người dùng. Bí mật TOTP chỉ lưu dạng ciphertext AES-256-GCM; máy chủ cần `OSP_TOTP_ENCRYPTION_KEY` là Base64 của 32 byte ổn định giữa các lần khởi động.

`GET /api/t/{tenantId}/auth/sessions` liệt kê các phiên trình duyệt đang hoạt động của người gọi và đánh dấu phiên hiện tại. `POST /api/t/{tenantId}/auth/sessions/revoke-others` thu hồi mọi phiên trình duyệt khác của chính người gọi; API token không bị ảnh hưởng.

## 2. Công khai (không cần token)

| Endpoint | Mô tả |
|---|---|
| `GET /` · `/app/*` | Giao diện web |
| `GET /api/health` | `{ status, modules, tenants }` |
| `GET /api/catalog` | Module, gói ngành, cờ `demo`/`signup` |
| `GET /api/openapi.json` | Đặc tả OpenAPI |
| `POST /api/tenants` | Tạo doanh nghiệp (tắt bằng `OSP_SIGNUP=0`) |
| `POST /api/demo` | Tạo doanh nghiệp dùng thử có dữ liệu mẫu (chỉ khi `OSP_DEMO=1`) |
| `POST /api/auth/email-verification/complete` | Xác minh email dùng một lần |
| `POST /api/auth/email-verification/request` | Gửi lại liên kết xác minh (phản hồi chung, tối đa 3 thư/giờ/tài khoản) |

### `POST /api/tenants`
```json
{
  "name": "Phòng khám An Tâm",
  "vertical": "healthcare",
  "modules": ["crm"],
  "admin": { "name": "Nguyễn Văn A", "email": "a@antam.vn", "password": "ít-nhất-8-ký-tự" }
}
```
`vertical` và `modules` tùy chọn (gộp lại, tự kéo theo phụ thuộc); signup cần `admin.name`, `admin.email`, `admin.password`. → `201 { tenantId, emailVerificationRequired, modules, warnings }`. Không cấp token đăng nhập trước khi xác minh. Liên kết có hiệu lực 24 giờ; mở liên kết sẽ kích hoạt tài khoản. `OSP_PUBLIC_URL` phải là HTTPS (cho phép localhost HTTP khi phát triển). `warnings` liệt kê module không có trong bản cài. `404 VERTICAL_NOT_FOUND` nếu sai mã ngành. Giới hạn 20 lần tạo/phút/IP.

## 3. Dữ liệu nghiệp vụ

Đường dẫn: `/api/t/{tenantId}/data/{module}/{entity}`. Token phải thuộc tenant, nếu không `403 WRONG_TENANT`.

| Phương thức | Đường dẫn | Quyền cần | Ghi chú |
|---|---|---|---|
| GET | `…/{entity}` | `module.entity.read` | Lọc `?field=value`, `limit` (≤ 1000, mặc định 100), `offset`. → `{ items, total }` (sắp theo thời gian tạo) |
| POST | `…/{entity}` | `module.entity.create` | → `201` bản ghi |
| GET | `…/{entity}/{id}` | `…read` | |
| PATCH | `…/{entity}/{id}` | `…update` | Gửi `null` để xóa giá trị một trường |
| DELETE | `…/{entity}/{id}` | `…delete` | `409 REFERENCED` nếu còn nơi khác tham chiếu |
| POST | `…/{entity}/{id}/{action}` | `module.entity.{action}` | Chuyển trạng thái, phát sự kiện |
| POST | `…/{entity}/bulk/{action}` | `module.entity.{action}` | Chuyển tối đa 100 bản ghi trong một transaction; lô hoàn tác toàn bộ nếu có bản ghi lỗi |

Bulk action nhận `{ "ids": ["<uuid>", "…"] }`. Danh sách phải có 1–100 ID duy nhất. Máy chủ sắp khóa theo ID để tránh deadlock giữa các lô giao nhau, kiểm tra quyền và chạy đầy đủ validation/event của action trên từng bản ghi; response có `{ action, count, items }`.

Khi tạo bản ghi, client có thể gửi `Idempotency-Key` (1–200 ký tự ASCII in được). Khóa được phân theo tenant, người gửi và entity. Gửi lại cùng khóa và cùng JSON trong 30 ngày trả lại phản hồi `201` đã lưu mà không tạo thêm bản ghi hay lặp lại nghiệp vụ. Dùng lại khóa cho JSON khác trả `409 IDEMPOTENCY_KEY_REUSED`. Sau 30 ngày, khóa hết hạn và có thể được tạo lại.

Khi ghi nhận kết quả giao dịch thanh toán hoặc hoàn tiền, có thể gửi `{"reference":"mã nhà cung cấp"}` cùng request `POST .../{id}/{succeeded|failed}`. Mã tham chiếu và chuyển trạng thái sẽ commit hoặc rollback cùng nhau. Bỏ body nếu không cần đổi mã; gửi chuỗi rỗng để xóa mã khi ghi nhận thất bại.

### Truy xuất lô hàng

`GET /api/t/{tenantId}/reports/inventory/lots/{lotId}/traceability` cần `inventory.lot.read` và `inventory.stock_move.read`. Kết quả gồm thông tin và hạn dùng lô, số dư lượng/giá trị theo kho, cùng lịch sử phiếu kho và mã nguồn liên quan. Dữ liệu được giới hạn trong tenant hiện tại; lịch sử phân trang bằng `limit` (mặc định 100, tối đa 500) và `offset` (tối đa 1.000.000).

`GET /api/t/{tenantId}/reports/inventory/lot-expiry?days=90` cần cùng hai quyền. Báo cáo liệt kê tồn dương theo lô/kho cho các lô đã hết hạn hoặc hết hạn trong kỳ, phân trang bằng `limit` và `offset`.

`POST /api/t/{tenantId}/reports/inventory/lot-expiry/writeoff-counts` nhận `{ "warehouseId": "<uuid>" }` và cần thêm `inventory.stock_count.create`. Máy chủ tạo phiếu kiểm kê hủy hàng hết hạn dạng nháp theo lô/vị trí, giữ nguyên tồn đến khi người dùng rà soát, gửi duyệt và phê duyệt; bước duyệt dùng luồng kiểm kê hiện tại để ghi giảm kho và hạch toán hao hụt. Lô vẫn đang bị giữ QC phải được xử lý qua quy trình chất lượng trước.

`GET /api/t/{tenantId}/reports/restaurant/kitchen-board?station=all` cần `restaurant.kitchen_ticket.read`; `station` nhận `all`, `kitchen` hoặc `bar`. Bảng chỉ hiện phiếu thuộc order đang gửi hoặc chờ phục vụ; order hoàn tất/hủy được ẩn. Phiếu chuyển `queued → preparing → ready` qua action dữ liệu chuẩn.

`GET /api/t/{tenantId}/reports/logistics/delivery-board` cần `logistics.shipment.read`. Bảng tenant-scoped hiển thị vận đơn giao thất bại, chờ xuất phát và đang giao theo mức ưu tiên và tuổi vận đơn; có thông tin tài xế, phương tiện, khách nhận và sự kiện tracking mới nhất. Kết quả giới hạn 500 dòng. Xác nhận xuất phát dùng action chuẩn. Xác nhận giao thành công gọi `POST /api/t/{tenantId}/data/logistics/shipment/{id}/delivered` với `{ "received_by": "..." }`, `{ "delivery_evidence": "..." }` hoặc cả hai; máy chủ tự ghi thời điểm giao và lưu bằng chứng cùng action trong một giao dịch. Sự kiện tracking `delivered` cũng hoàn tất vận đơn đang giao, kích hoạt xuất kho và cập nhật tiến độ đơn bán trong cùng luồng nghiệp vụ.

`POST /api/t/{tenantId}/reports/logistics/shipments/{shipmentId}/redeliver` cần `logistics.shipment.read` và `logistics.shipment.create`. Với vận đơn giao thất bại, tạo vận đơn mới ở trạng thái chờ xuất phát, giữ lại các dòng hàng và điểm giao, đồng thời giữ nguyên vận đơn lỗi làm lịch sử. Phân công lại xe/tài xế rồi dùng action xuất phát chuẩn; yêu cầu lặp lại trả về vận đơn nháp tương đương đang mở.

`GET /api/t/{tenantId}/reports/hotel/housekeeping-board` cần `hotel.room.read`. Bảng hiển thị phòng đang dọn, ngày trả gần nhất và ngày nhận phòng tiếp theo; phòng có khách đến trong ngày được xếp trước. Bảng không trả về danh tính khách. Quyền `hotel.room.ready` cho phép đánh dấu phòng sẵn sàng qua action phòng hiện có, và máy chủ chặn chuyển trạng thái nếu còn lượt lưu trú đang nhận phòng.

POS lấy đơn giá và thuế mặc định từ hồ sơ sản phẩm của tenant; giá, thuế dòng và tổng do client gửi không được dùng để ghi nhận bán. Máy chủ tính lại tổng từng dòng và `tax_total` bằng số thập phân; khi hoàn tất, bút toán thanh toán tách doanh thu và thuế phải nộp.

Quy tắc:
- Trường lạ, sai kiểu, thiếu trường bắt buộc, `ref` trỏ tới bản ghi không tồn tại (kể cả của tenant khác) → `422 VALIDATION`, `error.details` là mảng thông điệp theo trường.
- Trường **trạng thái** không ghi trực tiếp (`422`), chỉ đổi qua action. Action từ sai trạng thái → `409 INVALID_STATE`.
- Trường **tính tự động** (ví dụ `total` từ `lines`) được máy chủ tính lại mỗi lần ghi.
- `id`, `createdAt`, `updatedAt` do hệ thống quản lý.
- Mỗi thao tác ghi là **một giao dịch**, bao gồm mọi bước tự động nó kích hoạt. Một luật tích hợp lỗi chỉ hoàn tác phần của chính nó và được ghi vào nhật ký sự kiện; thao tác gốc vẫn thành công.
- Với `accounting.bank_statement_line`, action `matched` yêu cầu đúng một trong `payment` hoặc `journal_entry`; bút toán phải đã ghi sổ và phát sinh ròng trên đúng tài khoản ngân hàng đã gắn với sao kê phải khớp chiều/số tiền cơ sở. Tài khoản ngân hàng có mã bắt đầu bằng `112` (bao gồm tài khoản chi tiết như `1121`); sau khi thêm dòng, không thể đổi tài khoản, tiền tệ hoặc kỳ ngày của sao kê. Một bút toán chỉ được đối soát một lần trong tenant.

### Ví dụ
```bash
curl -X POST $BASE/api/t/$T/data/sales/sales_order \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"party":"<id khách>","lines":[{"product":"<id sp>","qty":2,"price":500000}]}'
# -> { "id": "…", "status": "draft", "total": 1000000, … }

curl -X POST $BASE/api/t/$T/data/sales/sales_order/<id>/confirmed -H "Authorization: Bearer $TOKEN"
# -> kích hoạt: hóa đơn (kế toán), xuất kho, vận đơn, điểm thưởng, thông báo… tùy module đã bật

curl -X POST $BASE/api/t/$T/data/sales/sales_order/bulk/confirmed \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"ids":["<uuid-1>","<uuid-2>"]}'
# -> { "action": "confirmed", "count": 2, "items": [...] }; mọi bản ghi chuyển trạng thái cùng transaction
```

## 4. Thông tin và quan sát

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /api/t/:tid/meta` | đăng nhập | Module đã bật, entity (kèm trường mở rộng), thuật ngữ, vai trò, KPI, danh sách mọi module |
| `GET /api/t/:tid/summary` | đăng nhập | Số bản ghi theo entity (chỉ entity được phép đọc) |
| `GET /api/t/:tid/reports/accounting/trial-balance?from=&to=` | `accounting.journal_entry.read` | Bảng cân đối phát sinh: số dư đầu kỳ, Nợ/Có phát sinh, số dư cuối kỳ. Ngày dùng `YYYY-MM-DD`; có thể bỏ trống một hoặc cả hai. |
| `GET /api/t/:tid/reports/accounting/general-ledger/:accountId?from=&to=` | `accounting.journal_entry.read` | Sổ cái theo tài khoản, số dư lũy kế được mang từ trước kỳ đã lọc. |
| `GET /api/t/:tid/reports/accounting/income-statement?from=&to=` | `accounting.journal_entry.read` | Báo cáo kết quả kinh doanh: doanh thu, chi phí và lãi/lỗ thuần theo ngày hạch toán. |
| `GET /api/t/:tid/reports/accounting/balance-sheet?asOf=` | `accounting.journal_entry.read` | Bảng cân đối kế toán tại ngày chỉ định; có tài sản, nợ phải trả, vốn chủ, lợi nhuận lũy kế và sai lệch cân đối. |
| `GET /api/t/:tid/reports/accounting/cash-flow-forecast?from=&to=` | `accounting.journal_entry.read` | Dự báo dòng tiền từ hóa đơn còn mở, đơn mua đã duyệt chưa ghi bill, bảng lương/đề nghị chi đã duyệt có ngày thanh toán; mặc định 90 ngày, số dư công nợ tính tại ngày bắt đầu. |
| `GET /api/t/:tid/reports/accounting/receivables-aging?asOf=` | `accounting.journal_entry.read` | Tuổi nợ phải thu theo đối tác: chưa đến hạn, đến hạn, 1–30, 31–60, 61–90 và trên 90 ngày; dùng số dư còn phải thu và `due_date`. |
| `GET /api/t/:tid/reports/accounting/payables-aging?asOf=` | `accounting.journal_entry.read` | Tuổi nợ phải trả theo nhà cung cấp với cùng các nhóm ngày; dùng số dư còn phải trả và `due_date`. |
| `GET /api/t/:tid/reports/accounting/chart-templates` | `accounting.account.read` | Danh sách mẫu TT99/2025 và TT133/2016 cùng chuẩn đang chọn; trả số lượng `accountCount`, `detailAccountCount`, `totalAccountCount`. Mẫu gồm tài khoản cấp 1 và mã chi tiết được liệt kê trong phụ lục. |
| `POST /api/t/:tid/reports/accounting/chart-templates/:templateId/apply` | `accounting.account.create` | Chọn `tt99_2025` hoặc `tt133_sme_2016`; bổ sung tài khoản cấp 1 và mã chi tiết còn thiếu, nối mã chi tiết với tài khoản cha, giữ nguyên tài khoản đã có và khóa tenant vào một chuẩn. Phản hồi nêu tài khoản tạo mới, giữ nguyên, hoặc bỏ qua do cha/nhánh cha khác loại hay quan hệ; trả `409` nếu tenant đã chọn chuẩn khác. |
| `POST /api/t/:tid/accounting/bank-statements/:id/import` | `accounting.bank_statement_line.create` | Nhập CSV UTF-8 vào sao kê nháp; hỗ trợ amount/direction hoặc debit/credit, bỏ qua dòng trùng và rollback toàn bộ nếu có dòng lỗi. |
| `POST /api/t/:tid/accounting/bank-statements/:id/import-camt053` | `accounting.bank_statement_line.create` | Nhập tệp ISO 20022 CAMT.053.001.01–.14 UTF-8 (≤5 MB), đúng một sao kê và tối đa 20.000 bút toán đã ghi sổ; kiểm tra tiền tệ, kỳ và tham chiếu trùng trong transaction. |
| `GET /api/t/:tid/reports/asset/depreciation-schedule?months=12` | `asset.asset.read` | Dự báo khấu hao theo từng tháng cho tài sản đang hoạt động; `months` từ 1 đến 36, mặc định 12. Kỳ đã có phiếu nháp được đánh dấu. Chỉ đọc, không tạo phiếu hoặc bút toán. |
| `GET /api/t/:tid/reports/manufacturing/wip?asOf=` | `manufacturing.production_order.read` | Giá trị nguyên liệu đã xuất nhưng chưa nhập thành phẩm QC đạt theo lệnh; ngày chốt áp dụng cho phiếu kho, trạng thái QC là trạng thái hiện tại. |
| `GET /api/t/:tid/reports/inventory/replenishment` | `inventory.reorder_rule.read` | Đề xuất bù tồn theo mức tối thiểu/mục tiêu; tồn khả dụng loại trừ lô hết hạn và hàng giữ QC, mức dự kiến tính thêm PO đang mở, phần đề nghị mua chưa chuyển thành PO và nhu cầu còn phải giao từ đơn bán đã xác nhận. Response có `committedQty` và `projectedQty`. |
| `GET /api/t/:tid/reports/inventory/location-stock?warehouse=` | `inventory.stock_move.read` | Tồn và giá trị theo sản phẩm/vị trí kho, tính từ lịch sử phiếu kho; dòng chưa gán bin hiển thị riêng. |
| `POST /api/t/:tid/reports/inventory/replenishment/purchase-requisitions` | `inventory.reorder_rule.read`, `purchasing.purchase_requisition.create` | Body `{ "warehouseId": "<uuid>" }`; tính lại tồn đề xuất và tạo một đề nghị mua nháp cho các dòng còn thiếu tại kho đó trong cùng transaction. |
| `GET /api/t/:tid/reports/budget/variance?period=` | `budget.budget.read` | So sánh ngân sách đã duyệt với sổ cái; kỳ lọc dùng `YYYY` hoặc `YYYY-MM`. Khi bỏ kỳ, response có `periodSummaries` để giữ tổng năm và tháng tách riêng; các trường tổng ở cấp response là `null`. |
| `GET /api/t/:tid/events?limit=` | đăng nhập | Nhật ký sự kiện (≤ 1000): `type`, `at`, `depth`, `recordId`, `causationId`, `handled[]` (module, `ok`/`skipped`/`error`, `detail`) |
| `GET /api/t/:tid/events/page?limit=&offset=&rootsOnly=` | đăng nhập | Trang dòng sự kiện mới nhất và tổng số theo bộ lọc trong cùng snapshot; `limit` tối đa 100, `rootsOnly` chỉ lấy sự kiện gốc. |
| `GET /api/t/:tid/events/record/:recordId` | đăng nhập | Toàn bộ sự kiện gốc của bản ghi cùng mọi sự kiện dẫn xuất theo `causationId`, chỉ trong tenant hiện tại. |
| `GET /api/t/:tid/audit?limit=` | `tenant.audit` | Nhật ký kiểm toán tương thích cũ: ai, làm gì, trên bản ghi nào; tối đa 1.000 dòng gần nhất. |
| `GET /api/t/:tid/audit/page?limit=&offset=&userId=&action=&target=` | `tenant.audit` | Một trang nhật ký kiểm toán và tổng số sau lọc trong cùng snapshot; lọc chính xác theo người/hành động, tìm chứa theo mã đối tượng; trả danh mục hành động. `limit` tối đa 100. |

## 5. Quản trị (cần `tenant.admin`)

| Endpoint | Mô tả |
|---|---|
| `GET /users` · `POST /users` | Danh sách / tạo người dùng `{name, email?, password?, roles[]}`. Có `password` thì đăng nhập được; không thì tạo kèm API token (`token` trong phản hồi) |
| `PATCH /users/:id` | `{name?, roles?, disabled?, password?}`. Đổi mật khẩu thu hồi mọi phiên; khóa thu hồi mọi token. Luôn phải còn ít nhất một quản trị viên hoạt động (`409 LAST_ADMIN`) |
| `POST /roles` | `{id, name, permissions[]}` — tạo hoặc cập nhật vai trò (không sửa `admin`) |
| `GET /tokens` · `POST /tokens` · `DELETE /tokens/:id` | Quản lý API token. `POST` nhận `{userId?, label?, ttlDays?}` |
| `POST /modules/enable` `{ids[]}` · `POST /modules/disable` `{id}` | Bật (kéo theo phụ thuộc) / tắt module. Tắt không xóa dữ liệu; `409 HAS_DEPENDENTS` nếu module khác còn cần |
| `POST /custom-fields` | `{entity, field}` — thêm trường mở rộng cho riêng tenant. `field` dạng `"ngay_sinh:date"`, `"xep_hang:enum:A\|B"`… |
| `PATCH /settings` | Cập nhật cài đặt tenant. `{ "allowNegativeStock": false }` bật/tắt xuất âm; `{ "inventoryCostMethod": "fifo" }` hoặc `"moving_average"` chọn giá vốn. `{ "enforceBudgetControl": true }` yêu cầu ngân sách đã duyệt và chặn ghi sổ chi phí vượt kế hoạch (cần bật module `budget`). Phương pháp giá vốn khóa sau phiếu kho/tồn đầu kỳ đầu tiên; FIFO yêu cầu chặn tồn âm. |
| `GET /outbox?status=dead` | Xem tối đa 200 webhook/connector delivery theo trạng thái: `pending`, `processing`, `retry`, `delivered`, `dead`, `cancelled`; mỗi dòng có `destinationKind` và `destinationId` |
| `POST /outbox/:id/retry` · `POST /outbox/:id/dismiss` | Retry hoặc chuyển dead-letter sang cancelled |
| `POST /webhooks/:id/test` · `POST /connectors/:id/test` | Gửi một payload thử có ký; trả về mã HTTP nhận được, yêu cầu `tenant.admin` |

Webhook và connector outbox được ghi cùng transaction phát event. Worker gửi HTTPS, không theo redirect, có timeout 15 giây, retry tối đa 8 lần với backoff; delivery không thành công được đưa vào dead-letter để quản trị viên xử lý. Request gửi `X-OSP-Event-Id`, `X-OSP-Event-Type`; nếu endpoint có secret, `X-OSP-Signature` là `sha256=<hex HMAC-SHA256 của raw JSON body>`. HTTP connector được tạo với `config` gồm `adapter=http_event_sink`, HTTPS `url`, danh sách `events`, object `headers` và `secret` tùy chọn; secret/header nhạy cảm không được trả lại qua API. Receiver nên dùng event ID để chống xử lý lặp khi mạng lỗi sau khi phía nhận đã ghi nhận.

(Tiền tố đầy đủ: `/api/t/:tid`.)

### Quyền
Dạng `module.entity.verb` (ví dụ `sales.sales_order.confirmed`) và quyền cấp tenant:

| Quyền | Cho phép |
|---|---|
| `tenant.admin` | Quản lý người dùng, vai trò, module, trường mở rộng, token |
| `tenant.audit` | Xem nhật ký kiểm toán |
| `tenant.export` / `tenant.import` | Xuất / nhập dữ liệu |
| `tenant.delete` | Xóa doanh nghiệp |

Mẫu: `*` mọi quyền · `crm.*` mọi quyền của module · `*.*.read` mọi quyền đọc. Dấu `*` ở cuối khớp phần còn lại, ở giữa khớp đúng một đoạn. Vai trò dựng sẵn: `admin`, `manager`, `viewer`, `sales_rep`, `accountant`, `warehouse_keeper`, `hr_officer`, `support_agent` + vai trò riêng của từng ngành.

## 6. Xuất / nhập dữ liệu

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /export` | `tenant.export` | Toàn bộ dữ liệu + cấu hình, JSON `osp-export/1`. **Không** có mật khẩu/token |
| `GET /export/:module/:entity` | `tenant.export` + đọc | CSV UTF-8 có BOM (mở được bằng Excel). Ô chuỗi bắt đầu bằng `= + - @` được thêm `'` để chặn formula injection |
| `POST /import/:module/:entity` | `tenant.import` + tạo | Thân `text/csv` hoặc JSON `[...]` / `{"rows":[...]}` |
| `DELETE /api/t/:tid` | `tenant.delete` | `{ "confirm": "<đúng tên doanh nghiệp>" }` — xóa vĩnh viễn |

**Nhập** là *tất-cả-hoặc-không*: có lỗi ở bất kỳ dòng nào thì không ghi gì và trả `422 { imported: 0, errors: [{row, message}] }`. Tối đa 5.000 dòng, 5 MB. Mặc định **không kích hoạt** luật tích hợp (đây là di chuyển dữ liệu); thêm `?events=true` để kích hoạt. CSV: dòng đầu là tên trường; bool nhận `true/1/có/yes` và `false/0/không/no`; `json` là chuỗi JSON.

## 7. Mã lỗi

Định dạng: `{ "error": { "code", "message", "details?", "requestId?" } }`.

| HTTP | `code` | Ý nghĩa |
|---|---|---|
| 400 | `BAD_JSON` | Thân không phải đối tượng JSON hợp lệ |
| 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | Thiếu/sai token; sai đăng nhập |
| 403 | `FORBIDDEN` / `WRONG_TENANT` / `SIGNUP_DISABLED` / `DEMO_DISABLED` | Không đủ quyền; token thuộc tenant khác |
| 404 | `NOT_FOUND` / `MODULE_NOT_ENABLED` / `ENTITY_NOT_FOUND` / `VERTICAL_NOT_FOUND` / `UNKNOWN_ACTION` / `CHART_TEMPLATE_NOT_FOUND` | Không có đối tượng; module chưa bật; không có mẫu hệ thống tài khoản được yêu cầu |
| 409 | `INVALID_STATE` / `REFERENCED` / `HAS_DEPENDENTS` / `CORE_MODULE` / `FIELD_EXISTS` / `EMAIL_TAKEN` / `LAST_ADMIN` / `ACCOUNTING_STANDARD_LOCKED` | Xung đột trạng thái/ràng buộc; tenant đã khóa theo chuẩn kế toán khác |
| 413 | `TOO_LARGE` / `TOO_MANY_ROWS` | Thân > 1 MB (5 MB khi nhập) / > 5000 dòng |
| 422 | `VALIDATION` / `WEAK_PASSWORD` / `BAD_EMAIL` / `UNKNOWN_ROLE` / `CONFIRM_MISMATCH` / `INVALID_HORIZON` … | Dữ liệu không hợp lệ; kỳ dự báo nằm ngoài giới hạn |
| 429 | `RATE_LIMITED` / `TOO_MANY_ATTEMPTS` | Giới hạn tốc độ |
| 500 | `INTERNAL` | Lỗi hệ thống (kèm `requestId` để tra log) |
| 508 | `EVENT_LOOP` | Chuỗi sự kiện sâu quá 12 bước (nghi vòng lặp luật) |

Giới hạn tốc độ: `/api` 600 yêu cầu/phút/IP (cấu hình được). Giới hạn này tính theo địa chỉ socket; **nếu đặt sau reverse proxy, cần cấu hình proxy giới hạn thay hoặc bổ sung đọc `X-Forwarded-For` có kiểm soát** (xem [SECURITY.md](SECURITY.md)).
