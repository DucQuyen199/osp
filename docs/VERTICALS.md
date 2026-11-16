# Gói ngành

> Tệp này được sinh tự động bởi `npm run docs`. Đừng sửa tay.

Mỗi gói ngành chỉ là **cấu hình** (module nào bật, thuật ngữ, trường mở rộng, vai trò, KPI), không nhân bản mã nguồn. Khi tạo tenant với `vertical`, hệ thống tự áp dụng cả gói.

**22 ngành**:

## Nông nghiệp - Thủy sản (`agriculture`)
Trang trại, hợp tác xã, chế biến nông sản, truy xuất nguồn gốc.

- **Module (15):** `master-data`, `hrm`, `accounting`, `inventory`, `agriculture`, `communication`, `bi`, `sales`, `einvoice`, `expense`, `logistics`, `quality`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.party` = Đối tác thu mua/bán; `master-data.product` = Nông sản/Vật tư nông nghiệp
- **Trường mở rộng:** `master-data.product`: vietgap_code, origin
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý trang trại, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng
- **Dashboard summary entities:** agriculture.crop_cycle, agriculture.harvest, agriculture.farm, inventory.stock_level, purchasing.purchase_order
- **KPI:** Năng suất/ha; Chi phí vật tư/ha; Sản lượng theo vụ; Tồn kho nông sản

## Ô tô - Xe máy (`automotive`)
Đại lý, showroom, garage, trung tâm bảo hành.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `auto-service`, `communication`, `bi`, `booking`, `sales`, `crm`, `einvoice`, `expense`, `loyalty`, `quality`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `auto-service.vehicle` = Xe; `master-data.party` = Chủ xe; `master-data.product` = Phụ tùng/Dịch vụ
- **Trường mở rộng:** `master-data.product`: oem_code, compatible_models
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Kỹ thuật viên, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Cố vấn dịch vụ
- **Dashboard summary entities:** auto-service.repair_order, auto-service.vehicle, booking.booking, inventory.stock_level, accounting.invoice
- **KPI:** Số xe vào xưởng; Thời gian sửa chữa trung bình; Doanh thu phụ tùng; Tỷ lệ quay lại bảo dưỡng

## Làm đẹp - Spa - Gym (`beauty-wellness`)
Spa, salon, thẩm mỹ, phòng gym, yoga, trung tâm thể thao.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `sales`, `crm`, `einvoice`, `expense`, `loyalty`, `marketing`, `payroll`, `pos`, `recruitment`, `subscription`
- **Thuật ngữ:** `booking.resource` = Kỹ thuật viên/Phòng; `master-data.party` = Khách hàng/Hội viên; `master-data.product` = Dịch vụ/Sản phẩm; `subscription.plan` = Gói hội viên
- **Trường mở rộng:** `master-data.party`: skin_type, health_note, birthday
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Lễ tân, Chuyên viên tuyển dụng, Kỹ thuật viên
- **Dashboard summary entities:** booking.booking, subscription.subscription, pos.pos_order, loyalty.member, marketing.campaign
- **KPI:** Tỷ lệ lấp đầy lịch; Tỷ lệ hội viên gia hạn; Doanh thu/kỹ thuật viên; Tỷ lệ no-show

## Xây dựng - Nội thất (`construction`)
Nhà thầu, thi công, thiết kế - nội thất.

- **Module (19):** `master-data`, `hrm`, `accounting`, `inventory`, `asset`, `communication`, `bi`, `project`, `construction`, `contract`, `document`, `einvoice`, `expense`, `maintenance`, `quality`, `workflow-approval`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.party` = Chủ đầu tư/Khách hàng; `master-data.product` = Vật tư xây dựng; `project.project` = Công trình
- **Trường mở rộng:** `master-data.product`: norm_code, brand
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Dự toán, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý bảo trì, Kỹ thuật viên bảo trì, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Quản lý dự án, Chuyên viên tuyển dụng, Chỉ huy công trường
- **Dashboard summary entities:** construction.site, construction.boq, construction.progress_claim, project.project, purchasing.purchase_order
- **KPI:** Tiến độ so với kế hoạch; Chi phí thực tế vs dự toán; Công nợ thầu phụ; Vật tư hao hụt

## Thương mại điện tử (`ecommerce`)
Shop online, thương hiệu D2C, bán trên sàn.

- **Module (20):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `sales`, `crm`, `ecommerce`, `einvoice`, `expense`, `helpdesk`, `logistics`, `loyalty`, `quality`, `marketing`, `payments`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `ecommerce.web_order` = Đơn online; `master-data.party` = Khách hàng; `master-data.product` = Sản phẩm
- **Trường mở rộng:** `master-data.product`: seo_title, weight_g, marketplace_sku
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, CSKH, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Đóng gói - Giao hàng, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Vận hành đơn online, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng
- **Dashboard summary entities:** ecommerce.web_order, sales.sales_order, inventory.stock_level, purchasing.purchase_order, accounting.invoice
- **KPI:** Tỷ lệ chuyển đổi; AOV; Tỷ lệ hoàn trả; Chi phí thu hút khách hàng

## Giáo dục - Đào tạo (`education`)
Trường tư, trung tâm ngoại ngữ, trung tâm kỹ năng, đào tạo doanh nghiệp.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `sales`, `crm`, `document`, `einvoice`, `expense`, `lms`, `marketing`, `payroll`, `recruitment`, `school`
- **Thuật ngữ:** `crm.deal` = Hồ sơ tuyển sinh; `crm.lead` = Học viên tiềm năng; `master-data.party` = Phụ huynh/Học viên; `master-data.product` = Khóa học/Dịch vụ
- **Trường mở rộng:** `master-data.party`: school_year, learning_goal
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Tuyển sinh, Nhân viên đối soát ngân hàng, Thu học phí, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng, Giáo viên
- **Dashboard summary entities:** school.student, school.class_enrollment, school.class_session, school.fee, lms.course, accounting.invoice
- **KPI:** Tỷ lệ chuyển đổi tuyển sinh; Tỷ lệ giữ chân học viên; Công nợ học phí; Sĩ số lớp trung bình

## Sự kiện - Truyền thông (`events-media`)
Tổ chức sự kiện, hội nghị, rạp/phòng trà, agency truyền thông.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `project`, `contract`, `sales`, `crm`, `einvoice`, `events`, `expense`, `marketing`, `payroll`, `recruitment`
- **Thuật ngữ:** `events.ticket` = Vé; `master-data.party` = Khách mời/Khách hàng; `master-data.product` = Gói dịch vụ
- **Trường mở rộng:** `master-data.party`: company, vip_level
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Bán vé, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Sản xuất sự kiện, Chuyên viên tuyển dụng
- **Dashboard summary entities:** events.event, events.ticket, crm.deal, project.project, accounting.invoice
- **KPI:** Tỷ lệ lấp đầy sự kiện; Doanh thu vé; Chi phí/khách; Tỷ lệ check-in

## Tài chính - Bảo hiểm (`finance`)
Công ty tài chính tiêu dùng, tín dụng vi mô, đại lý bảo hiểm.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `contract`, `sales`, `crm`, `document`, `einvoice`, `expense`, `insurance`, `lending`, `workflow-approval`, `payroll`, `recruitment`
- **Thuật ngữ:** `crm.deal` = Hồ sơ vay/BH; `master-data.party` = Khách hàng vay/Người mua BH; `master-data.product` = Sản phẩm tài chính
- **Trường mở rộng:** `master-data.party`: national_id, monthly_income, credit_score
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Giải ngân / Chi trả, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Tư vấn bảo hiểm, Cán bộ tín dụng / Thu nợ, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng, Thẩm định
- **Dashboard summary entities:** lending.loan, insurance.policy, insurance.claim, accounting.invoice, accounting.payment
- **KPI:** Dư nợ; Tỷ lệ nợ xấu (NPL); Tỷ lệ phê duyệt; Tỷ lệ bồi thường

## Nhà hàng - Quán cà phê (F&B) (`fnb`)
Nhà hàng, quán cà phê, chuỗi đồ uống, bếp trung tâm.

- **Module (16):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `einvoice`, `expense`, `loyalty`, `quality`, `payroll`, `pos`, `purchasing`, `recruitment`, `restaurant`
- **Thuật ngữ:** `master-data.party` = Thực khách; `master-data.product` = Món/Nguyên liệu; `restaurant.table_order` = Order bàn
- **Trường mở rộng:** `master-data.product`: allergens, prep_time_min
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Thu ngân, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Bếp, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Phục vụ
- **Dashboard summary entities:** restaurant.table_order, restaurant.kitchen_ticket, pos.pos_order, inventory.stock_level, purchasing.purchase_order
- **KPI:** Doanh thu theo ca; Thời gian lên món; Food cost %; Số lượt khách/bàn

## Y tế - Phòng khám (`healthcare`)
Phòng khám đa khoa/chuyên khoa, nha khoa, thẩm mỹ, xét nghiệm.

- **Module (15):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `clinic`, `sales`, `crm`, `document`, `einvoice`, `expense`, `payroll`, `recruitment`
- **Thuật ngữ:** `master-data.branch` = Cơ sở khám; `master-data.party` = Bệnh nhân; `master-data.product` = Thuốc/Dịch vụ y tế
- **Trường mở rộng:** `master-data.party`: national_id, emergency_contact; `master-data.product`: active_ingredient, requires_prescription
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Bác sĩ, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Dược sĩ, Lễ tân, Chuyên viên tuyển dụng
- **Dashboard summary entities:** clinic.encounter, clinic.prescription, booking.booking, inventory.stock_level, accounting.invoice
- **KPI:** Lượt khám/ngày; Thời gian chờ trung bình; Doanh thu theo bác sĩ; Tỷ lệ tái khám

## Dịch vụ tại nhà - Sửa chữa (`home-services`)
Điện lạnh, sửa chữa, vệ sinh, bảo trì, lắp đặt tại nhà khách.

- **Module (16):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `sales`, `crm`, `einvoice`, `expense`, `helpdesk`, `field-service`, `loyalty`, `payroll`, `recruitment`
- **Thuật ngữ:** `field-service.work_order` = Lệnh công việc; `master-data.party` = Khách hàng; `master-data.product` = Vật tư/Dịch vụ
- **Trường mở rộng:** `master-data.party`: service_address, access_note
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Điều phối, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng, Kỹ thuật viên
- **Dashboard summary entities:** field-service.work_order, booking.booking, helpdesk.ticket, inventory.stock_level, accounting.invoice
- **KPI:** Tỷ lệ xử lý lần đầu; Thời gian đến hiện trường; Doanh thu/kỹ thuật viên; Mức độ hài lòng

## Khách sạn - Du lịch lưu trú (`hospitality`)
Khách sạn, resort, homestay, nhà nghỉ.

- **Module (15):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `einvoice`, `expense`, `hotel`, `loyalty`, `payroll`, `pos`, `recruitment`, `restaurant`
- **Thuật ngữ:** `master-data.branch` = Cơ sở lưu trú; `master-data.party` = Khách lưu trú; `master-data.product` = Dịch vụ/Vật tư
- **Trường mở rộng:** `master-data.party`: passport_no, nationality
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Lễ tân, Quản lý tuyển dụng, Buồng phòng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng
- **Dashboard summary entities:** hotel.reservation, hotel.room, restaurant.table_order, pos.pos_order, accounting.invoice
- **KPI:** Công suất phòng (OCC); ADR; RevPAR; Doanh thu dịch vụ phụ trợ

## Vận tải - Logistics (`logistics`)
Công ty vận tải, giao nhận, kho vận, chuyển phát.

- **Module (16):** `master-data`, `hrm`, `accounting`, `inventory`, `asset`, `communication`, `bi`, `contract`, `sales`, `crm`, `einvoice`, `expense`, `logistics`, `maintenance`, `payroll`, `recruitment`
- **Thuật ngữ:** `logistics.shipment` = Vận đơn; `master-data.party` = Chủ hàng; `master-data.product` = Dịch vụ vận chuyển
- **Trường mở rộng:** `master-data.party`: contract_rate_tier
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Điều độ, Tài xế, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý bảo trì, Kỹ thuật viên bảo trì, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng
- **Dashboard summary entities:** logistics.shipment, logistics.route, inventory.stock_move, sales.sales_order, accounting.invoice
- **KPI:** Tỷ lệ giao đúng hẹn; Chi phí/km; Hiệu suất sử dụng xe; Số vận đơn/ngày

## Sản xuất (`manufacturing`)
Nhà máy, xưởng sản xuất, gia công, lắp ráp.

- **Module (18):** `master-data`, `hrm`, `accounting`, `inventory`, `asset`, `communication`, `bi`, `sales`, `crm`, `einvoice`, `expense`, `maintenance`, `quality`, `workflow-approval`, `manufacturing`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.party` = Khách hàng; `master-data.product` = Vật tư/Thành phẩm
- **Trường mở rộng:** `master-data.product`: drawing_no, spec, shelf_life_days
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý bảo trì, Kỹ thuật viên bảo trì, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Kế hoạch sản xuất, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, QC, Người phê duyệt chấp nhận có điều kiện, Chuyên viên tuyển dụng, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng, Kỹ thuật bảo trì
- **Dashboard summary entities:** manufacturing.production_order, manufacturing.rework_order, quality.inspection, inventory.stock_level, purchasing.purchase_order
- **KPI:** OEE; Tỷ lệ phế phẩm; Tiến độ lệnh sản xuất; Giá thành đơn vị

## Tổ chức phi lợi nhuận - Cơ quan công (`ngo-government`)
NGO, quỹ từ thiện, hiệp hội, đơn vị hành chính sự nghiệp.

- **Module (15):** `master-data`, `hrm`, `accounting`, `communication`, `bi`, `budget`, `case-management`, `charity`, `project`, `document`, `einvoice`, `expense`, `workflow-approval`, `payroll`, `recruitment`
- **Thuật ngữ:** `case-management.case` = Hồ sơ; `charity.beneficiary` = Người thụ hưởng; `master-data.party` = Nhà tài trợ/Đối tượng; `master-data.product` = Hạng mục
- **Trường mở rộng:** `master-data.party`: national_id, ward
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Cán bộ tài chính, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Cán bộ chương trình, Chuyên viên tuyển dụng
- **Dashboard summary entities:** charity.program, charity.donation, charity.disbursement, case-management.case, budget.budget
- **KPI:** Tỷ lệ giải ngân ngân sách; Số người thụ hưởng; Chi phí quản lý %; Tiến độ chương trình

## Nhà thuốc (`pharmacy`)
Nhà thuốc, chuỗi nhà thuốc, thiết bị y tế.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `sales`, `crm`, `einvoice`, `expense`, `loyalty`, `quality`, `payroll`, `pos`, `pharmacy`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.party` = Khách hàng; `master-data.product` = Thuốc/Vật tư y tế
- **Trường mở rộng:** `master-data.product`: active_ingredient, registration_no, requires_prescription, storage_condition
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Dược sĩ, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng
- **Dashboard summary entities:** pharmacy.prescription, pos.pos_order, inventory.stock_level, purchasing.purchase_order, accounting.invoice
- **KPI:** Hàng cận date; Doanh thu theo nhóm thuốc; Biên lợi nhuận; Tồn kho an toàn

## Dịch vụ chuyên nghiệp (`professional-services`)
Luật, kế toán - kiểm toán, tư vấn, agency, kiến trúc.

- **Module (16):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `case-management`, `project`, `contract`, `sales`, `crm`, `document`, `einvoice`, `expense`, `payroll`, `recruitment`
- **Thuật ngữ:** `case-management.case` = Vụ việc/Hồ sơ; `master-data.party` = Thân chủ/Khách hàng; `master-data.product` = Dịch vụ
- **Trường mở rộng:** `master-data.party`: industry, engagement_partner
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Chuyên viên, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Đối tác/Trưởng nhóm, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng
- **Dashboard summary entities:** case-management.case, case-management.time_entry, project.project, crm.deal, accounting.invoice
- **KPI:** Tỷ lệ giờ tính phí; Doanh thu theo vụ việc; WIP chưa xuất hóa đơn; Doanh thu/nhân sự

## Bất động sản (`real-estate`)
Sàn môi giới, chủ đầu tư, quản lý cho thuê.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `booking`, `contract`, `sales`, `crm`, `document`, `einvoice`, `expense`, `marketing`, `payroll`, `real-estate`, `recruitment`
- **Thuật ngữ:** `crm.deal` = Giao dịch; `crm.lead` = Khách quan tâm; `master-data.party` = Khách hàng/Chủ nhà; `master-data.product` = Dịch vụ
- **Trường mở rộng:** `master-data.party`: budget_range, preferred_area
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Môi giới, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý cho thuê, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng
- **Dashboard summary entities:** real-estate.property, real-estate.reservation, real-estate.lease, real-estate.rent_cycle, accounting.invoice
- **KPI:** Tỷ lệ chốt giao dịch; Thời gian bán trung bình; Hoa hồng theo môi giới; Tỷ lệ lấp đầy cho thuê

## Bán lẻ (`retail`)
Cửa hàng, chuỗi bán lẻ, siêu thị mini, thời trang, điện máy.

- **Module (18):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `sales`, `crm`, `ecommerce`, `einvoice`, `expense`, `loyalty`, `quality`, `marketing`, `payroll`, `pos`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.branch` = Cửa hàng; `master-data.party` = Khách hàng; `master-data.product` = Hàng hóa
- **Trường mở rộng:** `master-data.product`: brand, barcode, size, color
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Thu ngân, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng, Thủ kho
- **Dashboard summary entities:** pos.pos_order, sales.sales_order, inventory.stock_level, ecommerce.web_order, crm.deal, accounting.invoice
- **KPI:** Doanh thu theo cửa hàng; Giá trị đơn trung bình; Vòng quay tồn kho; Tỷ lệ khách quay lại

## Công nghệ - SaaS (`saas-technology`)
Công ty phần mềm, dịch vụ IT, startup sản phẩm số.

- **Module (18):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `project`, `sales`, `crm`, `einvoice`, `expense`, `helpdesk`, `integration-hub`, `marketing`, `payments`, `payroll`, `recruitment`, `subscription`
- **Thuật ngữ:** `master-data.party` = Khách hàng; `master-data.product` = Gói/Add-on; `subscription.subscription` = Subscription
- **Trường mở rộng:** `master-data.party`: plan_tier, mrr, tech_contact
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Customer Success, Kỹ sư, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng
- **Dashboard summary entities:** subscription.subscription, helpdesk.ticket, payments.payment_txn, project.project, accounting.invoice
- **KPI:** MRR / ARR; Churn; LTV / CAC; Thời gian giải quyết ticket

## Viễn thông - Điện nước - ISP (`utilities-isp`)
Nhà cung cấp internet, truyền hình, nước sạch, điện, tiện ích.

- **Module (16):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `sales`, `crm`, `einvoice`, `expense`, `helpdesk`, `field-service`, `payroll`, `recruitment`, `subscription`, `utilities`
- **Thuật ngữ:** `master-data.party` = Thuê bao; `master-data.product` = Gói cước/Dịch vụ; `subscription.subscription` = Thuê bao
- **Trường mở rộng:** `master-data.party`: service_address, zone
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Ghi chỉ số, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Chuyên viên tuyển dụng, Hỗ trợ khách hàng, Lập và thu hóa đơn tiện ích
- **Dashboard summary entities:** utilities.meter, utilities.utility_bill, utilities.meter_reading, field-service.work_order, accounting.invoice
- **KPI:** ARPU; Churn; Thời gian xử lý ticket; Tỷ lệ thu cước đúng hạn

## Bán buôn - Phân phối (`wholesale`)
Nhà phân phối, đại lý, bán sỉ, FMCG.

- **Module (17):** `master-data`, `hrm`, `accounting`, `inventory`, `communication`, `bi`, `contract`, `sales`, `crm`, `einvoice`, `expense`, `logistics`, `quality`, `workflow-approval`, `payroll`, `purchasing`, `recruitment`
- **Thuật ngữ:** `master-data.party` = Khách hàng/Đại lý; `master-data.product` = Mặt hàng
- **Trường mở rộng:** `master-data.party`: credit_limit, payment_term_days, sales_region
- **Vai trò riêng:** Quản lý khóa sổ kế toán, Kế toán duyệt thu chi, Nhân viên thu chi điều chỉnh, Nhân viên đối soát ngân hàng, Điều phối giao hàng, Quản lý duyệt và chi trả chi phí, Chuyên viên đề nghị chi, Quản lý tuyển dụng, Quản lý nhân sự, Chuyên viên nhân sự, Quản lý duyệt kiểm kê, Nhân viên kiểm kê kho, Quản lý phê duyệt và chi lương, Chuyên viên tiền lương, Quản lý chính sách lương và khoản nộp, Quản lý phê duyệt mua hàng, Nhân viên mua hàng, Chuyên viên tuyển dụng, Trưởng kinh doanh, Quản lý duyệt trả hàng, Nhân viên xử lý trả hàng
- **Dashboard summary entities:** crm.deal, sales.sales_order, purchasing.purchase_order, logistics.shipment, inventory.stock_level
- **KPI:** Doanh số theo khu vực/NVKD; Công nợ quá hạn; Tỷ lệ giao đúng hẹn; Tồn kho theo kho

