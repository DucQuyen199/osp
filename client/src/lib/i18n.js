import { businessTimezone } from './dates.js';

// Từ điển tiếng Việt cho nhãn trường, trạng thái, hành động + định dạng số/ngày.
// Quy ước nội dung: câu ngắn, động từ ở đầu nút ("Tạo mới", "Xác nhận"), không viết hoa tràn lan, dùng "bạn".

const FIELDS = {
  discount_pct: 'Chiết khấu (%)', discount_amount: 'Tiền chiết khấu', line_total: 'Thành tiền',
  tax: 'Thuế', ticket_tax: 'Thuế vé', ticket_tax_rate: 'Thuế suất vé (%)', tax_rate: 'Thuế suất (%)', tax_name: 'Tên thuế', tax_amount: 'Tiền thuế', tax_total: 'Tổng thuế', net_amount: 'Tiền trước thuế',
  from_warehouse: 'Kho xuất', to_warehouse: 'Kho nhận', adjustment_lines: 'Số lượng kiểm kê thực tế',
  name: 'Tên', title: 'Tiêu đề', subject: 'Chủ đề', code: 'Mã', sku: 'Mã SKU', number: 'Số', phone: 'Điện thoại', email: 'Email',
  address: 'Địa chỉ', note: 'Ghi chú', notes: 'Ghi chú', description: 'Mô tả', kind: 'Loại', type: 'Loại', status: 'Trạng thái',
  party: 'Đối tác', supplier: 'Nhà cung cấp', vendor: 'Nhà thầu', tenant: 'Bên thuê', buyer: 'Người mua', donor: 'Nhà tài trợ',
  product: 'Sản phẩm', price: 'Đơn giá', ticket_price: 'Giá vé (đã gồm thuế)', cost: 'Giá vốn', amount: 'Số tiền', total: 'Tổng tiền', qty: 'Số lượng', lines: 'Dòng hàng', items: 'Hạng mục', probability: 'Xác suất (%)', expected_close: 'Ngày dự kiến chốt', pipeline_stage: 'Giai đoạn bán hàng',
  uom: 'Đơn vị tính', category: 'Nhóm', parent: 'Thuộc', tracked: 'Theo dõi lô', active: 'Đang dùng', tax_code: 'Mã số thuế',
  is_customer: 'Là khách hàng', is_supplier: 'Là nhà cung cấp', branch: 'Chi nhánh', warehouse: 'Kho', rate: 'Tỷ lệ / Tỷ giá', ratio: 'Hệ số',
  source: 'Nguồn', source_id: 'Mã nguồn', owner: 'Phụ trách', stage: 'Giai đoạn', company: 'Công ty', due: 'Hạn', done: 'Hoàn thành',
  lead: 'Lead', deal: 'Cơ hội', order_date: 'Ngày đặt', valid_until: 'Hiệu lực đến', shipping_address: 'Địa chỉ giao hàng',
  method: 'Hình thức', payment_method: 'Phương thức chi', payment_date: 'Ngày chi', session: 'Ca bán', cashier: 'Thu ngân', channel: 'Kênh', domain: 'Tên miền', currency: 'Tiền tệ',
  budget: 'Ngân sách', start: 'Bắt đầu', end: 'Kết thúc', start_date: 'Từ ngày', end_date: 'Đến ngày', criteria: 'Tiêu chí', url: 'Đường dẫn',
  journal_entry: 'Bút toán đối ứng ngân hàng', payment: 'Payment ngân hàng',
  priority: 'Mức ưu tiên', assignee: 'Người xử lý', response_hours: 'Giờ phản hồi', resolve_hours: 'Giờ xử lý', body: 'Nội dung', published: 'Đã đăng',
  tier: 'Hạng', points: 'Điểm', percent: 'Phần trăm', used: 'Đã dùng', interval: 'Chu kỳ', plan: 'Gói', subscription: 'Thuê bao', due_date: 'Hạn thanh toán',
  duration_min: 'Thời lượng (phút)', resource: 'Tài nguyên', service: 'Dịch vụ', starts_at: 'Bắt đầu lúc', ends_at: 'Kết thúc lúc', refund_reason: 'Lý do hoàn vé',
  title_: 'Tiêu đề', technician: 'Kỹ thuật viên', scheduled_at: 'Lịch hẹn', expected_date: 'Dự kiến về', requested_by: 'Người đề nghị', reason: 'Lý do', ignore_reason: 'Lý do bỏ qua',
  lot: 'Lô', expiry: 'Hạn dùng', output_lot_code: 'Mã lô thành phẩm', output_expiry: 'Hạn dùng thành phẩm', direction: 'Chiều', components: 'Thành phần', output_qty: 'Sản lượng', bom: 'Định mức', planned_start: 'Dự kiến bắt đầu',
  capacity_per_day: 'Công suất/ngày', result: 'Kết quả', severity: 'Mức độ', purchase_date: 'Ngày mua', location: 'Vị trí',
  asset: 'Tài sản', interval_days: 'Chu kỳ (ngày)', next_due: 'Lần tới', plate: 'Biển số', capacity: 'Tải trọng/Sức chứa', reservation_minutes: 'Thời gian giữ vé (phút)', reservation_expires_at: 'Hạn giữ vé', license: 'Bằng lái', reviewer: 'Người đánh giá',
  stops: 'Điểm dừng', origin: 'Điểm đi', destination: 'Điểm đến', vehicle: 'Phương tiện', driver: 'Tài xế', weight: 'Khối lượng',
  issue_date: 'Ngày lập', posting_date: 'Ngày hạch toán', asOf: 'Tính đến ngày', invoice: 'Hóa đơn', bill: 'Hóa đơn mua', memo: 'Diễn giải', provider: 'Nhà cung cấp dịch vụ', serial: 'Ký hiệu', lookup_code: 'Mã tra cứu',
  employee: 'Nhân viên', department: 'Phòng ban', position: 'Chức danh', hire_date: 'Ngày vào làm', base_salary: 'Lương cơ bản',
  year: 'Năm', entitled_days: 'Số ngày được hưởng',
  date: 'Ngày', check_in: 'Giờ vào', check_out: 'Giờ ra', period: 'Kỳ', run: 'Bảng lương', gross: 'Lương gộp', deductions: 'Khấu trừ', net: 'Thực nhận', total_net: 'Tổng thực nhận',
  job: 'Vị trí', candidate: 'Ứng viên', candidate_name: 'Tên ứng viên', headcount: 'Số lượng cần tuyển',
  course: 'Khóa học', lesson: 'Bài học', required: 'Bắt buộc', learner: 'Học viên', progress: 'Tiến độ (%)', content: 'Nội dung', objective: 'Mục tiêu', target: 'Chỉ tiêu', current: 'Hiện tại',
  score: 'Điểm', comment: 'Nhận xét', project: 'Dự án', task: 'Công việc', hours: 'Số giờ', entity: 'Đối tượng', record_id: 'Mã bản ghi',
  min_amount: 'Số tiền tối thiểu', variance_tolerance: 'Dung sai chênh lệch HĐ', dispute_reason: 'Lý do tranh chấp', resolution_note: 'Ghi chú giải quyết', approvers: 'Người duyệt', folder: 'Thư mục', file_url: 'Tệp', version: 'Phiên bản', tags: 'Thẻ',
  signer_email: 'Email người ký', signer_name: 'Tên người ký', clause: 'Điều khoản', value: 'Giá trị', recipient: 'Người nhận',
  widgets: 'Thành phần', query: 'Truy vấn', schedule: 'Lịch chạy', formula: 'Công thức', config: 'Cấu hình', enabled: 'Bật', events: 'Sự kiện', secret: 'Khóa bí mật',
  key: 'Khóa', scopes: 'Phạm vi', dob: 'Ngày sinh', gender: 'Giới tính', blood_type: 'Nhóm máu', allergies: 'Dị ứng', insurance_no: 'Số bảo hiểm',
  patient: 'Bệnh nhân', doctor: 'Bác sĩ', complaint: 'Lý do khám', diagnosis: 'Chẩn đoán', fee: 'Phí khám', encounter: 'Lượt khám', test: 'Xét nghiệm',
  student: 'Học viên', student_code: 'Mã học viên', guardian: 'Phụ huynh', subject_: 'Môn', teacher: 'Giáo viên', tuition: 'Học phí', class: 'Lớp', enrollment: 'Ghi danh', term: 'Học kỳ',
  area: 'Diện tích', property: 'Bất động sản', room_type: 'Loại phòng', room: 'Phòng', floor: 'Tầng', reservation: 'Đặt phòng', check_out_: 'Trả phòng',
  guest_count: 'Số lượng khách',
  seats: 'Số chỗ', station: 'Khu bếp', available: 'Còn phục vụ', ingredients: 'Nguyên liệu', table: 'Bàn', order: 'Đơn',
  farm: 'Trang trại', crop: 'Cây trồng', planted_on: 'Ngày gieo trồng', expected_harvest: 'Dự kiến thu hoạch', cycle: 'Vụ mùa', grade: 'Phân loại', lot_code: 'Mã lô',
  preharvest_interval_days: 'Thời gian cách ly trước thu hoạch (ngày)',
  no_show_reason: 'Lý do khách vắng mặt',
  approved_amount: 'Số tiền bồi thường được duyệt',
  principal: 'Gốc vay', term_months: 'Kỳ hạn (tháng)', loan: 'Khoản vay', premium: 'Phí bảo hiểm', policy: 'Hợp đồng BH', case: 'Vụ việc', opened_on: 'Ngày mở', who: 'Người thực hiện',
  meter: 'Công tơ', reading: 'Chỉ số', make: 'Hãng', model: 'Dòng xe', vin: 'Số khung', odometer: 'Số km', vehicle_: 'Xe', program: 'Chương trình', venue: 'Địa điểm', event: 'Sự kiện',
  id: 'Mã', createdAt: 'Ngày tạo', updatedAt: 'Cập nhật', debit: 'Nợ', credit: 'Có',
};

const STATUS = {
  disputed: 'Đang tranh chấp',
  released: 'Sẵn sàng trở lại',
  cycle_count: 'Kiểm kê định kỳ', damage: 'Hư hỏng', opening_balance: 'Tồn đầu kỳ', correction: 'Điều chỉnh',
  draft: 'Nháp', new: 'Mới', open: 'Mở', planned: 'Lên kế hoạch', pending: 'Chờ xử lý', cart: 'Giỏ hàng', requested: 'Đã yêu cầu', applied: 'Đã nộp', effective: 'Có hiệu lực', quoted: 'Đã báo giá',
  created: 'Mới tạo', generated: 'Đã lập', queued: 'Đang chờ', ordered: 'Đã chỉ định', submitted: 'Đã gửi', returned: 'Cần chỉnh sửa', acknowledged: 'Đã xác nhận', intake: 'Tiếp nhận', pledged: 'Cam kết', reserved: 'Đã giữ chỗ', recorded: 'Đã ghi nhận',
  due: 'Đến hạn', booked: 'Đã đặt', available: 'Còn trống', vacant: 'Trống', growing: 'Đang trồng', todo: 'Cần làm', active: 'Đang hoạt động', pause: 'Tạm dừng',
  contacted: 'Đã liên hệ', qualified: 'Đủ điều kiện', disqualified: 'Không đạt', converted: 'Đã chuyển đổi', won: 'Thắng', lost: 'Thua',
  qualification: 'Sơ tuyển', discovery: 'Tìm hiểu nhu cầu', proposal: 'Đề xuất / báo giá', negotiation: 'Thương lượng', unclassified: 'Chưa phân loại',
  sent: 'Đã gửi', accepted: 'Đã chấp nhận', rejected: 'Bị từ chối', confirmed: 'Đã xác nhận', partially_delivered: 'Đã giao một phần', delivered: 'Đã giao', cancelled: 'Đã hủy', completed: 'Hoàn tất',
  refunded: 'Đã hoàn', placed: 'Đã đặt', approved: 'Đã duyệt', sourced: 'Đã chọn nhà cung cấp', received: 'Đã nhận', posted: 'Đã ghi sổ', reversed: 'Đã đảo bút toán', paid: 'Đã thanh toán', void: 'Đã hủy bỏ',
  in_progress: 'Đang thực hiện', quote_declined: 'Khách từ chối báo giá', doing: 'Đang làm', done: 'Xong', closed: 'Đã đóng', resolved: 'Đã xử lý', launched: 'Đang chạy', paused: 'Tạm dừng',
  dispatched: 'Đã xuất phát', failed: 'Thất bại', issued: 'Đã phát hành', withdrawn: 'Đã rút', signed: 'Đã ký', sold: 'Đã bán', leased: 'Đã cho thuê', terminated: 'Đã chấm dứt',
  superseded: 'Đã thay thế',
  expired: 'Hết hạn', disposed: 'Đã thanh lý', on_hold: 'Tạm hoãn', succeeded: 'Thành công', hired: 'Đã tuyển', resulted: 'Có kết quả', partially_dispensed: 'Đã cấp một phần', dispensed: 'Đã phát thuốc',
  checked_in: 'Đã nhận phòng/Check-in', checked_out: 'Đã trả phòng', no_show: 'Vắng mặt', occupied: 'Có khách', cleaning: 'Đang dọn', served: 'Đã phục vụ',
  preparing: 'Đang chế biến', ready: 'Sẵn sàng', disbursed: 'Đã giải ngân', defaulted: 'Nợ xấu', overdue: 'Quá hạn', lapsed: 'Mất hiệu lực', harvested: 'Đã thu hoạch',
  dropped: 'Đã nghỉ', declined: 'Từ chối ký', published: 'Đã đăng', in: 'Nhập', out: 'Xuất',
  period_closed: 'Kỳ đã khóa',
  cash: 'Tiền mặt', bank: 'Ngân hàng', card: 'Thẻ', transfer: 'Chuyển khoản', ewallet: 'Ví điện tử', low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp',
  person: 'Cá nhân', company: 'Doanh nghiệp', goods: 'Hàng hóa', service: 'Dịch vụ', digital: 'Sản phẩm số', hq: 'Trụ sở', branch: 'Chi nhánh', warehouse: 'Kho', store: 'Cửa hàng',
  monthly: 'Hàng tháng', quarterly: 'Hàng quý', yearly: 'Hàng năm', pass: 'Đạt', fail: 'Không đạt', kitchen: 'Bếp', bar: 'Quầy pha chế',
  male: 'Nam', female: 'Nữ', other: 'Khác', asset: 'Tài sản', liability: 'Nợ phải trả', equity: 'Vốn chủ sở hữu', revenue: 'Doanh thu', expense: 'Chi phí', clearing: 'Kết chuyển',
  bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', platinum: 'Bạch kim', web: 'Web', app: 'Ứng dụng', marketplace: 'Sàn TMĐT',
  email: 'Email', sms: 'SMS', zalo: 'Zalo', push: 'Thông báo đẩy', webhook: 'Webhook', call: 'Cuộc gọi', meeting: 'Cuộc họp', task: 'Công việc',
};

const ACTIONS = {
  disputed: 'Mở tranh chấp',
  released: 'Đưa về trạng thái sẵn sàng',
  contacted: 'Đã liên hệ', qualified: 'Đánh giá đủ điều kiện', disqualified: 'Loại', converted: 'Chuyển thành khách hàng', won: 'Thắng', lost: 'Thua',
  sent: 'Gửi', accepted: 'Chấp nhận', rejected: 'Từ chối', confirmed: 'Xác nhận', partially_delivered: 'Ghi nhận giao một phần', delivered: 'Hoàn tất giao hàng', cancelled: 'Hủy',
  completed: 'Hoàn tất', refunded: 'Hoàn tiền', placed: 'Đặt hàng', approved: 'Duyệt', acknowledged: 'Xác nhận đã nhận', returned: 'Trả chỉnh sửa', received: 'Nhận hàng', posted: 'Ghi sổ', reversed: 'Đảo bút toán', paid: 'Đã thanh toán', void: 'Hủy bỏ',
  closed: 'Đóng', resolved: 'Đã xử lý', responded: 'Đã phản hồi', reopened: 'Mở lại', launched: 'Khởi chạy', paused: 'Tạm dừng', resumed: 'Tiếp tục', started: 'Bắt đầu', done: 'Hoàn thành', quote_declined: 'Ghi nhận khách từ chối báo giá',
  dispatched: 'Xuất phát', failed: 'Thất bại', issued: 'Phát hành', signed: 'Ký', sold: 'Bán', leased: 'Cho thuê', activated: 'Kích hoạt', terminated: 'Chấm dứt',
  superseded: 'Đã thay thế',
  expired: 'Hết hạn', disposed: 'Thanh lý', on_hold: 'Tạm hoãn', succeeded: 'Thành công', hired: 'Tuyển dụng', resulted: 'Có kết quả', partially_dispensed: 'Cấp một phần', dispensed: 'Phát thuốc',
  checked_in: 'Nhận phòng / Check-in', checked_out: 'Trả phòng', no_show: 'Vắng mặt', occupied: 'Có khách', cleaning: 'Dọn phòng', ready: 'Sẵn sàng',
  served: 'Đã phục vụ', preparing: 'Chế biến', disbursed: 'Giải ngân', defaulted: 'Chuyển nợ xấu', overdue: 'Quá hạn', lapsed: 'Hết hiệu lực', harvested: 'Thu hoạch',
  dropped: 'Nghỉ học', declined: 'Từ chối ký', published: 'Đăng', reserved: 'Giữ chỗ', terminated_: 'Chấm dứt', due: 'Đến hạn', billed: 'Xuất hóa đơn', created: 'Tạo mới',
  updated: 'Cập nhật', deleted: 'Xóa', submitted: 'Gửi duyệt', refund: 'Hoàn tiền', stoped: 'Dừng',
  closed: 'Khóa kỳ', reopened: 'Mở lại kỳ',
};

const TONE = {
  success: ['won', 'paid', 'completed', 'delivered', 'approved', 'active', 'issued', 'signed', 'sold', 'resulted', 'done', 'succeeded', 'hired', 'converted', 'accepted',
    'resolved', 'received', 'posted', 'confirmed', 'dispensed', 'disbursed', 'harvested', 'published', 'ready', 'served', 'pass', 'leased', 'effective'],
  danger: ['lost', 'rejected', 'cancelled', 'failed', 'void', 'reversed', 'disqualified', 'defaulted', 'overdue', 'terminated', 'expired', 'declined', 'no_show', 'fail', 'lapsed', 'refunded', 'disposed', 'dropped'],
  warning: ['pending', 'due', 'on_hold', 'requested', 'queued', 'preparing', 'paused', 'pledged', 'cleaning', 'submitted', 'intake'],
  info: ['sent', 'in_progress', 'doing', 'launched', 'dispatched', 'contacted', 'qualified', 'placed', 'booked', 'reserved', 'quoted', 'checked_in', 'occupied', 'growing', 'ordered', 'applied'],
};

const TONE_LOOKUP = Object.fromEntries(Object.entries(TONE).flatMap(([t, list]) => list.map((s) => [s, t])));

const CATEGORY = {
  core: 'Lõi', sales: 'Bán hàng & khách hàng', supply: 'Chuỗi cung ứng', finance: 'Tài chính', people: 'Nhân sự',
  operations: 'Vận hành', platform: 'Nền tảng dùng chung', industry: 'Chuyên ngành',
};
export const CATEGORY_ORDER = ['core', 'sales', 'supply', 'finance', 'people', 'operations', 'platform', 'industry'];

const UI_TEXT_EN = {
  'Bỏ qua điều hướng': 'Skip navigation', 'Đóng menu': 'Close menu', 'Mở menu': 'Open menu',
  'Điều hướng chính': 'Main navigation', 'Trang chủ': 'Home', 'Dòng sự kiện': 'Activity feed',
  'Quy trình & báo cáo': 'Workflows & reports', 'Báo cáo & phân tích': 'Reports & analytics',
  'Phê duyệt': 'Approvals', 'Sổ hợp đồng': 'Contract register', 'Thư viện tài liệu': 'Document library',
  'Cổng tích hợp': 'Integration hub', 'Khách hàng thân thiết': 'Loyalty', 'Báo cáo kế toán': 'Accounting reports',
  'WIP sản xuất': 'Manufacturing WIP', 'Sổ tài sản cố định': 'Fixed assets', 'Lịch khấu hao tài sản': 'Depreciation schedule',
  'Bổ sung tồn kho': 'Inventory replenishment', 'Tồn theo vị trí': 'Stock by location', 'Lô sắp hết hạn': 'Expiring lots',
  'Kiểm kê kho': 'Stock counts', 'Màn hình bếp': 'Kitchen display', 'Điều phối giao hàng': 'Delivery dispatch',
  'Buồng phòng': 'Housekeeping', 'Quầy bán hàng POS': 'POS terminal', 'Điều phối phòng khám': 'Clinic desk',
  'Đơn thuốc nhà thuốc': 'Pharmacy prescriptions', 'Lịch lớp và học phí': 'Class schedule & fees',
  'Đào tạo trực tuyến': 'Learning management', 'Sổ sự không phù hợp': 'Nonconformance register',
  'Lịch nhắc và nhật ký gửi': 'Reminders & message log', 'Giao dịch thanh toán': 'Payment transactions',
  'Công tơ và hóa đơn tiện ích': 'Meters & utility bills', 'Cho vay và bảo hiểm': 'Lending & insurance',
  'Sự kiện và quầy vé': 'Events & ticket desk', 'Điều phối hiện trường': 'Field service dispatch',
  'Sàn bất động sản': 'Real estate', 'Điều hành công trường': 'Construction operations',
  'Quản lý dự án': 'Project management', 'Thuê bao và gia hạn': 'Subscriptions & renewals',
  'Chương trình và quỹ': 'Programs & funds', 'Hồ sơ dịch vụ': 'Service cases', 'Lịch hẹn khám': 'Clinic appointments',
  'Lịch dịch vụ': 'Service bookings', 'Mua hàng và nhận hàng': 'Purchasing & receiving',
  'RFQ và so sánh báo giá': 'RFQs & quote comparison', 'Bảo trì tài sản': 'Asset maintenance',
  'Tuyển dụng': 'Recruitment', 'Điều hành bảng lương': 'Payroll operations', 'Nhân sự và chấm công': 'People & attendance',
  'Mục tiêu & đánh giá': 'Goals & reviews', 'Chi phí nhân viên': 'Employee expenses', 'Trả hàng bán': 'Sales returns',
  'Đối soát ngân hàng': 'Bank reconciliation', 'Hoàn tiền điều chỉnh': 'Refund adjustments',
  'Thu/chi phân bổ công nợ': 'Receivables & payables settlement', 'Hóa đơn điện tử': 'E-invoices',
  'Khóa sổ kế toán': 'Accounting period close', 'Đơn hàng online': 'Online orders', 'Điều hành mùa vụ': 'Crop operations',
  'Lễ tân khách sạn': 'Hotel front desk', 'Xưởng sửa chữa': 'Repair workshop', 'Order nhà hàng': 'Restaurant orders',
  'Bán hàng và báo giá': 'Sales & quotations', 'Hàng giữ QC': 'Quality holds', 'Thực hiện ngân sách': 'Budget variance',
  'Pipeline bán hàng': 'Sales pipeline', 'Hiệu quả chiến dịch': 'Campaign performance', 'SLA hỗ trợ': 'Support SLA',
  'Hộp thư hỗ trợ': 'Support inbox', 'Dữ liệu gốc': 'Master data', 'Quản trị': 'Administration', 'Cài đặt': 'Settings',
  'Tổng quan': 'Overview', 'Tìm module hoặc dữ liệu…': 'Search modules or records…',
  'Tìm module hoặc dữ liệu': 'Search modules or records', 'Kết quả tìm kiếm': 'Search results',
  'loại dữ liệu': 'data types', 'Không tìm thấy module hoặc dữ liệu phù hợp.': 'No matching modules or records found.',
  'Định dạng ngày và số': 'Date and number format', 'Ngôn ngữ giao diện': 'Interface language',
  'Tiếng Việt': 'Vietnamese', 'Tiếng Anh': 'English', 'Bảo mật tài khoản': 'Account security',
  'Việt Nam · ngày/tháng/năm': 'Vietnam · day/month/year', 'Hoa Kỳ · tháng/ngày/năm': 'United States · month/day/year',
  'Đăng xuất': 'Sign out', 'Chuyển sang giao diện sáng': 'Switch to light theme',
  'Chuyển sang giao diện tối': 'Switch to dark theme', 'Giao diện sáng': 'Light theme', 'Giao diện tối': 'Dark theme',
  'Lõi': 'Core', 'Bán hàng & khách hàng': 'Sales & customers', 'Chuỗi cung ứng': 'Supply chain', 'Tài chính': 'Finance',
  'Nhân sự': 'People', 'Vận hành': 'Operations', 'Nền tảng dùng chung': 'Shared platform', 'Chuyên ngành': 'Industry',
  'Bán hàng': 'Sales', 'Báo cáo & phân tích': 'Reports & analytics', 'Bảo hiểm': 'Insurance', 'Bảo trì': 'Maintenance',
  'Bất động sản': 'Real estate', 'Chăm sóc khách hàng': 'Customer service', 'Chi phí nhân viên': 'Employee expenses',
  'Cho vay / Tài chính vi mô': 'Lending / Microfinance', 'Cổng thanh toán': 'Payment gateway', 'Cổng tích hợp': 'Integration hub',
  'CRM - Quan hệ khách hàng': 'CRM - Customer relations', 'Đánh giá hiệu suất (OKR)': 'Performance reviews (OKR)',
  'Đào tạo (LMS)': 'Learning management (LMS)', 'Đặt lịch & tài nguyên': 'Bookings & resources',
  'Dịch vụ hiện trường': 'Field service', 'Điện nước / Viễn thông': 'Utilities / Telecom', 'Dữ liệu gốc': 'Master data',
  'Garage / Dịch vụ ô tô-xe máy': 'Garage / Automotive service', 'Gói thuê bao & thu phí định kỳ': 'Subscriptions & recurring billing',
  'Hóa đơn điện tử': 'E-invoicing', 'Hợp đồng': 'Contracts', 'Kế toán': 'Accounting', 'Khách hàng thân thiết': 'Loyalty',
  'Khách sạn / Lưu trú': 'Hotels / Hospitality', 'Kho': 'Inventory', 'Marketing': 'Marketing', 'Mua hàng': 'Purchasing',
  'Ngân sách': 'Budgeting', 'Nhà hàng / F&B': 'Restaurant / Food service', 'Nhà thuốc': 'Pharmacy', 'Nông nghiệp': 'Agriculture',
  'Phê duyệt': 'Approvals', 'Phòng khám / Y tế': 'Clinic / Healthcare', 'POS - Bán lẻ tại quầy': 'POS - Retail',
  'Quản lý chất lượng': 'Quality management', 'Quản lý dự án': 'Project management', 'Quản lý hồ sơ vụ việc': 'Case management',
  'Quản lý tài liệu': 'Document management', 'Sản xuất': 'Manufacturing', 'Sự kiện & bán vé': 'Events & ticketing',
  'Tài sản cố định': 'Fixed assets', 'Thương mại điện tử': 'E-commerce', 'Tính lương': 'Payroll',
  'Trường học / Trung tâm đào tạo': 'Schools / Training centers', 'Truyền thông & thông báo': 'Communications & notifications',
  'Từ thiện / Phi lợi nhuận': 'Charity / Nonprofit', 'Tuyển dụng': 'Recruitment', 'Vận tải & giao hàng': 'Logistics & delivery',
  'Xây dựng': 'Construction',
  'Xin chào': 'Hello', 'Hoạt động gần đây': 'Recent activity', 'Xem tất cả': 'View all', 'Module của bạn': 'Your modules',
  'Gợi ý KPI cho': 'Suggested KPIs for', 'Thêm': 'Add', 'Nhập từ CSV': 'Import CSV',
  'Doanh nghiệp của bạn còn trống': 'Your workspace is empty',
  'Đây là các chỉ tiêu tham khảo. Để xem số liệu thực tế, hãy cấu hình KPI từ báo cáo tổng hợp trong module BI.': 'These are suggested metrics. To see actual values, configure KPIs from aggregate reports in the BI module.',
  'Chưa có hoạt động': 'No activity yet', 'Các bước tự động sẽ hiện ở đây khi phát sinh dữ liệu.': 'Automated steps will appear here when business data is created.',
  'module đang bật': 'modules enabled', 'Bắt đầu quy trình': 'Start the', 'bằng các hồ sơ nền tảng bên dưới.': 'workflow by adding the foundational records below.',
  'doanh nghiệp': 'business', 'Tạo hồ sơ đầu tiên cho doanh nghiệp hoặc nhập dữ liệu CSV.': 'Create the first company record or import a CSV file.',
  'Tác vụ tích hợp cần xử lý': 'Integration tasks need attention', 'Mở danh sách tương ứng để xem chi tiết và xử lý.': 'Open the relevant queue to review and resolve them.',
  'luồng lỗi cần xử lý': 'failed flows need attention', 'giao nhận tích hợp lỗi': 'failed integration deliveries',
  'Mở báo cáo & phân tích': 'Open reports & analytics',
  'Không tải được dữ liệu doanh nghiệp. Vui lòng tải lại trang.': 'Could not load company data. Please reload the page.',
  'Đang ngoại tuyến. Dữ liệu nghiệp vụ không được lưu trên thiết bị; không thể ghi giao dịch cho đến khi kết nối lại.': 'You are offline. Business data is not stored on this device; transactions cannot be saved until you reconnect.',
  'Đã đăng xuất': 'Signed out', 'Phòng ban': 'Department', 'Nhân viên': 'Employee', 'Trạng thái': 'Status',
  'Ngày tạo': 'Created at', 'Cập nhật': 'Updated at', 'Mã': 'Code', 'Tên': 'Name', 'Mô tả': 'Description',
  'Địa chỉ': 'Address', 'Điện thoại': 'Phone', 'Số tiền': 'Amount', 'Ngày': 'Date', 'Bắt đầu': 'Start', 'Kết thúc': 'End',
  'Nháp': 'Draft', 'Mới': 'New', 'Đang hoạt động': 'Active', 'Đã gửi': 'Submitted', 'Chờ xử lý': 'Pending',
  'Đã xác nhận': 'Confirmed', 'Đã duyệt': 'Approved', 'Bị từ chối': 'Rejected', 'Đã hoàn tất': 'Completed',
  'Đã hủy': 'Cancelled', 'Đang thực hiện': 'In progress', 'Đã thanh toán': 'Paid', 'Thất bại': 'Failed',
  'Tiêu đề': 'Title', 'Chủ đề': 'Subject', 'Mã SKU': 'SKU', 'Số': 'Number', 'Ghi chú': 'Notes', 'Loại': 'Type',
  'Đối tác': 'Party', 'Khách hàng': 'Customer', 'Nhà cung cấp': 'Supplier', 'Nhà thầu': 'Contractor', 'Người mua': 'Buyer', 'Sản phẩm': 'Product',
  'Đơn giá': 'Unit price', 'Giá vé (đã gồm thuế)': 'Ticket price (tax included)', 'Giá vốn': 'Cost', 'Tổng tiền': 'Total',
  'Số lượng': 'Quantity', 'Dòng hàng': 'Line items', 'Xác suất (%)': 'Probability (%)', 'Ngày dự kiến chốt': 'Expected close date',
  'Giai đoạn bán hàng': 'Sales stage', 'Đơn vị tính': 'Unit of measure', 'Nhóm': 'Category', 'Đang dùng': 'Active',
  'Mã số thuế': 'Tax ID', 'Chi nhánh': 'Branch', 'Kho': 'Warehouse', 'Nguồn': 'Source', 'Phụ trách': 'Owner',
  'Giai đoạn': 'Stage', 'Công ty': 'Company', 'Hạn': 'Due date', 'Ngày đặt': 'Order date', 'Địa chỉ giao hàng': 'Shipping address',
  'Hình thức': 'Method', 'Phương thức chi': 'Payment method', 'Ngày chi': 'Payment date', 'Ca bán': 'Shift', 'Thu ngân': 'Cashier',
  'Kênh': 'Channel', 'Tiền tệ': 'Currency', 'Ngân sách': 'Budget', 'Từ ngày': 'Start date', 'Đến ngày': 'End date',
  'Hạn thanh toán': 'Due date', 'Người xử lý': 'Assignee', 'Mức ưu tiên': 'Priority', 'Ngày vào làm': 'Hire date',
  'Lương cơ bản': 'Base salary', 'Năm': 'Year', 'Kỳ': 'Period', 'Bảng lương': 'Payroll run', 'Lương gộp': 'Gross pay',
  'Khấu trừ': 'Deductions', 'Thực nhận': 'Net pay', 'Vị trí': 'Position', 'Ứng viên': 'Candidate', 'Học viên': 'Learner',
  'Tiến độ (%)': 'Progress (%)', 'Điểm': 'Score', 'Dự án': 'Project', 'Công việc': 'Task', 'Số giờ': 'Hours',
  'Bắt đầu lúc': 'Starts at', 'Kết thúc lúc': 'Ends at', 'Lý do': 'Reason', 'Lô': 'Lot', 'Hạn dùng': 'Expiry date',
  'Tài sản': 'Asset', 'Vị trí': 'Location', 'Nhân viên': 'Employee', 'Phòng ban': 'Department', 'Chức danh': 'Job title',
  'Không tìm thấy dữ liệu này': 'Record type not found', 'Module có thể chưa được bật cho doanh nghiệp của bạn.': 'This module may not be enabled for your company.',
  'Về trang chủ': 'Back to home', 'Trang chủ': 'Home', 'Xuất CSV': 'Export CSV', 'Nhập CSV': 'Import CSV',
  'Tạo': 'Create',
  'Danh sách': 'List', 'Đang tải danh sách': 'Loading records', 'Chọn': 'Select',
  'Tìm': 'Search', 'Lọc theo trạng thái': 'Filter by status', 'Mọi trạng thái': 'All statuses',
  'Thao tác hàng loạt': 'Bulk actions', 'Đã chọn': 'Selected', 'bản ghi': 'records', 'Đang xử lý…': 'Processing…',
  'Không có kết quả khớp': 'No matching results', 'Chưa có dữ liệu': 'No data yet', 'Thử từ khóa khác hoặc bỏ bộ lọc.': 'Try another search term or clear the filters.',
  'Chưa có bản ghi nào trong trang này.': 'There are no records on this page.', 'Tạo bản ghi': 'Create record',
  'Chọn tất cả bản ghi trên trang': 'Select all records on this page', 'trang': 'page', 'Trước': 'Previous', 'Sau': 'Next',
  'Không xuất được dữ liệu.': 'Could not export data.', 'Không xử lý được các bản ghi đã chọn.': 'Could not process the selected records.',
  'Có': 'Yes', 'Không': 'No', 'Đóng': 'Close', 'Đang tải…': 'Loading…', 'Không mở được bản ghi': 'Could not open record',
  'Thông tin': 'Details', 'Hệ quả liên mô-đun': 'Cross-module effects', 'Sửa': 'Edit', 'Xóa': 'Delete',
  'Chưa có sự kiện': 'No events yet', 'Các bước liên mô-đun sẽ xuất hiện tại đây.': 'Cross-module activity will appear here.',
  'Chuỗi sự kiện': 'Event timeline', 'Mở bản ghi': 'Open record', 'Thông tin bản ghi': 'Record details',
  'Các bước đã chạy từ bản ghi này, gồm cả phản ứng tự động ở những mô-đun khác.': 'Actions triggered by this record, including automated responses in other modules.',
  'Số lượng thực tế': 'Counted quantity', 'Lô hàng': 'Lot', 'Vị trí xuất': 'Source location',
  'Vị trí nhận': 'Destination location', 'Nợ': 'Debit', 'CK (%)': 'Discount (%)',
  'Thuế': 'Tax', 'Chọn sản phẩm': 'Select a product', 'Không thuế': 'No tax', 'Không chọn lô': 'No lot selected',
  'Thêm dòng': 'Add line', 'Tạm tính': 'Subtotal', 'Vị trí kiểm kê': 'Count location', 'Không chỉ định vị trí xuất': 'No source location specified',
  'Không chỉ định vị trí nhận': 'No destination location specified', 'Tài khoản': 'Account', 'Chọn tài khoản': 'Select an account',
  'Chưa phân bổ': 'Unallocated', 'Chọn': 'Select', 'Không chọn': 'Do not select', 'Quản lý': 'Manage',
  'Chưa lưu được': 'Could not save', 'Tự tính': 'Calculated automatically', 'Hủy': 'Cancel', 'Đang lưu…': 'Saving…',
  'Lưu thay đổi': 'Save changes', 'Tạo mới': 'Create', 'Đã lưu thay đổi.': 'Changes saved.', 'Không lưu được dữ liệu.': 'Could not save data.',
  'Tệp sao kê CSV hoặc CAMT.053': 'CSV or CAMT.053 statement file', 'Đang nhập…': 'Importing…', 'Nhập': 'Import',
  'Số lượng dòng': 'Line quantity', 'Đơn giá dòng': 'Line unit price', 'Chiết khấu dòng': 'Line discount', 'Thuế dòng': 'Line tax',
  'Lô hàng dòng': 'Line lot', 'Xóa dòng': 'Remove line', 'Sản phẩm dòng': 'Line product', 'Tài khoản dòng': 'Line account',
  'Phòng ban dòng': 'Line department', 'Nợ dòng': 'Line debit', 'Có dòng': 'Line credit',
  'dòng': 'line', 'Bin chưa gán': 'Unassigned bin', 'Select product': 'Select a product', 'No lot': 'No lot',
  'No lot selected': 'No lot selected', '— Chọn sản phẩm —': '— Select a product —', '— Chọn tài khoản —': '— Select an account —',
  '— Chọn —': '— Select —', '— Không chọn —': '— None —', 'Không chỉ định vị trí xuất': 'No source location specified',
  'Không chỉ định vị trí nhận': 'No destination location specified', 'bắt buộc': 'required',
  'Quầy bán hàng POS': 'POS terminal', 'Mở ca theo kho, ghi nhận hàng bán và phương thức thanh toán; giá và thuế cuối cùng do máy chủ tính theo danh mục.': 'Open a shift by warehouse, record sales and payment methods; the server calculates final prices and taxes from the catalog.',
  'Ca đang mở': 'Open shift', 'Chưa chọn ca': 'No shift selected', 'Không gán chi nhánh': 'No branch assigned',
  'Ca cũ chưa có kho': 'Legacy shift has no warehouse', 'Thu ngân': 'Cashier', 'Kho:': 'Warehouse:',
  'Ca cũ chưa khai báo kho': 'Legacy shift has no warehouse configured', 'Tiền đầu ca:': 'Opening cash:',
  'Chưa có ca mở. Tạo ca mới để bắt đầu bán.': 'No open shift. Open a new shift to start selling.',
  'Mở ca mới': 'Open a new shift', 'Kho bán hàng *': 'Sales warehouse *', 'Chọn kho': 'Select a warehouse',
  'Chi nhánh': 'Branch', 'Tiền đầu ca': 'Opening cash', 'Đang mở…': 'Opening…', 'Mở ca': 'Open shift',
  'Chọn một ca đang mở hoặc mở ca mới để sử dụng quầy.': 'Select an open shift or open a new one to use the POS terminal.',
  'Ca này được tạo trước khi bắt buộc chọn kho. Hãy chốt ca cũ và mở ca mới để tiếp tục bán.': 'This shift predates the warehouse requirement. Close the legacy shift and open a new one to continue selling.',
  'Tiền mặt thực đếm để chốt ca': 'Counted cash to close shift', 'Chốt ca cũ': 'Close legacy shift',
  'Sản phẩm': 'Products', 'Quét/nhập tên, SKU hoặc mã vạch': 'Scan or enter a name, SKU, or barcode',
  'Quét barcode hoặc tìm sản phẩm': 'Scan a barcode or search products',
  'Đặt con trỏ trong ô tìm kiếm rồi quét mã; máy quét gửi Enter để thêm đúng một sản phẩm vào giỏ.': 'Focus the search box and scan a code; the scanner sends Enter to add one matching product to the cart.',
  'Không mã': 'No SKU', 'Quản lý tồn kho': 'Inventory tracked', 'Không có sản phẩm phù hợp.': 'No matching products.',
  'Đơn hàng': 'Order', 'Đơn vị bán': 'Sales unit', 'đơn vị gốc': 'base unit', 'sp': 'unit',
  'Chọn sản phẩm để thêm vào đơn.': 'Select products to add them to the order.', 'Khách hàng': 'Customer',
  '(tùy chọn)': '(optional)', 'Khách lẻ': 'Walk-in customer', 'Mã voucher thành viên': 'Loyalty voucher code',
  'Cần chọn khách hàng đã đăng ký thành viên; mã chỉ được sử dụng một lần.': 'Select a loyalty member first; each voucher can only be used once.',
  'Đơn thuốc': 'Prescription', 'Chọn đơn còn thuốc được kê': 'Select a valid prescription with remaining quantities',
  'cấp một phần': 'partially dispensed', 'đã xác minh': 'verified', 'hết hạn': 'expires',
  'Thuốc kê đơn chỉ được bán theo đơn còn hạn, đúng khách hàng; số lượng bán cộng dồn không vượt số lượng kê.': 'Prescription medicines require a valid prescription for this customer; cumulative dispensed quantities cannot exceed prescribed quantities.',
  'Thanh toán': 'Payment', 'Tiền mặt': 'Cash', 'Thẻ': 'Card', 'Chuyển khoản': 'Bank transfer', 'Ví điện tử': 'E-wallet',
  'Khách đưa': 'Cash received', 'Nhập số tiền nhận': 'Enter amount received', 'Tạm tính': 'Subtotal', 'Tiền hàng': 'Merchandise',
  'Thuế ước tính': 'Estimated tax', 'Thuế và số tiền chính thức do máy chủ tính theo danh mục khi tạo đơn.': 'The server calculates final tax and totals from the catalog when the order is created.',
  'Đang xử lý…': 'Processing…', 'Tạo đơn & thanh toán ·': 'Create order & pay ·', 'Đơn chờ xử lý': 'Pending orders',
  'Hoàn tất': 'Complete', 'Hủy': 'Cancel', 'Giao dịch gần đây': 'Recent transactions', 'Mặt hàng': 'Item',
  'Lý do hoàn:': 'Refund reason:', 'In biên nhận': 'Print receipt', 'Hoàn toàn bộ': 'Refund full order',
  'Chưa có giao dịch hoàn tất trong danh sách gần đây.': 'No completed transactions in recent activity.',
  'Thu / chi quỹ tiền mặt': 'Cash drawer movements', 'Loại giao dịch': 'Transaction type', 'Chi tiền': 'Cash out',
  'Nộp tiền vào quỹ': 'Cash in', 'Số tiền': 'Amount', 'Tài khoản đối ứng': 'Offset account', 'Chọn tài khoản': 'Select an account',
  'Lý do': 'Reason', 'Ghi nhận': 'Record', 'Nộp quỹ': 'Cash in', 'Chi quỹ': 'Cash out', 'Ghi sổ': 'Post',
  'Tiền mặt thực đếm khi chốt ca': 'Counted cash at shift close', 'Chốt ca': 'Close shift',
  'Xóa các mặt hàng trong giỏ trước khi chốt ca.': 'Remove all items from the cart before closing the shift.',
  'Cửa hàng': 'Store', 'BIÊN NHẬN BÁN HÀNG': 'SALES RECEIPT', 'Mã đơn:': 'Order ID:', 'Thời gian:': 'Time:',
  'Khách hàng:': 'Customer:', 'ĐÃ HOÀN TIỀN': 'REFUNDED', 'Chiết khấu': 'Discount', 'Thuế': 'Tax',
  'Tổng cộng': 'Total', 'Thanh toán:': 'Payment:', 'Tiền thối:': 'Change due', 'Cảm ơn quý khách!': 'Thank you!',
  'Không tải được dữ liệu quầy POS.': 'Could not load POS data.', 'Đã mở ca bán hàng.': 'Sales shift opened.',
  'Không mở được ca bán hàng.': 'Could not open the sales shift.', 'Đã thêm': 'Added', 'vào giỏ.': 'to cart.',
  'Mã': 'Code', 'khớp với nhiều sản phẩm. Hãy kiểm tra lại barcode và SKU trong danh mục.': 'matches multiple products. Check the barcode and SKU in the catalog.',
  'Chưa thể hoàn tất đơn hàng.': 'Could not complete the order.', 'Đã lưu đơn chờ thanh toán': 'Saved pending order',
  'Mở mục đơn chờ bên dưới để hoàn tất hoặc xóa đơn.': 'Use the pending orders list below to complete or remove it.',
  'Đã thanh toán': 'Paid', 'Không tạo được đơn POS.': 'Could not create the POS order.',
  'Nhập số tiền khách đưa bằng hoặc lớn hơn tổng đơn tiền mặt.': 'Enter cash received equal to or greater than the cash order total.',
  'Đã hoàn tất đơn': 'Order completed', 'Không hoàn tất được đơn. Kiểm tra lại tồn kho và thử lại.': 'Could not complete the order. Check inventory and try again.',
  'Đã hủy đơn chờ.': 'Pending order cancelled.', 'Không hủy được đơn chờ.': 'Could not cancel the pending order.',
  'Lý do hoàn đơn (5–500 ký tự):': 'Refund reason (5–500 characters):',
  'Lý do hoàn đơn cần từ 5 đến 500 ký tự.': 'The refund reason must be 5–500 characters.',
  'Đã hoàn toàn bộ giao dịch': 'Transaction fully refunded',
  'Không hoàn được giao dịch. Với tiền mặt, cần ca đang mở cùng thu ngân và chi nhánh với ca bán.': 'Could not refund the transaction. Cash refunds require an open shift with the same cashier and branch as the sale.',
  'Đã ghi nhận tiền nộp thêm vào quỹ.': 'Cash added to the drawer.', 'Đã ghi nhận khoản chi từ quỹ.': 'Cash withdrawal recorded.',
  'Không ghi nhận được giao dịch quỹ.': 'Could not record the cash movement.', 'Đã ghi sổ phiếu thu chi.': 'Cash movement posted.',
  'Không ghi sổ được phiếu thu chi.': 'Could not post the cash movement.', 'Đã xóa phiếu nháp.': 'Draft movement deleted.',
  'Không xóa được phiếu nháp.': 'Could not delete the draft movement.', 'Đã chốt ca. Tiền kỳ vọng': 'Shift closed. Expected cash',
  'chênh lệch': 'difference', 'Không chốt được ca. Hãy xử lý hết đơn chờ và phiếu thu chi nháp trước.': 'Could not close the shift. Complete pending orders and post or remove draft cash movements first.',
  'Làm mới': 'Refresh', 'Đơn vị bán': 'Sales unit', 'Giảm': 'Decrease', 'Tăng': 'Increase',
  'Mở': 'Open',
  'Tiền khách đưa cho đơn': 'Cash received for order',
  'Mở mục đơn chờ bên dưới để hoàn tất hoặc xóa đơn.': 'Use the pending orders list below to complete or remove it.',
  'trị giá': 'worth', 'Hoàn toàn bộ giao dịch': 'Refund transaction',
  'Hàng hóa theo dõi tồn kho sẽ được nhập lại và chứng từ kế toán sẽ được đảo.': 'Tracked inventory will be returned to stock and the accounting entry will be reversed.',
  'Tạo đơn & thanh toán ·': 'Create order & pay ·', 'Thanh toán:': 'Payment:', 'Khách đưa:': 'Cash received:',
  'Trả hàng bán': 'Sales returns', 'Trả hàng và điều chỉnh doanh thu': 'Returns and revenue adjustments',
  'Chỉ nhận trả trên số lượng đủ điều kiện, phê duyệt trước khi nhập kho và tạo credit note theo hóa đơn gốc.': 'Returns are limited to eligible quantities. Approve them before restocking and create a credit note against the original invoice.',
  'Nháp / bị từ chối': 'Draft / rejected', 'Chờ duyệt': 'Awaiting approval', 'Đã duyệt / chờ nhận': 'Approved / awaiting receipt', 'Đã nhập và điều chỉnh': 'Restocked / adjusted',
  'Lập phiếu trả hàng': 'Create return', 'Đơn bán nguồn': 'Source sales order', 'Chọn đơn đã xác nhận': 'Select a confirmed order',
  'Kho nhận hàng trả': 'Return warehouse', 'Kho của đơn bán': 'Sales order warehouse', 'Hóa đơn gốc': 'Original invoice', 'chưa chọn': 'not selected',
  'Hóa đơn gốc cho credit note': 'Original invoice for credit note', 'Chọn hóa đơn đã ghi sổ': 'Select a posted invoice',
  'Đã giao': 'Delivered', 'Còn đủ điều kiện trả': 'Eligible to return', 'Giá bán': 'Sales price', 'Số lượng trả': 'Return quantity',
  'Không còn số lượng đủ điều kiện trả. Đơn có giao vận chỉ tính những mặt hàng đã giao thành công.': 'No eligible quantities remain. For orders with delivery, only successfully delivered items are eligible.',
  'Lý do trả hàng': 'Return reason', 'Lập và gửi duyệt': 'Create and submit for approval',
  'Cần chọn hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt để credit note gắn đúng chứng từ.': 'Select a posted invoice for the sales order before submitting so the credit note links to the correct document.',
  'Phiếu trả hàng': 'Sales return', 'Chưa có phiếu trả hàng.': 'No sales returns yet.', 'Đơn / khách hàng': 'Order / customer',
  'Tổng giảm': 'Credit total', 'Đơn': 'Order', 'Phiếu trả': 'Return', 'Đơn bán': 'Sales order',
  'Tổng credit note dự kiến': 'Expected credit note total', 'Giảm trừ': 'Credit amount', 'Yêu cầu duyệt': 'Approval request', 'mở yêu cầu': 'open request',
  'Gắn hóa đơn': 'Link invoice', 'Duyệt': 'Approve', 'Từ chối': 'Reject', 'Nhận hàng và nhập kho': 'Receive and restock',
  'Cần chọn hóa đơn đã ghi sổ trước khi nhận trả.': 'Select a posted invoice before receiving the return.', 'Mở phiếu': 'Open return',
  'Gửi duyệt lại': 'Resubmit for approval', 'Mở credit note': 'Open credit note', 'Mở đơn bán': 'Open sales order',
  'Khi nhận trả, hàng hóa đủ điều kiện được nhập lại kho và hệ thống tạo credit note gắn với hóa đơn gốc. Nếu khách đã thanh toán, credit note thể hiện số dư hoàn lại; thanh toán hoàn tiền được thực hiện qua quy trình payment kế toán.': 'When a return is received, eligible goods are restocked and the system creates a credit note linked to the original invoice. If the customer has paid, the credit note records the refundable balance; issue the refund through the accounting payment workflow.',
  'Đã lập và gửi duyệt phiếu trả. Số lượng được đối chiếu với hàng đã giao và các phiếu đang xử lý.': 'Return created and submitted for approval. Quantities are checked against delivered goods and returns already in progress.',
  'Đã gửi phiếu trả duyệt.': 'Return submitted for approval.', 'Đã duyệt phiếu trả; kho có thể tiếp nhận hàng.': 'Return approved; the warehouse can receive the goods.',
  'Đã từ chối phiếu trả.': 'Return rejected.', 'Đã nhập lại hàng và tạo credit note để điều chỉnh công nợ khách hàng.': 'Goods restocked and a credit note created to adjust the customer balance.',
  'Đã hủy phiếu trả.': 'Return cancelled.', 'Đã gắn hóa đơn gốc vào phiếu trả.': 'Original invoice linked to the return.',
  'Không tải được đơn bán và phiếu trả hàng.': 'Could not load sales orders and returns.', 'Thao tác không thành công.': 'Action failed.',
  'Chọn một hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt phiếu trả.': 'Select a posted invoice for the sales order before submitting the return.',
  'Nhập số lượng trả và lý do cho ít nhất một mặt hàng.': 'Enter a return quantity and reason for at least one item.',
  'Đã duyệt phiếu trả.': 'Return approved.', 'Hủy phiếu': 'Cancel return',
  'Bán hàng và báo giá': 'Sales and quotations', 'Bán hàng, báo giá và giao hàng': 'Sales, quotations, and delivery',
  'Lập báo giá theo khách hàng, chuyển báo giá được chấp nhận thành đơn, kiểm soát tín dụng và theo dõi giao hàng.': 'Create customer quotations, turn accepted quotes into orders, check credit, and track deliveries.',
  'Không tải được báo giá và đơn bán hàng.': 'Could not load quotations and sales orders.', 'Đã tạo báo giá': 'Quotation created',
  'Máy chủ áp dụng bảng giá hoặc giá danh mục và tính thuế.': 'The server applies the price list or catalog price and calculates tax.',
  'Không tạo được báo giá. Kiểm tra khách hàng, giá và ngày hiệu lực.': 'Could not create the quotation. Check the customer, pricing, and validity date.',
  'Đơn đã xác nhận. Hạn mức tín dụng và tồn khả dụng đã được kiểm tra; hệ thống tạo hóa đơn và chuyến giao nếu có địa chỉ.': 'Order confirmed. Credit limits and available stock were checked; an invoice and delivery are created when an address is provided.',
  'Báo giá đã duyệt; hệ thống tạo đơn bán nháp.': 'Quotation accepted; a draft sales order was created.',
  'Báo giá đã gửi và email chi tiết đã xếp vào hàng đợi gửi.': 'Quotation sent and its email was queued for delivery.',
  'Đã ghi nhận báo giá đã gửi cho khách hàng.': 'Quotation marked as sent to the customer.',
  'Đã đánh dấu báo giá hết hạn.': 'Quotation marked as expired.', 'Đã cập nhật trạng thái chứng từ.': 'Document status updated.',
  'Không cập nhật được chứng từ. Kiểm tra giá, tín dụng và tồn kho.': 'Could not update the document. Check pricing, credit, and inventory.',
  'Đã áp dụng voucher; số tiền và thuế đã được máy chủ tính lại.': 'Voucher applied; the server recalculated the amount and tax.',
  'Đã gỡ voucher khỏi đơn nháp.': 'Voucher removed from the draft order.',
  'Không áp dụng được voucher. Kiểm tra ngày hiệu lực, thành viên và mã.': 'Could not apply the voucher. Check its validity dates, membership, and code.',
  'Đã tạo vận đơn': 'Shipment created', 'cho số lượng được chọn.': 'for the selected quantities.',
  'Không tạo được vận đơn. Hệ thống kiểm tra lại lượng còn giao trên đơn.': 'Could not create the shipment. The system rechecked the remaining quantities on the order.',
  'Đã lập phiếu trả': 'Return created', 'Gửi duyệt để nhận hàng và lập chứng từ giảm công nợ.': 'Submit it for approval to receive the goods and create a customer credit document.',
  'Không lập được phiếu trả. Kiểm tra số lượng đã giao và các phiếu trả trước.': 'Could not create the return. Check delivered quantities and earlier returns.',
  'Đã duyệt phiếu trả; hàng có thể được nhận về kho.': 'Return approved; the warehouse can receive the goods.',
  'Đã từ chối yêu cầu trả hàng.': 'Return request rejected.', 'Không cập nhật được quyết định phê duyệt.': 'Could not update the approval decision.',
  'Lập báo giá': 'Create quotation', 'Khách hàng / đại lý': 'Customer / reseller', 'Chọn khách hàng': 'Select a customer',
  'Kho xuất': 'Fulfillment warehouse', 'Bảng giá': 'Price list', 'Giá bán mặc định': 'Default sales price', 'Ngày hết hạn': 'Valid until',
  'Nhập để tạo chuyến giao khi xác nhận đơn': 'Enter an address to create a delivery when the order is confirmed',
  'Đơn vị bán': 'Sales unit', 'đơn vị': 'unit', 'đơn vị gốc': 'base unit', 'Số lượng': 'Quantity',
  'Tạm tính theo bảng giá, chưa gồm thuế': 'Price list estimate, before tax', 'Đang tạo…': 'Creating…', 'Lưu báo giá nháp': 'Save draft quotation',
  'Báo giá': 'Quotation', 'hết hạn': 'expires', 'không đặt ngày hết hạn': 'no expiry date set', 'Quá hạn': 'Expired',
  'Gửi báo giá': 'Send quotation', 'Khách duyệt': 'Customer accepts', 'Khách từ chối': 'Customer rejects',
  'Đóng báo giá quá hạn': 'Close expired quotation', 'Chi tiết báo giá': 'Quotation details', 'Mở đơn bán': 'Open sales order',
  'Chưa có báo giá.': 'No quotations yet.', 'Đơn bán và giao hàng': 'Sales orders and delivery',
  'Mở bảng điều phối': 'Open delivery board', 'Bán trực tiếp': 'Counter sale', 'Tổng gồm thuế': 'Total including tax',
  'Voucher thành viên': 'Loyalty voucher', 'Cập nhật voucher': 'Update voucher', 'Áp dụng voucher': 'Apply voucher', 'Giảm trước thuế': 'Pre-tax discount',
  'Chuyến giao': 'Shipment', 'Mở': 'Open', 'Giao phần hàng còn lại': 'Ship remaining quantities',
  'Chỉ tính các vận đơn đang mở hoặc đã giao; vận đơn thất bại không giữ số lượng.': 'Only open or delivered shipments count; failed shipments do not reserve quantities.',
  'còn': 'remaining', 'Số lượng giao': 'Delivery quantity', 'Tạo vận đơn đã chọn': 'Create shipment for selected quantities',
  'Hàng đã được phân công hết. Muốn tách chuyến chưa xuất phát, mở vận đơn nháp và giảm số lượng trước khi điều phối.': 'All goods are assigned. To split a shipment that has not departed, open its draft and reduce its quantities before dispatch.',
  'Xác nhận đơn, giữ tồn và tạo hóa đơn': 'Confirm order, reserve stock, and create invoice', 'Mở hóa đơn': 'Open invoice',
  'Chi tiết đơn': 'Order details', 'Chưa có đơn bán.': 'No sales orders yet.', 'Trả hàng và nhập lại kho': 'Returns and restocking',
  'đã giao': 'delivered', 'còn trả': 'returnable', 'Lập phiếu trả nháp': 'Create draft return',
  'Chưa có số lượng đủ điều kiện trả. Đơn giao hàng chỉ nhận trả hàng đã giao thành công.': 'No eligible quantities remain. Delivery orders only allow returns of successfully delivered goods.',
  'Chưa có đơn đủ điều kiện trả hàng.': 'No orders are eligible for return.', 'Phiếu trả và phê duyệt': 'Returns and approvals',
  'Không ghi lý do': 'No reason provided', 'Giá trị giảm trừ': 'Credit amount', 'Yêu cầu phê duyệt đang chờ': 'Approval pending',
  'Gửi phê duyệt': 'Submit for approval', 'Nhận hàng, nhập kho và lập credit note': 'Receive goods, restock, and create credit note',
  'Chi tiết phiếu': 'Return details', 'Chưa phát sinh phiếu trả hàng.': 'No return requests yet.',
  'RFQ và so sánh báo giá': 'RFQ and quote comparison',
  'Mỗi nhà cung cấp nhận một hồ sơ riêng cho cùng danh sách hàng. So sánh tổng giá sau thuế, hạn hiệu lực và chọn duy nhất một báo giá để chuyển thành đơn mua.': 'Each supplier receives a separate request for the same items. Compare tax-inclusive totals and validity dates, then select one quote to convert into a purchase order.',
  'Không tải được hồ sơ RFQ và đề nghị mua cạnh tranh.': 'Could not load RFQs and competitive purchase requests.',
  'Không cập nhật được hồ sơ báo giá.': 'Could not update the quotation record.', 'Đã lập hồ sơ RFQ cho nhà cung cấp. Gửi yêu cầu, sau đó ghi báo giá nhận được vào đúng hồ sơ.': 'RFQ created for the supplier. Send the request, then record the received quote in its matching RFQ.',
  'Nhập đơn giá lớn hơn 0 cho mọi dòng báo giá.': 'Enter a unit price greater than zero for every quotation line.', 'Đã lưu báo giá và đưa vào bảng so sánh.': 'Quote saved and added to the comparison.',
  'RFQ đã được đánh dấu gửi và email mời báo giá đã xếp vào hàng đợi gửi.': 'RFQ marked as sent and the invitation email queued for delivery.',
  'Đã ghi nhận yêu cầu báo giá đã gửi cho nhà cung cấp.': 'RFQ marked as sent to the supplier.',
  'Đã chọn báo giá. Đơn mua nháp đã được tạo; các báo giá cạnh tranh được đóng.': 'Quote selected. A draft purchase order was created and competing quotes were closed.',
  'Đã từ chối báo giá nhà cung cấp.': 'Supplier quote rejected.', 'Đã hủy RFQ nháp.': 'Draft RFQ cancelled.',
  'Đề nghị mua cạnh tranh': 'Competitive purchase requests', 'Đề nghị': 'Request', 'dòng hàng': 'lines', 'dòng': 'line', 'kho': 'warehouse',
  'Chưa có đề nghị mua ở chế độ so sánh báo giá đã được duyệt.': 'No approved purchase requests are configured for quote comparison.',
  'Đề nghị': 'Request', 'Mở đơn mua đã tạo': 'Open created purchase order', 'Hàng yêu cầu': 'Requested item',
  'Hạn nhà cung cấp phản hồi báo giá': 'Supplier quote response deadline', 'Thêm nhà cung cấp vào vòng báo giá…': 'Add supplier to quote round…', 'Tạo RFQ': 'Create RFQ',
  'Nhà cung cấp / hồ sơ': 'Supplier / request', 'Báo giá từng dòng': 'Line quotes', 'Tổng sau thuế': 'Tax-inclusive total', 'Hiệu lực': 'Validity',
  'Trạng thái / thao tác': 'Status / actions', 'Hàng hóa': 'Item', 'Đơn giá báo': 'Quoted unit price', 'Thuế báo giá': 'Quote tax',
  'Không thuế': 'No tax', 'Chưa báo giá': 'No quote yet', 'Phản hồi trước': 'Response due', 'Số tham chiếu báo giá': 'Quote reference',
  'Số báo giá': 'Quote number', 'Ngày hết hạn báo giá': 'Quote expiry date', 'Không giới hạn': 'No expiry',
  'Gửi lời mời báo giá': 'Send quote invitation', 'Ghi nhận đã gửi': 'Mark as sent', 'Lưu báo giá': 'Save quote', 'Chọn báo giá': 'Select quote',
  'Chưa có nhà cung cấp nào trong vòng báo giá.': 'No suppliers have been added to this quote round.', 'Đã chọn': 'Selected', 'với tổng': 'with a total of',
  'Các báo giá còn lại đã được đóng.': 'The remaining quotes were closed.',
  'Mua hàng và nhận hàng': 'Purchasing and receiving',
  'Lập đơn mua, gửi duyệt, nhận đủ hoặc từng phần vào kho và theo dõi hóa đơn nhà cung cấp.': 'Create purchase orders, submit them for approval, receive goods in full or in part, and track supplier invoices.',
  'Không tải được đơn mua và phiếu nhận hàng.': 'Could not load purchase orders and receipts.', 'Nháp / bị trả': 'Draft / rejected',
  'Đang nhận hàng': 'Receiving', 'Đã nhận đủ': 'Fully received', 'Sửa đề nghị mua nháp': 'Edit draft purchase request',
  'Đề nghị mua nội bộ': 'Internal purchase request', 'Thoát chỉnh sửa': 'Exit edit mode',
  'Ghi nhu cầu hàng hóa và kho nhận. Sau khi phê duyệt, hệ thống sinh đơn mua nháp có liên kết nguồn; đơn mua vẫn cần giá và phê duyệt riêng trước khi đặt hàng.': 'Record the required goods and receiving warehouse. After approval, the system creates a linked draft purchase order; pricing and order approval are still required before placing it.',
  'Phương thức mua': 'Sourcing method', 'Mua trực tiếp': 'Direct purchase', 'So sánh báo giá nhà cung cấp': 'Compare supplier quotes',
  'Nhà cung cấp': 'Supplier', 'Chọn nhà cung cấp': 'Select a supplier', 'Kho nhận': 'Receiving warehouse', 'Chọn kho': 'Select a warehouse',
  'Người yêu cầu': 'Requested by', 'Lý do / mục đích': 'Reason / purpose', 'Danh sách hàng cần mua': 'Requested items', 'Thêm dòng': 'Add line',
  'Chọn hàng hóa': 'Select an item', 'Chọn đơn vị': 'Select a unit', 'Số lượng cần mua': 'Quantity requested', 'Xóa dòng đề nghị': 'Remove request line',
  'Bỏ': 'Remove', 'Lưu đề nghị nháp': 'Save draft request', 'Tạo đề nghị nháp': 'Create draft request',
  'Đề nghị': 'Request', 'Người yêu cầu / lý do': 'Requested by / reason', 'Hàng / số lượng': 'Items / quantities', 'Trạng thái / thao tác': 'Status / actions',
  'Đề nghị mua': 'Purchase request', 'Kho:': 'Warehouse:', 'Đơn mua nháp đã sinh': 'Draft purchase order created',
  'Không có lý do': 'No reason provided', 'Hàng hóa': 'Item', 'Mở yêu cầu duyệt': 'Open approval request', 'Sửa': 'Edit',
  'Gửi duyệt': 'Submit for approval', 'Duyệt': 'Approve', 'Từ chối': 'Reject',
  'Chưa có đề nghị mua nội bộ. Bạn cũng có thể sinh đề nghị từ màn bổ sung tồn kho.': 'No internal purchase requests yet. You can also create requests from the replenishment screen.',
  'Sửa đơn mua nháp': 'Edit draft purchase order', 'Lập đơn mua trực tiếp': 'Create direct purchase order',
  'Ngày giao dự kiến': 'Expected delivery date', 'Vật tư / hàng hóa': 'Materials / goods', 'Chọn hàng': 'Select an item',
  'Đơn vị gốc': 'Base unit', 'Số lượng đặt': 'Order quantity', 'Đơn giá mua': 'Purchase unit price', 'Thuế': 'Tax',
  'Tổng dự kiến có thuế': 'Estimated total including tax', 'Lưu đơn mua nháp': 'Save draft purchase order', 'Tạo đơn mua nháp': 'Create draft purchase order',
  'Chưa có đơn mua. Tạo đơn mua nháp, gửi duyệt rồi nhận hàng theo số lượng thực tế.': 'No purchase orders yet. Create a draft, submit it for approval, then receive the actual quantities.',
  'Đơn mua hàng': 'Purchase orders', 'Giao dự kiến': 'Expected delivery', 'Tổng': 'Total', 'Nguồn': 'Source',
  'Đã cập nhật đơn mua nháp.': 'Draft purchase order updated.',
  'Đã tạo đơn mua nháp; tổng tiền và thuế được tính lại trên máy chủ.': 'Draft purchase order created; the server recalculated totals and tax.',
  'Đã cập nhật đề nghị mua nháp.': 'Draft purchase request updated.', 'Đã tạo đề nghị mua nháp.': 'Draft purchase request created.',
  'Đã gửi đề nghị mua đi duyệt.': 'Purchase request submitted for approval.',
  'Đã duyệt đề nghị; hệ thống tạo đơn mua nháp để bổ sung báo giá và trình duyệt riêng.': 'Purchase request approved; a draft purchase order was created for pricing and separate approval.',
  'Đề nghị mua đã bị từ chối.': 'Purchase request rejected.', 'Đã gửi đơn mua đi phê duyệt.': 'Purchase order submitted for approval.',
  'Đã duyệt đơn mua; kho có thể nhận hàng.': 'Purchase order approved; the warehouse can receive goods.',
  'Đã hủy đơn mua.': 'Purchase order cancelled.', 'Đơn mua đã bị từ chối.': 'Purchase order rejected.',
  'Nhập số lượng nhận lớn hơn 0 cho ít nhất một dòng.': 'Enter a received quantity greater than zero for at least one line.',
  'Đã ghi nhận hàng vào kho. Số lượng đã được đối chiếu với đơn mua; đơn tự cập nhật tiến độ nhận.': 'Goods received into inventory. Quantities were checked against the purchase order and its receiving progress updated.',
  'Đã lưu nháp hóa đơn nhà cung cấp. Hãy đối chiếu số hóa đơn và duyệt để ghi nhận công nợ.': 'Supplier invoice draft saved. Check the invoice number and approve it to record accounts payable.',
  'Lý do tranh chấp phải có từ 1 đến 500 ký tự.': 'The dispute reason must be 1–500 characters.',
  'Ghi chú giải quyết phải có từ 1 đến 1.000 ký tự.': 'The resolution note must be 1–1,000 characters.',
  'Không đối chiếu được dòng QC với dòng đơn mua tương ứng.': 'Could not match the quality inspection line to its purchase order line.',
  'Không đối chiếu được mặt hàng QC với dòng hóa đơn nhà cung cấp.': 'Could not match the inspected item to a supplier invoice line.',
  'Số lượng trả không được vượt quá lượng lỗi còn lại từ phiếu kiểm tra.': 'Return quantity cannot exceed the failed quantity remaining from the inspection.',
  'Đã tạo phiếu trả nhà cung cấp từ lượng không đạt trong kiểm tra chất lượng.': 'Supplier return created from the failed quality inspection quantity.',
  'Số lượng trả phải lớn hơn 0 và không vượt quá lượng thực nhận còn lại.': 'Return quantity must be greater than zero and cannot exceed the remaining received quantity.',
  'Không đối chiếu được mặt hàng đã nhận với dòng hóa đơn nhà cung cấp.': 'Could not match the received item to a supplier invoice line.',
  'Đã tạo phiếu trả hàng từ số lượng đã nhận.': 'Return created from the received quantity.',
  'Đã gửi phiếu trả nhà cung cấp để phê duyệt.': 'Supplier return submitted for approval.', 'Đã duyệt phiếu trả nhà cung cấp.': 'Supplier return approved.',
  'Đã từ chối phiếu trả.': 'Return rejected.', 'Đã xuất hàng trả lại nhà cung cấp.': 'Goods dispatched back to the supplier.',
  'Đã hủy phiếu trả nhà cung cấp.': 'Supplier return cancelled.', 'Đã cập nhật phiếu trả nhà cung cấp.': 'Supplier return updated.',
  'Đề xuất bổ sung tồn kho': 'Inventory replenishment suggestions',
  'Tồn khả dụng loại trừ lô hết hạn và hàng giữ để kiểm tra chất lượng; tồn dự kiến tính thêm đơn bán còn phải giao, đơn mua chờ nhận và đề nghị mua mở.': 'Available stock excludes expired lots and quality holds. Projected stock also accounts for undelivered sales orders, purchase orders awaiting receipt, and open purchase requests.',
  'Không tải được đề xuất bổ sung tồn kho.': 'Could not load inventory replenishment suggestions.', 'Định mức bổ sung': 'Reorder rules',
  'Đã tạo đề nghị mua nháp': 'Draft purchase request created', 'Hãy bổ sung nhà cung cấp và đơn giá trước khi gửi duyệt.': 'Add a supplier and unit prices before submitting for approval.',
  'Không tạo được đề nghị mua.': 'Could not create the purchase request.', 'Mở đề nghị mua': 'Open purchase request',
  'Sản phẩm cần xử lý': 'Products to review', 'Dòng cần đặt hàng': 'Lines to order',
  'Tạo đề nghị mua nháp': 'Create draft purchase request', 'Máy chủ tính lại số lượng trước khi tạo': 'The server recalculates quantities before creation',
  'Tạo cho': 'Create for', 'Không có đề xuất bổ sung': 'No replenishment suggestions',
  'Tồn dự kiến ở các định mức đã cấu hình đang trên ngưỡng tối thiểu.': 'Projected stock for configured reorder rules is above the minimum threshold.',
  'Sản phẩm': 'Product', 'Kho': 'Warehouse', 'Tồn khả dụng': 'Available stock', 'Đơn bán chưa giao': 'Undelivered sales orders',
  'Tồn dự kiến': 'Projected stock', 'Đơn mua chờ nhận': 'Purchase orders awaiting receipt', 'Đề nghị mua mở': 'Open purchase requests',
  'Tối thiểu': 'Minimum', 'Mục tiêu': 'Target', 'Đề xuất mua': 'Suggested order',
};

const storedUiLocale = () => {
  try { return localStorage.getItem('osp.uiLocale') === 'en-US' ? 'en-US' : 'vi-VN'; }
  catch { return 'vi-VN'; }
};
export let uiLocale = storedUiLocale();
export const setUiLocale = (locale) => {
  if (locale === 'vi-VN' || locale === 'en-US') uiLocale = locale;
};
export const uiText = (text) => uiLocale === 'en-US' ? (UI_TEXT_EN[text] || text) : text;

const humanize = (s) => {
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const FIELD_LABEL_EN = { debit: 'Debit', credit: 'Credit' };
export const fieldLabel = (name) => uiLocale === 'en-US' ? (FIELD_LABEL_EN[name] || uiText(FIELDS[name] || humanize(name))) : (FIELDS[name] || humanize(name));
export const statusLabel = (v) => uiText(STATUS[v] || humanize(v));
export const actionLabel = (v) => uiText(ACTIONS[v] || STATUS[v] || humanize(v));
export const tone = (v) => TONE_LOOKUP[v] || '';
export const categoryLabel = (c) => CATEGORY[c] || humanize(c);

const FORMAT_LOCALES = new Set(['vi-VN', 'en-US']);
const storedFormatLocale = () => {
  try {
    const value = localStorage.getItem('osp.formatLocale');
    return FORMAT_LOCALES.has(value) ? value : 'vi-VN';
  } catch {
    return 'vi-VN';
  }
};
export let formatLocale = storedFormatLocale();
export const setFormatLocale = (locale) => {
  if (FORMAT_LOCALES.has(locale)) formatLocale = locale;
};
const numberFormatters = new Map();
const numberFormatter = (locale = formatLocale, options = {}) => {
  const key = `${locale}:${JSON.stringify(options)}`;
  if (!numberFormatters.has(key)) numberFormatters.set(key, new Intl.NumberFormat(locale, options));
  return numberFormatters.get(key);
};
export const fmtNumber = (n, options) => numberFormatter(formatLocale, options).format(n);
export let baseCurrency = 'VND';
const moneyFormatters = new Map();
export const setBaseCurrency = (currency) => {
  if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) baseCurrency = currency;
};
export const fmtMoney = (n, currency = baseCurrency) => {
  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : baseCurrency;
  const key = `${formatLocale}:${code}`;
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(key, new Intl.NumberFormat(formatLocale, {
      style: 'currency', currency: code, maximumFractionDigits: 2,
    }));
  }
  return moneyFormatters.get(key).format(n);
};
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(formatLocale);
}
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(formatLocale, { dateStyle: 'short', timeStyle: 'short', timeZone: businessTimezone });
}
export function fmtTime(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(formatLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: businessTimezone });
}
export function fmtAgo(s) {
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (!Number.isFinite(sec)) return '';
  if (Math.abs(sec) < 45) return uiLocale === 'vi-VN' ? 'vừa xong' : 'just now';
  const absoluteSeconds = Math.abs(sec);
  const [value, unit] = absoluteSeconds < 3600
    ? [Math.round(absoluteSeconds / 60), 'minute']
    : absoluteSeconds < 86400
      ? [Math.round(absoluteSeconds / 3600), 'hour']
      : [Math.round(absoluteSeconds / 86400), 'day'];
  if (uiLocale === 'vi-VN') {
    const unitVi = { minute: 'phút', hour: 'giờ', day: 'ngày' }[unit];
    return `${value} ${unitVi} ${sec > 0 ? 'trước' : 'sau'}`;
  }
  return new Intl.RelativeTimeFormat(uiLocale, { numeric: 'auto' }).format(sec > 0 ? -value : value, unit);
}
