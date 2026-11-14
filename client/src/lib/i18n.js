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
  lot: 'Lô', expiry: 'Hạn dùng', direction: 'Chiều', components: 'Thành phần', output_qty: 'Sản lượng', bom: 'Định mức', planned_start: 'Dự kiến bắt đầu',
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
  min_amount: 'Số tiền tối thiểu', approvers: 'Người duyệt', folder: 'Thư mục', file_url: 'Tệp', version: 'Phiên bản', tags: 'Thẻ',
  signer_email: 'Email người ký', signer_name: 'Tên người ký', clause: 'Điều khoản', value: 'Giá trị', recipient: 'Người nhận',
  widgets: 'Thành phần', query: 'Truy vấn', schedule: 'Lịch chạy', formula: 'Công thức', config: 'Cấu hình', enabled: 'Bật', events: 'Sự kiện', secret: 'Khóa bí mật',
  key: 'Khóa', scopes: 'Phạm vi', dob: 'Ngày sinh', gender: 'Giới tính', blood_type: 'Nhóm máu', allergies: 'Dị ứng', insurance_no: 'Số bảo hiểm',
  patient: 'Bệnh nhân', doctor: 'Bác sĩ', complaint: 'Lý do khám', diagnosis: 'Chẩn đoán', fee: 'Phí khám', encounter: 'Lượt khám', test: 'Xét nghiệm',
  student: 'Học viên', student_code: 'Mã học viên', guardian: 'Phụ huynh', subject_: 'Môn', teacher: 'Giáo viên', tuition: 'Học phí', class: 'Lớp', enrollment: 'Ghi danh', term: 'Học kỳ',
  area: 'Diện tích', property: 'Bất động sản', room_type: 'Loại phòng', room: 'Phòng', floor: 'Tầng', reservation: 'Đặt phòng', check_out_: 'Trả phòng',
  seats: 'Số chỗ', station: 'Khu bếp', available: 'Còn phục vụ', ingredients: 'Nguyên liệu', table: 'Bàn', order: 'Đơn',
  farm: 'Trang trại', crop: 'Cây trồng', planted_on: 'Ngày gieo trồng', expected_harvest: 'Dự kiến thu hoạch', cycle: 'Vụ mùa', grade: 'Phân loại', lot_code: 'Mã lô',
  principal: 'Gốc vay', term_months: 'Kỳ hạn (tháng)', loan: 'Khoản vay', premium: 'Phí bảo hiểm', policy: 'Hợp đồng BH', case: 'Vụ việc', opened_on: 'Ngày mở', who: 'Người thực hiện',
  meter: 'Công tơ', reading: 'Chỉ số', make: 'Hãng', model: 'Dòng xe', vin: 'Số khung', odometer: 'Số km', vehicle_: 'Xe', program: 'Chương trình', venue: 'Địa điểm', event: 'Sự kiện',
  id: 'Mã', createdAt: 'Ngày tạo', updatedAt: 'Cập nhật',
};

const STATUS = {
  released: 'Sẵn sàng trở lại',
  cycle_count: 'Kiểm kê định kỳ', damage: 'Hư hỏng', opening_balance: 'Tồn đầu kỳ', correction: 'Điều chỉnh',
  draft: 'Nháp', new: 'Mới', open: 'Mở', planned: 'Lên kế hoạch', pending: 'Chờ xử lý', cart: 'Giỏ hàng', requested: 'Đã yêu cầu', applied: 'Đã nộp', effective: 'Có hiệu lực', quoted: 'Đã báo giá',
  created: 'Mới tạo', queued: 'Đang chờ', ordered: 'Đã chỉ định', submitted: 'Đã gửi', returned: 'Cần chỉnh sửa', acknowledged: 'Đã xác nhận', intake: 'Tiếp nhận', pledged: 'Cam kết', reserved: 'Đã giữ chỗ', recorded: 'Đã ghi nhận',
  due: 'Đến hạn', booked: 'Đã đặt', available: 'Còn trống', vacant: 'Trống', growing: 'Đang trồng', todo: 'Cần làm', active: 'Đang hoạt động', pause: 'Tạm dừng',
  contacted: 'Đã liên hệ', qualified: 'Đủ điều kiện', disqualified: 'Không đạt', converted: 'Đã chuyển đổi', won: 'Thắng', lost: 'Thua',
  qualification: 'Sơ tuyển', discovery: 'Tìm hiểu nhu cầu', proposal: 'Đề xuất / báo giá', negotiation: 'Thương lượng', unclassified: 'Chưa phân loại',
  sent: 'Đã gửi', accepted: 'Đã chấp nhận', rejected: 'Bị từ chối', confirmed: 'Đã xác nhận', partially_delivered: 'Đã giao một phần', delivered: 'Đã giao', cancelled: 'Đã hủy', completed: 'Hoàn tất',
  refunded: 'Đã hoàn', placed: 'Đã đặt', approved: 'Đã duyệt', sourced: 'Đã chọn nhà cung cấp', received: 'Đã nhận', posted: 'Đã ghi sổ', reversed: 'Đã đảo bút toán', paid: 'Đã thanh toán', void: 'Đã hủy bỏ',
  in_progress: 'Đang thực hiện', doing: 'Đang làm', done: 'Xong', closed: 'Đã đóng', resolved: 'Đã xử lý', launched: 'Đang chạy', paused: 'Tạm dừng',
  dispatched: 'Đã xuất phát', failed: 'Thất bại', issued: 'Đã phát hành', signed: 'Đã ký', sold: 'Đã bán', leased: 'Đã cho thuê', terminated: 'Đã chấm dứt',
  superseded: 'Đã thay thế',
  expired: 'Hết hạn', disposed: 'Đã thanh lý', on_hold: 'Tạm hoãn', succeeded: 'Thành công', hired: 'Đã tuyển', resulted: 'Có kết quả', dispensed: 'Đã phát thuốc',
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
  released: 'Đưa về trạng thái sẵn sàng',
  contacted: 'Đã liên hệ', qualified: 'Đánh giá đủ điều kiện', disqualified: 'Loại', converted: 'Chuyển thành khách hàng', won: 'Thắng', lost: 'Thua',
  sent: 'Gửi', accepted: 'Chấp nhận', rejected: 'Từ chối', confirmed: 'Xác nhận', partially_delivered: 'Ghi nhận giao một phần', delivered: 'Hoàn tất giao hàng', cancelled: 'Hủy',
  completed: 'Hoàn tất', refunded: 'Hoàn tiền', placed: 'Đặt hàng', approved: 'Duyệt', acknowledged: 'Xác nhận đã nhận', returned: 'Trả chỉnh sửa', received: 'Nhận hàng', posted: 'Ghi sổ', reversed: 'Đảo bút toán', paid: 'Đã thanh toán', void: 'Hủy bỏ',
  closed: 'Đóng', resolved: 'Đã xử lý', responded: 'Đã phản hồi', reopened: 'Mở lại', launched: 'Khởi chạy', paused: 'Tạm dừng', resumed: 'Tiếp tục', started: 'Bắt đầu', done: 'Hoàn thành',
  dispatched: 'Xuất phát', failed: 'Thất bại', issued: 'Phát hành', signed: 'Ký', sold: 'Bán', leased: 'Cho thuê', activated: 'Kích hoạt', terminated: 'Chấm dứt',
  superseded: 'Đã thay thế',
  expired: 'Hết hạn', disposed: 'Thanh lý', on_hold: 'Tạm hoãn', succeeded: 'Thành công', hired: 'Tuyển dụng', resulted: 'Có kết quả', dispensed: 'Phát thuốc',
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

const humanize = (s) => {
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const fieldLabel = (name) => FIELDS[name] || humanize(name);
export const statusLabel = (v) => STATUS[v] || humanize(v);
export const actionLabel = (v) => ACTIONS[v] || STATUS[v] || humanize(v);
export const tone = (v) => TONE_LOOKUP[v] || '';
export const categoryLabel = (c) => CATEGORY[c] || humanize(c);

const nf = new Intl.NumberFormat('vi-VN');
export const fmtNumber = (n) => nf.format(n);
export let baseCurrency = 'VND';
const moneyFormatters = new Map();
export const setBaseCurrency = (currency) => {
  if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) baseCurrency = currency;
};
export const fmtMoney = (n, currency = baseCurrency) => {
  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : baseCurrency;
  if (!moneyFormatters.has(code)) {
    moneyFormatters.set(code, new Intl.NumberFormat('vi-VN', {
      style: 'currency', currency: code, maximumFractionDigits: 2,
    }));
  }
  return moneyFormatters.get(code).format(n);
};
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('vi-VN');
}
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
export function fmtTime(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtAgo(s) {
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 45) return 'vừa xong';
  if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.round(sec / 3600)} giờ trước`;
  return `${Math.round(sec / 86400)} ngày trước`;
}
