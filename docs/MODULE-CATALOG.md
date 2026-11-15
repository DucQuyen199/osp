# Danh mục module

> Tệp này được sinh tự động bởi `npm run docs`. Đừng sửa tay.

Tổng: **50 module**, **199 loại dữ liệu**, **898 sự kiện**.

| Module | Nhóm | Phụ thuộc cứng |
|---|---|---|
| [`master-data`](#master-data) — Dữ liệu gốc | Lõi | — |
| [`hrm`](#hrm) — Nhân sự | Nhân sự | `master-data` |
| [`accounting`](#accounting) — Kế toán | Tài chính | `master-data`, `hrm` |
| [`inventory`](#inventory) — Kho | Chuỗi cung ứng | `master-data` |
| [`agriculture`](#agriculture) — Nông nghiệp | Module chuyên ngành | `master-data`, `inventory` |
| [`asset`](#asset) — Tài sản cố định | Tài chính | `master-data`, `accounting` |
| [`auto-service`](#auto-service) — Garage / Dịch vụ ô tô-xe máy | Module chuyên ngành | `master-data`, `inventory`, `accounting` |
| [`communication`](#communication) — Truyền thông & thông báo | Nền tảng dùng chung | `master-data` |
| [`bi`](#bi) — Báo cáo & phân tích | Nền tảng dùng chung | `communication` |
| [`booking`](#booking) — Đặt lịch & tài nguyên | Bán hàng & khách hàng | `master-data`, `accounting` |
| [`budget`](#budget) — Ngân sách | Tài chính | `accounting`, `hrm` |
| [`case-management`](#case-management) — Quản lý hồ sơ vụ việc | Module chuyên ngành | `master-data`, `accounting` |
| [`charity`](#charity) — Từ thiện / Phi lợi nhuận | Module chuyên ngành | `master-data`, `accounting` |
| [`clinic`](#clinic) — Phòng khám / Y tế | Module chuyên ngành | `master-data`, `inventory`, `accounting`, `booking` |
| [`project`](#project) — Quản lý dự án | Vận hành | `master-data`, `hrm` |
| [`construction`](#construction) — Xây dựng | Module chuyên ngành | `project`, `accounting` |
| [`contract`](#contract) — Hợp đồng | Vận hành | `master-data` |
| [`sales`](#sales) — Bán hàng | Bán hàng & khách hàng | `master-data`, `inventory`, `accounting` |
| [`crm`](#crm) — CRM - Quan hệ khách hàng | Bán hàng & khách hàng | `master-data`, `sales` |
| [`document`](#document) — Quản lý tài liệu | Nền tảng dùng chung | — |
| [`ecommerce`](#ecommerce) — Thương mại điện tử | Bán hàng & khách hàng | `master-data`, `inventory`, `sales` |
| [`einvoice`](#einvoice) — Hóa đơn điện tử | Tài chính | `accounting` |
| [`events`](#events) — Sự kiện & bán vé | Module chuyên ngành | `master-data`, `accounting` |
| [`expense`](#expense) — Chi phí nhân viên | Tài chính | `hrm`, `accounting` |
| [`helpdesk`](#helpdesk) — Chăm sóc khách hàng | Bán hàng & khách hàng | `master-data`, `hrm` |
| [`field-service`](#field-service) — Dịch vụ hiện trường | Bán hàng & khách hàng | `master-data`, `inventory`, `accounting`, `helpdesk`, `hrm` |
| [`hotel`](#hotel) — Khách sạn / Lưu trú | Module chuyên ngành | `master-data`, `accounting` |
| [`insurance`](#insurance) — Bảo hiểm | Module chuyên ngành | `master-data`, `accounting` |
| [`integration-hub`](#integration-hub) — Cổng tích hợp | Nền tảng dùng chung | — |
| [`lending`](#lending) — Cho vay / Tài chính vi mô | Module chuyên ngành | `master-data`, `accounting` |
| [`lms`](#lms) — Đào tạo (LMS) | Nhân sự | `master-data` |
| [`logistics`](#logistics) — Vận tải & giao hàng | Chuỗi cung ứng | `master-data`, `inventory` |
| [`loyalty`](#loyalty) — Khách hàng thân thiết | Bán hàng & khách hàng | `master-data` |
| [`maintenance`](#maintenance) — Bảo trì | Chuỗi cung ứng | `asset`, `inventory` |
| [`quality`](#quality) — Quản lý chất lượng | Chuỗi cung ứng | `master-data`, `inventory` |
| [`workflow-approval`](#workflow-approval) — Phê duyệt | Nền tảng dùng chung | — |
| [`manufacturing`](#manufacturing) — Sản xuất | Chuỗi cung ứng | `master-data`, `inventory`, `quality`, `accounting`, `workflow-approval` |
| [`marketing`](#marketing) — Marketing | Bán hàng & khách hàng | `master-data`, `crm`, `accounting` |
| [`payments`](#payments) — Cổng thanh toán | Tài chính | `master-data`, `accounting` |
| [`payroll`](#payroll) — Tính lương | Nhân sự | `hrm`, `accounting` |
| [`performance`](#performance) — Đánh giá hiệu suất (OKR) | Nhân sự | `hrm` |
| [`pos`](#pos) — POS - Bán lẻ tại quầy | Bán hàng & khách hàng | `master-data`, `inventory`, `accounting` |
| [`pharmacy`](#pharmacy) — Nhà thuốc | Module chuyên ngành | `master-data`, `inventory`, `pos` |
| [`purchasing`](#purchasing) — Mua hàng | Chuỗi cung ứng | `master-data`, `inventory`, `quality`, `accounting`, `hrm` |
| [`real-estate`](#real-estate) — Bất động sản | Module chuyên ngành | `master-data`, `accounting`, `contract` |
| [`recruitment`](#recruitment) — Tuyển dụng | Nhân sự | `hrm` |
| [`restaurant`](#restaurant) — Nhà hàng / F&B | Module chuyên ngành | `master-data`, `inventory`, `accounting` |
| [`school`](#school) — Trường học / Trung tâm đào tạo | Module chuyên ngành | `master-data`, `accounting`, `hrm` |
| [`subscription`](#subscription) — Gói thuê bao & thu phí định kỳ | Bán hàng & khách hàng | `master-data`, `accounting` |
| [`utilities`](#utilities) — Điện nước / Viễn thông | Module chuyên ngành | `master-data`, `accounting` |

## Lõi

### master-data
**Dữ liệu gốc** — Danh mục dùng chung cho mọi module: đối tác (khách hàng/nhà cung cấp), sản phẩm, chi nhánh, đơn vị tính, tiền tệ, thuế.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `party` Đối tác | — |
| `contact` Người liên hệ | — |
| `product` Sản phẩm/Dịch vụ | — |
| `product_category` Nhóm sản phẩm | — |
| `uom` Đơn vị tính | — |
| `branch` Chi nhánh/Cửa hàng | — |
| `currency` Tiền tệ | — |
| `currency_rate` Tá»· giÃ¡ tiá»n tá»‡ | — |
| `tax` Thuế | — |

## Bán hàng & khách hàng

### booking
**Đặt lịch & tài nguyên** — Đặt lịch hẹn cho phòng, nhân viên, thiết bị, bàn, sân. Dùng cho phòng khám, spa, gym, salon, dịch vụ...

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `resource` Tài nguyên | — |
| `service` Dịch vụ | — |
| `booking` Lịch hẹn | `requested` → **cancelled** (requested/confirmed→cancelled), **checked_in** (confirmed→checked_in), **completed** (checked_in→completed), **confirmed** (requested→confirmed), **no_show** (confirmed→no_show) |

### sales
**Bán hàng** — Báo giá, đơn bán, bảng giá và trả hàng. Đơn có vận đơn chỉ xuất kho khi giao thành công; đơn bán trực tiếp xuất kho khi xác nhận.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `quotation` Báo giá | `draft` → **accepted** (sent→accepted), **expired** (sent→expired), **rejected** (sent→rejected), **sent** (draft/rejected→sent) |
| `sales_order` Đơn bán hàng | `draft` → **cancelled** (draft/confirmed→cancelled), **confirmed** (draft→confirmed), **delivered** (confirmed/partially_delivered→delivered), **partially_delivered** (confirmed→partially_delivered) |
| `sales_return` Phiếu trả hàng bán | `draft` → **approved** (submitted→approved), **cancelled** (draft/rejected→cancelled), **received** (approved→received), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `price_list` Bảng giá | — |

### crm
**CRM - Quan hệ khách hàng** — Quản lý lead, cơ hội bán hàng, hoạt động chăm sóc. Thắng cơ hội sẽ tự sinh đơn hàng; chuyển đổi lead sẽ tự tạo khách hàng.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `lead` Lead | `new` → **contacted** (new→contacted), **converted** (qualified→converted), **disqualified** (new/contacted/qualified→disqualified), **qualified** (new/contacted→qualified) |
| `deal` Cơ hội | `open` → **lost** (open→lost), **won** (open→won) |
| `pipeline_stage` Giai đoạn và xác suất pipeline | — |
| `activity` Hoạt động | — |

### ecommerce
**Thương mại điện tử** — Cửa hàng trực tuyến và đơn web/app/sàn. Đặt hàng sẽ tự tạo đơn bán, hóa đơn, xuất kho và vận đơn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `storefront` Gian hàng | — |
| `web_order` Đơn online | `cart` → **cancelled** (cart/placed→cancelled), **placed** (cart→placed) |

### helpdesk
**Chăm sóc khách hàng** — Ticket hỗ trợ, chính sách SLA, cơ sở tri thức.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `ticket` Ticket | `open` → **closed** (resolved→closed), **reopened** (resolved/closed→open), **resolved** (open/in_progress→resolved), **responded** (open→in_progress) |
| `sla_policy` Chính sách SLA | — |
| `message` Trao đổi ticket | — |
| `kb_article` Bài viết tri thức | — |

### field-service
**Dịch vụ hiện trường** — Lệnh công việc, điều phối kỹ thuật viên, vật tư sử dụng. Hoàn tất sẽ tự trừ kho và lập hóa đơn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `work_order` Lệnh công việc | `open` → **cancelled** (open/dispatched→cancelled), **dispatched** (open→dispatched), **done** (dispatched→done) |

### loyalty
**Khách hàng thân thiết** — Thành viên, điểm thưởng, voucher. Tự cộng điểm khi mua hàng ở POS hoặc đơn bán xác nhận.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `member` Thành viên | — |
| `point_txn` Giao dịch điểm | — |
| `voucher` Voucher | — |

### marketing
**Marketing** — Chiến dịch, phân khúc khách hàng, nội dung. Nền để gắn nguồn lead và đo hiệu quả theo chiến dịch.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `campaign` Chiến dịch | `planned` → **completed** (launched→completed), **launched** (planned→launched) |
| `segment` Phân khúc | — |
| `content_asset` Nội dung | — |
| `campaign_member` Lead thuộc chiến dịch | — |
| `campaign_cost` Chi phí chiến dịch | — |

### pos
**POS - Bán lẻ tại quầy** — Ca bán hàng và đơn bán tại quầy. Hoàn tất đơn sẽ trừ kho, ghi nhận thanh toán và tích điểm khách hàng thân thiết.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `pos_session` Ca bán hàng | `open` → **closed** (open→closed) |
| `pos_order` Đơn POS | `open` → **completed** (open→completed), **refunded** (completed→refunded) |
| `cash_movement` Phiếu thu chi quỹ tiền mặt | `draft` → **posted** (draft→posted) |

### subscription
**Gói thuê bao & thu phí định kỳ** — Gói dịch vụ, thuê bao, chu kỳ thanh toán. Đến hạn thu phí sẽ tự lập hóa đơn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `plan` Gói dịch vụ | — |
| `subscription` Thuê bao | `active` → **cancelled** (active/paused→cancelled), **paused** (active→paused), **resumed** (paused→active) |
| `billing_cycle` Kỳ thanh toán | `pending` → **cancelled** (pending→cancelled), **due** (pending→due), **paid** (due→paid), **reinstated** (cancelled→pending) |

## Chuỗi cung ứng

### inventory
**Kho** — Kho đa địa điểm, phiếu nhập/xuất, tồn theo kho, lô/hạn dùng, kiểm kê và điều chuyển. Ghi nhận biến động đồng bộ với các module nghiệp vụ.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `warehouse` Kho | — |
| `warehouse_location` Vị trí kho | — |
| `stock_move` Phiếu kho | — |
| `valuation_adjustment` Điều chỉnh giá trị lớp tồn kho | — |
| `reorder_rule` Định mức bổ sung tồn kho | — |
| `stock_level` Tồn kho | — |
| `lot` Lô hàng | — |
| `stock_count` Kiểm kê | `draft` → **approved** (submitted→approved), **cancelled** (draft/submitted/rejected→cancelled), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `stock_transfer` Điều chuyển kho | `draft` → **cancelled** (draft→cancelled), **dispatched** (draft→dispatched), **received** (dispatched→received) |

### logistics
**Vận tải & giao hàng** — Phương tiện, tài xế, tuyến, vận đơn. Đơn hàng có địa chỉ giao sẽ tự sinh vận đơn; giao xong cập nhật ngược đơn hàng.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `vehicle` Phương tiện | — |
| `driver` Tài xế | — |
| `route` Tuyến | — |
| `shipment` Vận đơn | `created` → **delivered** (dispatched→delivered), **dispatched** (created→dispatched), **failed** (dispatched→failed) |
| `tracking_event` Sự kiện theo dõi vận chuyển | — |

### maintenance
**Bảo trì** — Kế hoạch bảo trì định kỳ và yêu cầu sửa chữa cho tài sản/thiết bị.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `maintenance_request` Yêu cầu bảo trì | `open` → **cancelled** (open/in_progress→cancelled), **done** (in_progress→done), **started** (open→in_progress) |
| `maintenance_plan` Kế hoạch bảo trì | `active` → **due** (active→active), **paused** (active→paused), **resumed** (paused→active) |
| `maintenance_technician` Kỹ thuật viên bảo trì | — |

### quality
**Quản lý chất lượng** — Kiểm tra chất lượng đầu vào/thành phẩm, giữ lịch sử kết quả và xử lý phần lượng lỗi được sửa theo từng lần kiểm tra lại.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `inspection` Phiếu kiểm tra | `pending` → **failed** (pending→failed), **passed** (pending→passed), **retest** (failed→pending) |
| `inspection_disposition` Giải phóng một phần hàng QC | `draft` → **cancelled** (draft→cancelled), **posted** (draft→posted) |
| `nonconformance` Sự không phù hợp | `open` → **closed** (open→closed) |

### manufacturing
**Sản xuất** — Định mức BOM, lệnh sản xuất theo trung tâm máy và công suất ngày. Bắt đầu lệnh xuất nguyên liệu vào WIP; QC đạt sẽ nhập thành phẩm vào kho. Hỗ trợ sửa, loại bỏ hoặc đề nghị chấp nhận có điều kiện một phần lượng lỗi; hàng concession chỉ nhập kho sau phê duyệt độc lập.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `bom` Định mức (BOM) | — |
| `production_order` Lệnh sản xuất | `planned` → **cancelled** (planned/in_progress→cancelled), **done** (in_progress→done), **started** (planned→in_progress) |
| `rework_order` Lệnh sửa hàng lỗi | `planned` → **cancelled** (planned→cancelled), **done** (in_progress→done), **started** (planned→in_progress) |
| `production_disposition` Xử lý hàng thành phẩm QC lỗi | `draft` → **cancelled** (draft→cancelled), **posted** (draft→posted) |
| `conditional_acceptance` Chấp nhận có điều kiện thành phẩm | `draft` → **approved** (submitted→approved), **cancelled** (draft/rejected→cancelled), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `work_center` Trung tâm sản xuất | — |

### purchasing
**Mua hàng** — Đề nghị mua, báo giá, đơn mua, phiếu nhận và hóa đơn nhà cung cấp; phiếu trả gửi kho và điều chỉnh bill gốc.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `rfq` Yêu cầu báo giá | `draft` → **accepted** (quoted→accepted), **cancelled** (draft/sent→cancelled), **quoted** (sent→quoted), **rejected** (sent/quoted→rejected), **sent** (draft→sent) |
| `purchase_order` Đơn mua hàng | `draft` → **approved** (submitted→approved), **cancelled** (draft/submitted/approved/rejected→cancelled), **partially_received** (approved→partially_received), **received** (approved/partially_received→received), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `purchase_receipt` Phiếu nhận hàng mua | `draft` → **cancelled** (draft→cancelled), **received** (draft→received) |
| `supplier_invoice` Hóa đơn nhà cung cấp | `draft` → **approved** (draft/submitted→approved), **disputed** (submitted→disputed), **rejected** (submitted→rejected), **submitted** (draft/disputed/rejected→submitted) |
| `purchase_requisition` Đề nghị mua | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **sourced** (approved→sourced), **submitted** (draft/rejected→submitted) |
| `purchase_return` Phiếu trả hàng mua | `draft` → **approved** (submitted→approved), **cancelled** (draft/rejected→cancelled), **dispatched** (approved→dispatched), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |

## Tài chính

### accounting
**Kế toán** — Hệ thống tài khoản, hóa đơn, chứng từ điều chỉnh giảm, thanh toán và bút toán cân bằng cho nghiệp vụ liên module.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `account` Tài khoản kế toán | — |
| `period` Kỳ kế toán | `open` → **closed** (open→period_closed), **reopened** (period_closed→open) |
| `invoice` Hóa đơn bán | `draft` → **paid** (posted/partially_paid/partially_settled/settled→paid), **partially_paid** (posted/paid/partially_paid/partially_settled/settled→partially_paid), **partially_settled** (posted/paid/partially_paid/partially_settled/settled→partially_settled), **posted** (draft→posted), **reopened** (paid/partially_paid/partially_settled/settled→posted), **settled** (posted/partially_paid/partially_settled/paid→settled), **void** (draft/posted/partially_paid/partially_settled→void) |
| `bill` Hóa đơn mua | `draft` → **paid** (posted/partially_paid/partially_settled/settled→paid), **partially_paid** (posted/paid/partially_paid/partially_settled/settled→partially_paid), **partially_settled** (posted/paid/partially_paid/partially_settled/settled→partially_settled), **posted** (draft→posted), **reopened** (paid/partially_paid/partially_settled/settled→posted), **settled** (posted/partially_paid/partially_settled/paid→settled), **void** (draft/posted/partially_paid/partially_settled→void) |
| `credit_note` Hóa đơn điều chỉnh giảm | `draft` → **posted** (draft→posted) |
| `debit_note` Điều chỉnh giảm công nợ phải trả | `draft` → **posted** (draft→posted) |
| `payment` Thanh toán | — |
| `settlement_batch` Phiếu thu/chi phân bổ công nợ | `draft` → **approved** (submitted→approved), **cancelled** (draft/rejected→cancelled), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `journal_entry` Bút toán | `draft` → **posted** (draft→posted), **reversed** (posted→reversed) |
| `bank_statement` Sao kê ngân hàng | `draft` → **cancelled** (draft→cancelled), **reconciled** (draft→reconciled) |
| `bank_statement_line` Dòng sao kê ngân hàng | `unmatched` → **ignored** (unmatched→ignored), **matched** (unmatched→matched) |

### asset
**Tài sản cố định** — Đăng ký, vốn hóa, tính khấu hao đường thẳng và thanh lý tài sản cố định.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `asset` Tài sản cố định | `draft` → **activated** (draft→active), **disposed** (active→disposed), **opening_balance_recorded** (active→active) |
| `depreciation` Khấu hao tài sản | `draft` → **posted** (draft→posted) |

### budget
**Ngân sách** — Lập ngân sách theo kỳ/phòng ban và theo dõi thực hiện.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `budget` Ngân sách | `draft` → **approved** (draft→approved), **closed** (approved→closed), **superseded** (approved/closed→superseded) |
| `budget_line` Dòng ngân sách | — |

### einvoice
**Hóa đơn điện tử** — Tạo yêu cầu phát hành khi hóa đơn kế toán ghi sổ; worker Rust phát hành hoặc hủy qua provider HTTPS đã cấu hình và lưu kết quả trong PostgreSQL.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `einvoice` Hóa đơn điện tử | `pending` → **cancel_requested** (issued→cancellation_pending), **cancelled** (cancellation_pending→cancelled), **failed** (pending/cancellation_pending→failed), **issued** (pending→issued), **retry** (failed→pending) |

### expense
**Chi phí nhân viên** — Đề nghị thanh toán/hoàn ứng chi phí, duyệt chi.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `expense_claim` Đề nghị chi phí | `draft` → **approved** (submitted→approved), **paid** (approved→paid), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |

### payments
**Cổng thanh toán** — Giao dịch qua VNPay, MoMo, ZaloPay, Stripe, chuyển khoản. Thành công sẽ tự ghi nhận vào kế toán.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `payment_txn` Giao dịch thanh toán | `pending` → **failed** (pending→failed), **partially_refunded** (succeeded→partially_refunded), **refunded** (succeeded/partially_refunded→refunded), **succeeded** (pending→succeeded) |
| `payment_refund` Hoàn tiền giao dịch | `pending` → **failed** (pending→failed), **succeeded** (pending→succeeded) |

## Nhân sự

### hrm
**Nhân sự** — Hồ sơ nhân viên, phòng ban, chức danh, nghỉ phép, chấm công.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `department` Phòng ban | — |
| `position` Chức danh | — |
| `employee` Nhân viên | `active` → **terminated** (active→terminated) |
| `salary_revision` Điều chỉnh lương | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `leave_request` Đơn nghỉ phép | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `leave_allocation` Hạn mức nghỉ | — |
| `holiday` Ngày lễ doanh nghiệp | — |
| `attendance` Chấm công | — |
| `work_schedule_entry` Lịch ca theo ngày | — |
| `work_schedule_template` Thư viện mẫu ca | — |
| `work_schedule_pattern` Mẫu ca luân phiên | `draft` → **applied** (draft→applied) |

### lms
**Đào tạo (LMS)** — Khóa học, bài học, ghi danh và tiến độ học.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `course` Khóa học | `draft` → **archived** (published→archived), **published** (draft→published) |
| `lesson` Bài học | — |
| `enrollment` Ghi danh | `active` → **completed** (active→completed) |
| `lesson_progress` Hoàn thành bài học | — |
| `certificate` Chứng chỉ hoàn thành | — |

### payroll
**Tính lương** — Bảng lương, phiếu lương. Phiếu lương được khóa theo bảng nháp; gửi bảng lương tạo yêu cầu duyệt, duyệt ghi bút toán và đánh dấu đã trả tạo payment.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `payroll_run` Bảng lương | `draft` → **approved** (submitted→approved), **calculated** (draft→draft), **cancelled** (draft/rejected→cancelled), **paid** (approved→paid), **rejected** (submitted→rejected), **submitted** (draft→submitted) |
| `tax_policy` Chính sách thuế lương | `draft` → **approved** (draft→approved) |
| `contribution_policy` Chính sách đóng góp payroll | `draft` → **approved** (draft→approved) |
| `tax_deduction` Hồ sơ giảm trừ thuế theo năm | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `payroll_adjustment` Khoản cộng/trừ lương | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `overtime_entry` Giờ làm thêm | `draft` → **approved** (submitted→approved), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `contribution_remittance` Thanh toán khoản đóng payroll | `draft` → **approved** (submitted→approved), **cancelled** (draft/rejected/approved→cancelled), **paid** (approved→paid), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |
| `payslip` Phiếu lương | — |

### performance
**Đánh giá hiệu suất (OKR)** — Mục tiêu, kết quả then chốt, đánh giá định kỳ.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `objective` Mục tiêu | — |
| `key_result` Kết quả then chốt | — |
| `review` Đánh giá | `draft` → **acknowledged** (submitted→acknowledged), **returned** (submitted→returned), **submitted** (draft/returned→submitted) |

### recruitment
**Tuyển dụng** — Tin tuyển dụng, ứng viên, hồ sơ ứng tuyển. Trúng tuyển tự tạo hồ sơ nhân viên.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `job_opening` Vị trí tuyển | `open` → **closed** (open→closed) |
| `candidate` Ứng viên | — |
| `application` Hồ sơ ứng tuyển | `draft` → **applied** (draft/rejected→applied), **hired** (applied→hired), **rejected** (applied→rejected) |

## Vận hành

### project
**Quản lý dự án** — Dự án, công việc, chấm giờ.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `project` Dự án | `planned` → **cancelled** (planned/active→cancelled), **completed** (active→done), **started** (planned→active) |
| `task` Công việc | `todo` → **done** (doing→done), **started** (todo→doing) |
| `timesheet` Chấm giờ | — |
| `task_dependency` Phụ thuộc công việc | — |

### contract
**Hợp đồng** — Hợp đồng, điều khoản, phụ lục có phê duyệt và vòng đời hiệu lực/hết hạn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `contract` Hợp đồng | `draft` → **activated** (draft→active), **amended** (active→active), **cancelled** (draft→terminated), **expired** (active→expired), **terminated** (active→terminated) |
| `clause` Điều khoản | — |
| `amendment` Phụ lục hợp đồng | `draft` → **applied** (approved→applied), **approved** (submitted→approved), **cancelled** (draft/rejected/submitted/approved→cancelled), **rejected** (submitted→rejected), **submitted** (draft/rejected→submitted) |

## Nền tảng dùng chung

### communication
**Truyền thông & thông báo** — Kênh (email/SMS/Zalo/push/webhook), mẫu tin, nhật ký gửi. Tự ghi thông báo cho các sự kiện chính.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `channel` Kênh | — |
| `template` Mẫu tin | — |
| `reminder` Nhắc việc | `pending` → **cancelled** (pending→cancelled), **queued** (pending→queued) |
| `message_log` Nhật ký gửi | — |

### bi
**Báo cáo & phân tích** — Dashboard, báo cáo, KPI. Khung để đọc dữ liệu chéo mọi module.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `dashboard` Dashboard | — |
| `report` Báo cáo | `paused` → **paused** (scheduled→paused), **run_due** (scheduled→scheduled), **scheduled** (paused→scheduled) |
| `report_run` Lần chạy báo cáo | — |
| `kpi` Chỉ tiêu KPI | — |

### document
**Quản lý tài liệu** — Thư mục, tài liệu có phiên bản, yêu cầu ký.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `folder` Thư mục | — |
| `document` Tài liệu | — |
| `signature_request` Yêu cầu ký | `pending` → **declined** (pending→declined), **signed** (pending→signed) |

### integration-hub
**Cổng tích hợp** — Kết nối bên ngoài: connector (ngân hàng, vận chuyển, HĐĐT, Zalo...), webhook, API key.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `connector` Connector | — |
| `webhook` Webhook | — |
| `api_key` API key | — |

### workflow-approval
**Phê duyệt** — Luồng duyệt dùng chung. Đơn mua, đề nghị chi phí... tự sinh yêu cầu duyệt khi module này được bật; duyệt xong tự chuyển trạng thái chứng từ gốc.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `approval_request` Yêu cầu duyệt | `pending` → **approved** (pending→approved), **cancelled** (pending→cancelled), **rejected** (pending→rejected) |
| `approval_rule` Quy tắc duyệt | — |

## Module chuyên ngành

### agriculture
**Nông nghiệp** — Trang trại, vụ mùa, vật tư canh tác, thu hoạch, truy xuất. Thu hoạch tự nhập kho nông sản.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `farm` Trang trại | — |
| `crop_cycle` Vụ mùa | `growing` → **failed** (growing→failed), **harvested** (growing→harvested) |
| `harvest` Thu hoạch | — |
| `input_application` Vật tư canh tác | — |

### auto-service
**Garage / Dịch vụ ô tô-xe máy** — Hồ sơ xe, lệnh sửa chữa kèm phụ tùng. Hoàn tất sửa chữa tự trừ kho phụ tùng và lập hóa đơn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `vehicle` Xe | — |
| `repair_order` Lệnh sửa chữa | `intake` → **approved** (intake→approved), **completed** (in_progress→completed), **delivered** (completed→delivered), **quote_declined** (intake→quote_declined), **started** (approved→in_progress) |

### case-management
**Quản lý hồ sơ vụ việc** — Hồ sơ/vụ việc, ghi chú, chấm giờ tính phí. Dùng cho luật, tư vấn, kế toán dịch vụ, cơ quan nhà nước, tổ chức phi lợi nhuận.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `case` Vụ việc | `open` → **closed** (open/on_hold→closed), **on_hold** (open→on_hold), **resumed** (on_hold→open) |
| `case_note` Ghi chú | — |
| `time_entry` Giờ công | `recorded` → **billed** (recorded→billed) |

### charity
**Từ thiện / Phi lợi nhuận** — Chương trình, nhà tài trợ, người thụ hưởng. Nhận tiền ủng hộ tự ghi nhận thu.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `program` Chương trình | — |
| `donation` Khoản ủng hộ | `pledged` → **received** (pledged→received) |
| `disbursement` Khoản hỗ trợ | `requested` → **approved** (requested→approved), **paid** (approved→paid), **rejected** (requested→rejected) |
| `beneficiary` Người thụ hưởng | — |

### clinic
**Phòng khám / Y tế** — Bệnh nhân, lượt khám, đơn thuốc, chỉ định xét nghiệm. Khám xong tự lập hóa đơn; phát thuốc tự trừ kho.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `patient` Bệnh nhân | — |
| `encounter` Lượt khám | `open` → **completed** (open→completed) |
| `prescription` Đơn thuốc | `draft` → **dispensed** (draft→dispensed) |
| `lab_order` Chỉ định xét nghiệm | `ordered` → **resulted** (ordered→resulted) |

### construction
**Xây dựng** — Dự toán, công trường, thầu phụ, nghiệm thu khối lượng và cam kết chi phí.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `boq` Dự toán (BOQ) | `draft` → **approved** (draft→approved), **superseded** (approved→superseded) |
| `site` Công trường | — |
| `subcontract` Thầu phụ | `draft` → **completed** (signed→completed), **signed** (draft→signed) |
| `site_diary` Nhật ký thi công | — |
| `progress_claim` Nghiệm thu / đề nghị thanh toán thầu phụ | `draft` → **approved** (draft→approved) |

### events
**Sự kiện & bán vé** — Sự kiện, vé, check-in. Giá vé công bố đã gồm thuế theo cấu hình của sự kiện; bán vé tự ghi nhận thu và thuế.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `event` Sự kiện | `draft` → **closed** (published→closed), **published** (draft→published) |
| `ticket` Vé | `reserved` → **cancelled** (reserved→cancelled), **checked_in** (sold→checked_in), **refunded** (sold→refunded), **sold** (reserved→sold) |

### hotel
**Khách sạn / Lưu trú** — Loại phòng, phòng, đặt phòng, phí phát sinh. Trả phòng tự lập hóa đơn và chuyển phòng sang dọn.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `room_type` Loại phòng | — |
| `room` Phòng | `vacant` → **cleaning** (occupied→cleaning), **occupied** (vacant→occupied), **ready** (cleaning→vacant) |
| `reservation` Đặt phòng | `booked` → **cancelled** (booked→cancelled), **checked_in** (booked→checked_in), **checked_out** (checked_in→checked_out), **no_show** (booked→no_show) |
| `folio_charge` Phí phát sinh | — |

### insurance
**Bảo hiểm** — Hợp đồng bảo hiểm và bồi thường. Kích hoạt tự thu phí; chi bồi thường tự ghi bút toán.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `policy` Hợp đồng bảo hiểm | `quoted` → **activated** (quoted→active), **cancelled** (quoted/active→cancelled), **lapsed** (active→lapsed) |
| `claim` Bồi thường | `submitted` → **approved** (submitted→approved), **paid** (approved→paid), **rejected** (submitted→rejected) |

### lending
**Cho vay / Tài chính vi mô** — Khoản vay lãi suất danh nghĩa năm, lịch niên kim hàng tháng theo dư nợ giảm dần; tự sinh kỳ trả, theo dõi quá hạn và hạch toán gốc/lãi khi giải ngân, thu nợ.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `loan` Khoản vay | `applied` → **approved** (applied→approved), **closed** (disbursed→closed), **defaulted** (disbursed→defaulted), **disbursed** (approved→disbursed), **rejected** (applied→rejected) |
| `repayment` Kỳ trả nợ | `due` → **overdue** (due→overdue), **paid** (due/overdue→paid) |

### pharmacy
**Nhà thuốc** — Quản lý đơn thuốc bán lẻ, xác minh dược sĩ và cấp phát gắn với giao dịch POS.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `prescription` Đơn thuốc | `draft` → **cancelled** (draft/verified→cancelled), **dispensed** (verified/partially_dispensed→dispensed), **partially_dispensed** (verified/partially_dispensed→partially_dispensed), **verified** (draft→verified) |

### real-estate
**Bất động sản** — Bất động sản, lịch xem, hợp đồng thuê. Bán xong tự lập hóa đơn; kích hoạt thuê tự tạo hợp đồng.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `property` Bất động sản | `available` → **leased** (available/reserved→leased), **released** (leased/reserved→available), **reserved** (available→reserved), **sold** (available/reserved→sold) |
| `reservation` Phiếu giữ chỗ | `draft` → **cancelled** (draft/reserved→cancelled), **converted** (reserved→converted), **expired** (reserved→expired), **reserved** (draft→reserved) |
| `viewing` Lịch xem | — |
| `lease` Hợp đồng thuê | `draft` → **activated** (draft→active), **rent_due** (active→active), **terminated** (active→terminated) |
| `rent_cycle` Kỳ thu tiền thuê | — |

### restaurant
**Nhà hàng / F&B** — Bàn, thực đơn, công thức, order tại bàn, màn hình bếp. Gửi bếp tự tạo phiếu bếp; thanh toán tự trừ kho và ghi thu.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `table` Bàn | — |
| `menu_item` Món | — |
| `recipe` Công thức | — |
| `table_order` Order bàn | `open` → **cancelled** (open/sent→cancelled), **completed** (served→completed), **sent** (open→sent), **served** (sent→served) |
| `kitchen_ticket` Phiếu bếp | `queued` → **cancelled** (queued→cancelled), **preparing** (queued→preparing), **ready** (preparing→ready) |

### school
**Trường học / Trung tâm đào tạo** — Học viên, lớp học, ghi danh, điểm số, học phí. Phát hành học phí tự lập hóa đơn; thu tiền cập nhật ngược trạng thái học phí.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `student` Học viên | — |
| `course_class` Lớp học | — |
| `class_enrollment` Ghi danh lớp | `active` → **completed** (active→completed), **dropped** (active→dropped) |
| `class_session` Buổi học | `scheduled` → **cancelled** (scheduled→cancelled), **completed** (scheduled→completed) |
| `attendance` Điểm danh | — |
| `grade` Điểm | — |
| `fee` Học phí | `draft` → **issued** (draft→issued), **paid** (issued→paid) |
| `tuition_batch` Đợt tạo học phí | `draft` → **generated** (draft→generated) |

### utilities
**Điện nước / Viễn thông** — Công tơ, chỉ số, hóa đơn tiêu thụ. Phát hành hóa đơn tự ghi sổ; thu tiền cập nhật ngược.

| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |
|---|---|
| `meter` Công tơ/Đường truyền | — |
| `meter_reading` Chỉ số | — |
| `utility_bill` Hóa đơn tiêu thụ | `draft` → **issued** (draft→issued), **paid** (issued→paid) |
