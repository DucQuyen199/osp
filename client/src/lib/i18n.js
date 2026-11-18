import { businessTimezone } from './dates.js';
import { multiplyDecimals, roundDecimal } from './decimal.js';

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
  checked_in: 'Đã nhận phòng/Check-in', checked_out: 'Đã trả phòng', arrived: 'Khách đã đến', no_show: 'Vắng mặt', occupied: 'Có khách', cleaning: 'Đang dọn', served: 'Đã phục vụ',
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

let UI_TEXT_EN = {};
let uiTranslationsPromise;
let uiTranslationsLoaded = false;
let uiLocaleRequest = 0;
const INTEGRATION_ERROR_VI = {
  'Webhook URL must use HTTPS': 'URL webhook phải dùng HTTPS.',
  'Webhook URL must have a host and cannot include credentials': 'URL webhook phải có máy chủ và không được chứa thông tin đăng nhập.',
  'Webhook URL cannot contain a fragment': 'URL webhook không được chứa fragment.',
  'Webhook URL cannot target a local or private IP address': 'URL webhook không được trỏ tới địa chỉ IP nội bộ hoặc riêng tư.',
  'Webhook URL must be a valid absolute URL': 'URL webhook phải là URL tuyệt đối hợp lệ.',
  'Webhook can subscribe to at most 100 event types': 'Webhook chỉ được đăng ký tối đa 100 loại sự kiện.',
  'Webhook events must be a list of event names': 'Sự kiện webhook phải là danh sách tên sự kiện.',
  'Webhook signing secret must contain 16 to 256 bytes': 'Bí mật ký webhook phải có từ 16 đến 256 byte.',
  'Connector kind must contain 1 to 64 characters': 'Loại connector phải có từ 1 đến 64 ký tự.',
  'Connector name must contain 1 to 120 characters': 'Tên connector phải có từ 1 đến 120 ký tự.',
  'Connector configuration must be an object': 'Cấu hình connector phải là một đối tượng.',
  'Enabled connectors must use the supported http_event_sink adapter': 'Connector đang bật phải dùng adapter http_event_sink được hỗ trợ.',
  'An enabled connector requires the http_event_sink adapter configuration': 'Connector đang bật cần cấu hình adapter http_event_sink.',
  'HTTP connector URL must be a public HTTPS URL without embedded credentials or fragments': 'URL HTTP connector phải là HTTPS công khai, không có thông tin đăng nhập nhúng hoặc fragment.',
  'HTTP connector URL must be a valid absolute URL': 'URL HTTP connector phải là URL tuyệt đối hợp lệ.',
  'HTTP connector requires a URL': 'HTTP connector cần có URL.',
  'HTTP connector must subscribe to 1 to 100 event types': 'HTTP connector phải đăng ký từ 1 đến 100 loại sự kiện.',
  'HTTP connector events must be a list of event names': 'Sự kiện HTTP connector phải là danh sách tên sự kiện.',
  'HTTP connector signing secret must contain 16 to 256 bytes': 'Bí mật ký HTTP connector phải có từ 16 đến 256 byte.',
  'HTTP connector can configure at most 32 headers': 'HTTP connector chỉ được cấu hình tối đa 32 header.',
  'HTTP connector headers must be an object of string values': 'Header HTTP connector phải là đối tượng gồm các giá trị chuỗi.',
  'API key name must contain 1 to 120 characters': 'Tên API key phải có từ 1 đến 120 ký tự.',
  'API key can have at most 100 scopes': 'API key chỉ được có tối đa 100 phạm vi quyền.',
  'API key scopes must be a list': 'Phạm vi API key phải là danh sách.',
  'API key scopes must be valid permission names': 'Phạm vi API key phải là tên quyền hợp lệ.',
  'API key name must be unique within the tenant': 'Tên API key phải là duy nhất trong doanh nghiệp.',
  'Webhook configuration not found': 'Không tìm thấy cấu hình webhook.',
  'Connector configuration not found': 'Không tìm thấy cấu hình connector.',
  'Connector does not have a supported HTTP event adapter': 'Connector không có adapter sự kiện HTTP được hỗ trợ.',
  'Outbox item not found': 'Không tìm thấy mục outbox.',
  'Dead-letter item not found': 'Không tìm thấy mục trong danh sách lỗi cần xử lý.',
  'Unsupported outbox status': 'Trạng thái outbox không được hỗ trợ.',
  'invalid webhook URL': 'URL webhook không hợp lệ.',
  'webhook URL violates HTTPS policy': 'URL webhook không đáp ứng chính sách HTTPS.',
  'webhook URL has no host': 'URL webhook không có tên máy chủ.',
  'webhook DNS resolution failed': 'Không phân giải được DNS của webhook.',
  'webhook host is not publicly routable': 'Máy chủ webhook không thể truy cập công khai.',
  'webhook HTTP client initialization failed': 'Không thể khởi tạo HTTP client cho webhook.',
  'webhook event serialization failed': 'Không thể chuyển sự kiện webhook thành dữ liệu gửi đi.',
  'connector config contains an invalid or reserved HTTP header': 'Cấu hình connector chứa header HTTP không hợp lệ hoặc bị dành riêng.',
  'connector has an invalid HTTP header name': 'Connector có tên header HTTP không hợp lệ.',
  'connector has an invalid HTTP header value': 'Connector có giá trị header HTTP không hợp lệ.',
  'webhook signing configuration is invalid': 'Cấu hình chữ ký webhook không hợp lệ.',
  'webhook connection or TLS request failed': 'Kết nối webhook hoặc yêu cầu TLS không thành công.',
};

const MODULE_NAME_EN = {
  accounting: 'Accounting', agriculture: 'Agriculture', asset: 'Fixed assets', 'auto-service': 'Auto service', bi: 'Reports & analytics',
  booking: 'Booking & resources', budget: 'Budgets', 'case-management': 'Case management', charity: 'Charity / nonprofit',
  clinic: 'Clinic / healthcare', communication: 'Communications & notifications', construction: 'Construction', contract: 'Contracts',
  crm: 'CRM', document: 'Document management', ecommerce: 'E-commerce', einvoice: 'E-invoicing', events: 'Events & ticketing',
  expense: 'Employee expenses', 'field-service': 'Field service', helpdesk: 'Customer support', hotel: 'Hotel & lodging', hrm: 'Human resources',
  insurance: 'Insurance', 'integration-hub': 'Integration hub', inventory: 'Inventory', lending: 'Lending / microfinance', lms: 'Learning management',
  logistics: 'Logistics & delivery', loyalty: 'Loyalty', maintenance: 'Maintenance', manufacturing: 'Manufacturing', marketing: 'Marketing',
  'master-data': 'Master data', payments: 'Payment gateway', payroll: 'Payroll', performance: 'Performance management', pharmacy: 'Pharmacy',
  pos: 'Point of sale', project: 'Projects', purchasing: 'Purchasing', quality: 'Quality management', 'real-estate': 'Real estate',
  recruitment: 'Recruitment', restaurant: 'Restaurant / F&B', sales: 'Sales', school: 'School / training center',
  subscription: 'Subscriptions & recurring billing', utilities: 'Utilities / telecom', 'workflow-approval': 'Approvals',
};

const MODULE_DESCRIPTION_EN = {
  accounting: 'Chart of accounts, invoices, credit adjustments, payments, and balanced journal entries for cross-module workflows.',
  agriculture: 'Farm operations, crop seasons, cultivation supplies, harvests, and traceability. Harvests are received into inventory automatically.',
  asset: 'Register, capitalize, depreciate using the straight-line method, and dispose of fixed assets.',
  'auto-service': 'Track vehicles with increasing odometer readings. Repair orders record intake mileage and parts; completion consumes parts and creates an invoice.',
  bi: 'Dashboards, reports, and KPIs for reading data across modules.',
  booking: 'Book rooms, staff, equipment, tables, and courts for clinics, spas, gyms, salons, and other services.',
  budget: 'Create budgets by period and department, then track actuals.',
  'case-management': 'Manage cases, notes, and billable time for legal, consulting, accounting, government, and nonprofit work.',
  charity: 'Manage programs, donors, and beneficiaries. Donations automatically create receipts.',
  clinic: 'Manage patients, visits, prescriptions, and lab orders. Completed visits create invoices; dispensing reduces inventory.',
  communication: 'Configure email, SMS, Zalo, push, and webhook channels, message templates, and delivery logs. Key events create notifications automatically.',
  construction: 'Manage estimates, job sites, subcontractors, quantity acceptance, and cost commitments.',
  contract: 'Manage contracts, terms, and approved appendices across their effective and expiry dates.',
  crm: 'Manage leads, sales opportunities, and customer activities. Winning an opportunity creates a sales order; converting a lead creates a customer.',
  document: 'Manage folders, versioned documents, and signature requests.',
  ecommerce: 'Manage online stores and web, app, or marketplace orders. Orders can create sales orders, invoices, stock issues, and shipments.',
  einvoice: 'Create issuance requests when accounting invoices are posted. The Rust worker issues or cancels them through a configured HTTPS provider and stores results in PostgreSQL.',
  events: 'Manage events, tickets, and check-in. Published ticket prices include configured tax; ticket sales record revenue and tax.',
  expense: 'Submit, approve, and reimburse employee expense claims.',
  'field-service': 'Manage work orders, technician dispatch, and used materials. Completion consumes inventory and creates an invoice.',
  helpdesk: 'Manage support tickets, SLA policies, and the knowledge base.',
  hotel: 'Manage room types, rooms, reservations, and incidental charges. Checkout creates an invoice and marks the room for cleaning.',
  hrm: 'Manage employee records, departments, job titles, leave, and attendance.',
  insurance: 'Manage policies and claims. Activating a policy collects its premium; paying a claim creates accounting entries.',
  'integration-hub': 'Connect external services such as banks, carriers, e-invoice providers, and Zalo using connectors, webhooks, and API keys.',
  inventory: 'Manage multi-location stock, receipts, issues, lots and expiry, counts, and transfers. Inventory changes stay synchronized with operational modules.',
  lending: 'Manage loans with a nominal annual rate and monthly declining-balance annuities. Generate installments, track overdue debt, and post principal and interest on disbursement and collection.',
  lms: 'Manage courses, lessons, enrollment, and learner progress.',
  logistics: 'Manage vehicles, drivers, routes, and shipments. Orders with a delivery address create shipments; delivery updates the order.',
  loyalty: 'Manage members, reward points, and vouchers. Purchases at POS or confirmed sales orders earn points automatically.',
  maintenance: 'Schedule preventive maintenance and manage repair requests for assets and equipment.',
  manufacturing: 'Manage bills of materials and production orders by work center and daily capacity. Starting an order issues materials to WIP; passed QC receives finished goods. Partial rework, scrap, and independently approved concessions are supported.',
  marketing: 'Manage campaigns, customer segments, and content. Attribute leads to campaigns and measure their performance.',
  'master-data': 'Shared catalogs for all modules: parties, products, branches, units of measure, currencies, and taxes.',
  payments: 'Process transactions through VNPay, MoMo, ZaloPay, Stripe, and bank transfer. Successful payments are recorded in accounting.',
  payroll: 'Manage payroll and payslips. Payslips are locked to a draft run; submitting a run creates an approval request, approval posts journals, and marking it paid creates a payment.',
  performance: 'Manage objectives, key results, and periodic reviews.',
  pharmacy: 'Manage retail prescriptions, pharmacist verification, and dispensing linked to POS transactions.',
  pos: 'Manage sales shifts and counter sales. Completing a sale reduces stock, records payment, and awards loyalty points.',
  project: 'Manage projects, tasks, and timesheets.',
  purchasing: 'Manage purchase requests, quotations, orders, receipts, and supplier invoices. Returns update inventory and adjust the original bill.',
  quality: 'Inspect incoming goods and finished products, retain results, and manage defective quantities through separate reinspection rounds.',
  'real-estate': 'Manage properties, viewings, and leases. A completed sale creates an invoice; activating a rental creates a lease.',
  recruitment: 'Manage job postings, candidates, and applications. Hiring creates an employee record.',
  restaurant: 'Manage tables, menus, recipes, table orders, and kitchen screens. Sending an order to the kitchen creates a kitchen ticket; payment consumes inventory and records revenue.',
  sales: 'Manage quotations, sales orders, price lists, and returns. Shipped orders issue stock after successful delivery; direct sales issue stock when confirmed.',
  school: 'Manage learners, classes, enrollment, grades, and tuition. Issuing tuition creates an invoice; payment updates tuition status.',
  subscription: 'Manage service plans, subscriptions, and billing cycles. Due subscriptions generate invoices automatically.',
  utilities: 'Manage meters, readings, and consumption invoices. Issuing an invoice posts it to accounting; payment updates its status.',
  'workflow-approval': 'Shared approval workflows. Purchase orders and expense requests create approval requests when enabled; approval updates the source document.',
};

export const moduleName = (id, name) => uiLocale === 'en-US' ? (MODULE_NAME_EN[id] || uiText(name)) : name;
export const moduleDescription = (id, description) => uiLocale === 'en-US' ? (MODULE_DESCRIPTION_EN[id] || uiText(description)) : description;

const storedUiLocale = () => {
  try { return localStorage.getItem('osp.uiLocale') === 'en-US' ? 'en-US' : 'vi-VN'; }
  catch { return 'vi-VN'; }
};
export let uiLocale = storedUiLocale();
export const ensureUiTranslations = () => {
  if (uiTranslationsLoaded) return Promise.resolve();
  if (!uiTranslationsPromise) {
    uiTranslationsPromise = import('./ui.en.js').then(({ default: translations }) => {
      UI_TEXT_EN = translations;
      uiTranslationsLoaded = true;
    }).catch((error) => {
      uiTranslationsPromise = undefined;
      throw error;
    });
  }
  return uiTranslationsPromise;
};
export const setUiLocale = async (locale) => {
  if (locale !== 'vi-VN' && locale !== 'en-US') return;
  const request = ++uiLocaleRequest;
  if (locale === 'en-US') await ensureUiTranslations();
  if (request !== uiLocaleRequest) return false;
  uiLocale = locale;
  return true;
};
function dynamicEnglishText(text) {
  const permission = String(text).match(/^Không đủ quyền: (.+)$/);
  if (permission) return `Insufficient permission: ${permission[1]}`;
  const constraint = String(text).match(/^Giá trị vi phạm ràng buộc: (.*)$/);
  if (constraint) return `Value violates a database constraint: ${constraint[1]}`;
  const bodySize = String(text).match(/^Body quá lớn \(>([\d.,]+)KB\)$/);
  if (bodySize) return `Request body is too large (>${bodySize[1]} KB)`;
  const httpStatus = String(text).match(/^Lỗi (\d{3})$/);
  if (httpStatus) return `Request failed (HTTP ${httpStatus[1]})`;
  const rowObject = String(text).match(/^Dòng (\d+) phải là một đối tượng JSON$/);
  if (rowObject) return `Row ${rowObject[1]} must be a JSON object.`;
  const onlyField = String(text).match(/^Cần gửi duy nhất trường ([\w.-]+)$/);
  if (onlyField) return `Send only the ${onlyField[1]} field.`;
  const finiteAmount = String(text).match(/^([\w.-]+) phải là số tiền hữu hạn$/);
  if (finiteAmount) return `${finiteAmount[1]} must be a finite amount.`;
  const mixedTemplates = String(text).match(/^Doanh nghiệp đã chọn mẫu (.+); không thể trộn mẫu (.+)$/);
  if (mixedTemplates) return `This business account already uses template ${mixedTemplates[1]}; it cannot be mixed with ${mixedTemplates[2]}.`;
  const missingParent = String(text).match(/^Mẫu (.+) thiếu tài khoản cha (.+)$/);
  if (missingParent) return `Template ${missingParent[1]} is missing parent account ${missingParent[2]}.`;
  const repairLine = String(text).match(/^Dòng sửa chữa (\d+): (.+)$/);
  if (repairLine) {
    const detail = {
      'dữ liệu dòng không hợp lệ': 'line data is invalid',
      'số lượng phải lớn hơn 0': 'quantity must be greater than zero',
      'đơn giá không thể âm': 'unit price cannot be negative',
      'phải chọn phụ tùng hoặc dịch vụ hợp lệ': 'select a valid part or service',
      'sản phẩm không tồn tại trong doanh nghiệp': 'product does not exist in this business',
      'sản phẩm đã ngừng kinh doanh': 'product is discontinued',
      'sản phẩm chưa có đơn giá hợp lệ': 'product has no valid unit price',
      'phụ tùng theo dõi tồn kho phải chọn sản phẩm': 'a stock-tracked part requires a product',
    }[repairLine[2]];
    if (detail) return `Repair line ${repairLine[1]}: ${detail}.`;
  }
  return undefined;
}

function dynamicVietnameseText(text) {
  const integrationEvent = String(text).match(/^events\[(\d+)\] must be a valid event name$/);
  if (integrationEvent) return `Sự kiện dòng ${integrationEvent[1]} phải là tên sự kiện hợp lệ.`;
  const duplicateHeader = String(text).match(/^HTTP connector header (.+) duplicates another header$/);
  if (duplicateHeader) return `Header HTTP connector ${duplicateHeader[1]} bị trùng.`;
  const invalidHeader = String(text).match(/^HTTP connector header name (.+) is invalid or reserved$/);
  if (invalidHeader) return `Tên header HTTP connector ${invalidHeader[1]} không hợp lệ hoặc bị dành riêng.`;
  const invalidHeaderValue = String(text).match(/^HTTP connector header (.+) must be a string without line breaks and at most 8192 bytes$/);
  if (invalidHeaderValue) return `Header HTTP connector ${invalidHeaderValue[1]} phải là chuỗi không có xuống dòng và tối đa 8192 byte.`;
  return undefined;
}

export const uiText = (text) => uiLocale === 'en-US'
  ? (UI_TEXT_EN[text] || dynamicEnglishText(text) || text)
  : (INTEGRATION_ERROR_VI[text] || dynamicVietnameseText(text) || text);
export const uiTextWith = (text, featureTranslations) => uiLocale === 'en-US'
  ? (featureTranslations?.[text] || uiText(text))
  : uiText(text);

const humanize = (s) => {
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const FIELD_LABEL_EN = { debit: 'Debit', credit: 'Credit' };
export const fieldLabel = (name) => uiLocale === 'en-US' ? (FIELD_LABEL_EN[name] || uiText(FIELDS[name] || humanize(name))) : (FIELDS[name] || humanize(name));
export const statusLabel = (v) => uiText(STATUS[v] || humanize(v));
export const actionLabel = (v) => uiText(ACTIONS[v] || STATUS[v] || humanize(v));
export const tone = (v) => TONE_LOOKUP[v] || '';
export const categoryLabel = (c) => uiText(CATEGORY[c] || humanize(c));

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
const supportsExactNumberStrings = new Intl.NumberFormat('en-US').format('9007199254740993') === '9,007,199,254,740,993';
const exactFormatters = new Map();
function formatExactDecimal(formatter, value) {
  const options = formatter.resolvedOptions();
  if (options.notation !== 'standard'
    || (options.roundingMode && options.roundingMode !== 'halfExpand')
    || (options.roundingIncrement && options.roundingIncrement !== 1)
    || (options.roundingPriority && options.roundingPriority !== 'auto')
    || options.maximumSignificantDigits !== undefined
    || options.minimumSignificantDigits !== undefined) {
    return formatter.format(Number(value));
  }
  const input = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) return formatter.format(Number(value));
  const text = input.replace(/^([+-]?)\./, '$10.');
  const decimal = options.style === 'percent' ? multiplyDecimals([text, '100']) : text;
  const rounded = roundDecimal(decimal, options.maximumFractionDigits);
  const negative = text.startsWith('-');
  const unsigned = rounded.startsWith('-') ? rounded.slice(1) : rounded;
  const [integerPart = '0', rawFraction = ''] = unsigned.split('.');
  const fraction = rawFraction.padEnd(options.minimumFractionDigits, '0');
  const integerValue = BigInt(integerPart || '0');
  const signedInteger = negative ? -integerValue : integerValue;
  const patternValue = integerValue === 0n && negative ? -1n : signedInteger;
  const pattern = formatter.formatToParts(patternValue);
  const numberFormatterKey = `${options.locale}:${options.numberingSystem}:${options.useGrouping}:${options.minimumIntegerDigits}`;
  if (!exactFormatters.has(numberFormatterKey)) {
    exactFormatters.set(numberFormatterKey, new Intl.NumberFormat(options.locale, {
      numberingSystem: options.numberingSystem,
      useGrouping: options.useGrouping,
      minimumIntegerDigits: options.minimumIntegerDigits,
      maximumFractionDigits: 0,
    }));
  }
  const localizedInteger = exactFormatters.get(numberFormatterKey).formatToParts(integerValue)
    .filter((part) => part.type === 'integer' || part.type === 'group');
  const firstNumeric = pattern.findIndex((part) => part.type === 'integer' || part.type === 'group');
  const lastNumeric = pattern.findLastIndex((part) => part.type === 'integer' || part.type === 'group');
  if (firstNumeric < 0 || lastNumeric < firstNumeric) return formatter.format(Number(value));
  const symbolKey = `${options.locale}:${options.numberingSystem}`;
  if (!exactFormatters.has(symbolKey)) {
    const fractionFormatter = new Intl.NumberFormat(options.locale, {
      numberingSystem: options.numberingSystem, useGrouping: false,
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    });
    const digitFormatter = new Intl.NumberFormat(options.locale, {
      numberingSystem: options.numberingSystem, useGrouping: false, maximumFractionDigits: 0,
    });
    exactFormatters.set(symbolKey, {
      decimal: fractionFormatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.',
      digits: Array.from({ length: 10 }, (_, digit) => digitFormatter.format(BigInt(digit))),
    });
  }
  const { decimal: decimalSeparator, digits } = exactFormatters.get(symbolKey);
  const localizedFraction = [...fraction].map((digit) => digits[Number(digit)]).join('');
  const suffix = pattern.slice(lastNumeric + 1).filter((part) => part.type !== 'decimal' && part.type !== 'fraction');
  const output = [
    ...pattern.slice(0, firstNumeric),
    ...localizedInteger,
    ...(localizedFraction ? [{ type: 'decimal', value: decimalSeparator }, { type: 'fraction', value: localizedFraction }] : []),
    ...suffix,
  ];
  return output.map((part) => part.value).join('');
}
const formatNumber = (formatter, value) => typeof value === 'string' && !supportsExactNumberStrings
  ? formatExactDecimal(formatter, value)
  : formatter.format(value);
export const fmtNumber = (n, options) => formatNumber(numberFormatter(formatLocale, options), n);
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
  return formatNumber(moneyFormatters.get(key), n);
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
