import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';
import { listHref, recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const rotationEmployees = (row) => Array.isArray(row?.employees) ? row.employees : row?.employee ? [row.employee] : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const weekdayOptions = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']];
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const nowIso = () => {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = Math.abs(offsetMinutes);
  const localTimestamp = new Date(now.getTime() + offsetMinutes * 60000).toISOString().slice(0, -1);
  return `${localTimestamp}${sign}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`;
};
const localDateTimeIso = (date, time) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = new Date(year, month - 1, day, hour, minute);
  const offsetMinutes = -local.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = Math.abs(offsetMinutes);
  return `${date}T${time}:00${sign}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`;
};
const nextLocalDate = (date) => { const [year, month, day] = date.split('-').map(Number); const value = new Date(year, month - 1, day + 1); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; };
const addLocalDays = (date, days) => { const [year, month, day] = date.split('-').map(Number); const value = new Date(year, month - 1, day + days); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; };
const nextMonthStart = (date) => { const [year, month] = date.split('-').map(Number); const value = new Date(year, month, 1); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`; };
const fmtTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '--';
async function listAllRows(entity, filters = {}) {
  const rows = [];
  let total = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < total; offset += 1000) {
    const query = new URLSearchParams({ ...filters, limit: '1000', offset: String(offset) });
    const response = await api(`${dataPath(entity)}?${query}`);
    const items = itemsOf(response);
    rows.push(...items);
    total = Number(response?.total ?? rows.length);
    if (!items.length) break;
  }
  return { items: rows, total };
}

export default function HrmOperationsPage() {
  const [employees, setEmployees] = useState([]);
  const [employeeMap, setEmployeeMap] = useState(new Map());
  const [departments, setDepartments] = useState(new Map());
  const [positions, setPositions] = useState(new Map());
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [schedulePatterns, setSchedulePatterns] = useState([]);
  const [scheduleTemplates, setScheduleTemplates] = useState([]);
  const [salaryRevisions, setSalaryRevisions] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(localDate());
  const [punchEmployee, setPunchEmployee] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' });
  const [leaveForm, setLeaveForm] = useState({ employee: '', kind: 'annual', start_date: '', end_date: '', partial_day: 'full', pay_treatment: 'paid', reason: '' });
  const [revisionForm, setRevisionForm] = useState({ employee: '', effective_from: '', base_salary: '', reason: '' });
  const [scheduleForm, setScheduleForm] = useState({ employee: '', work_date: localDate(), is_working: true, start_time: '09:00', end_time: '17:00', break_minutes: '60' });
  const [patternForm, setPatternForm] = useState({ employees: [], start_date: localDate(), end_date: addLocalDays(localDate(), 27), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', cycle: [{ is_working: true, start_time: '09:00', end_time: '17:00', break_minutes: 60 }, { is_working: false, start_time: '', end_time: '', break_minutes: 0 }] });
  const [scheduleTemplateName, setScheduleTemplateName] = useState('');
  const [scheduleTemplateId, setScheduleTemplateId] = useState('');
  const [patternEmployeeFilter, setPatternEmployeeFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const scheduleMonth = scheduleForm.work_date.slice(0, 7);
  const scheduleMonthStart = `${scheduleMonth}-01`;
  const scheduleMonthEnd = nextMonthStart(scheduleForm.work_date);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [employeeRes, leaveRes, attendanceRes, revisionRes, allocationRes, scheduleRes, patternRes, templateRes, departmentMap, positionMap, requestRes] = await Promise.all([
        can('hrm.employee.read') ? api(`${dataPath('hrm.employee')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.leave_request.read') ? api(`${dataPath('hrm.leave_request')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.attendance.read') ? api(`${dataPath('hrm.attendance')}?limit=3000`) : Promise.resolve({ items: [] }),
        can('hrm.salary_revision.read') ? loadAllResponse('hrm.salary_revision') : Promise.resolve({ items: [] }),
        can('hrm.leave_allocation.read') ? api(`${dataPath('hrm.leave_allocation')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_entry.read') ? listAllRows('hrm.work_schedule_entry', { work_date__gte: scheduleMonthStart, work_date__lt: scheduleMonthEnd, sort: 'work_date' }) : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_pattern.read') ? loadAllResponse('hrm.work_schedule_pattern') : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_template.read') ? loadAllResponse('hrm.work_schedule_template') : Promise.resolve({ items: [] }),
        can('hrm.department.read') ? loadRefs('hrm.department') : Promise.resolve(new Map()),
        can('hrm.position.read') ? loadRefs('hrm.position') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const employeeRows = itemsOf(employeeRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      setEmployees(employeeRows); setEmployeeMap(new Map(employeeRows.map((row) => [row.id, row])));
      setLeaveRequests(itemsOf(leaveRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setAttendance(itemsOf(attendanceRes).filter((row) => row.date === attendanceDate).sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || ''))));
      setSalaryRevisions(itemsOf(revisionRes).sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || ''))));
      setAllocations(itemsOf(allocationRes)); setDepartments(departmentMap); setPositions(positionMap); setApprovalRequests(itemsOf(requestRes));
      setScheduleEntries(itemsOf(scheduleRes).sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || ''))));
      setSchedulePatterns(itemsOf(patternRes).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))));
      setScheduleTemplates(itemsOf(templateRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi')));
      const activeEmployee = employeeRows.find((row) => row.status === 'active');
      setPunchEmployee((id) => employeeRows.some((row) => row.id === id && row.status === 'active') ? id : activeEmployee?.id || '');
      setLeaveForm((form) => ({ ...form, employee: employeeRows.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
      setRevisionForm((form) => ({ ...form, employee: employeeRows.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
      setScheduleForm((form) => ({ ...form, employee: employeeRows.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
      setPatternForm((form) => ({ ...form, employees: form.employees.filter((id) => employeeRows.some((row) => row.id === id && row.status === 'active')) }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu nhân sự.'); }
    finally { if (!quiet) setLoading(false); }
  }, [attendanceDate, scheduleMonthStart, scheduleMonthEnd, workflowApproval]);

  useEffect(() => { document.title = 'Vận hành nhân sự · OSP Suite'; load(); }, [load]);
  const activeEmployees = employees.filter((row) => row.status === 'active');
  const pendingLeaves = leaveRequests.filter((row) => row.status === 'submitted');
  const pendingRevisions = salaryRevisions.filter((row) => row.status === 'submitted');
  const matchingPatternEmployees = activeEmployees.filter((row) => `${row.name || ''} ${row.code || ''}`.toLocaleLowerCase('vi').includes(patternEmployeeFilter.trim().toLocaleLowerCase('vi'))).slice(0, 50);
  const scheduleEntriesThisMonth = scheduleEntries.filter((row) => String(row.work_date || '').startsWith(scheduleForm.work_date.slice(0, 7)));
  const attendanceByEmployee = useMemo(() => new Map(attendance.map((row) => [row.employee, row])), [attendance]);
  const incompleteAttendance = attendance.filter((row) => row.check_in && !row.check_out).length;

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createEmployee(event) {
    event.preventDefault();
    const body = { name: employeeForm.name.trim(), code: employeeForm.code.trim() || undefined, department: employeeForm.department || undefined, position: employeeForm.position || undefined, email: employeeForm.email.trim() || undefined, phone: employeeForm.phone.trim() || undefined, hire_date: employeeForm.hire_date || undefined, base_salary: employeeForm.base_salary ? Number(employeeForm.base_salary) : undefined, work_weekdays: employeeForm.customSchedule ? employeeForm.work_weekdays : undefined, standard_hours_per_day: employeeForm.customSchedule ? Number(employeeForm.standard_hours_per_day || 8) : undefined };
    await run('employee:create', async () => { await api(dataPath('hrm.employee'), { method: 'POST', body }); setEmployeeForm({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' }); }, 'Đã tạo hồ sơ nhân viên mới. Thay đổi lương sau tuyển dụng cần tạo điều chỉnh có ngày hiệu lực.');
  }

  async function punchIn() {
    if (!punchEmployee) return;
    const existing = attendanceByEmployee.get(punchEmployee);
    await run('punch-in', async () => {
      if (existing) await api(dataPath('hrm.attendance', existing.id), { method: 'PATCH', body: { check_in: nowIso() } });
      else await api(dataPath('hrm.attendance'), { method: 'POST', body: { employee: punchEmployee, date: attendanceDate, check_in: nowIso() } });
    }, 'Đã ghi nhận giờ vào.');
  }

  async function punchOut(row) {
    await run(`${row.id}:punch-out`, () => api(dataPath('hrm.attendance', row.id), { method: 'PATCH', body: { check_out: nowIso() } }), 'Đã ghi nhận giờ ra.');
  }

  async function saveScheduleEntry(event) {
    event.preventDefault();
    const existing = scheduleEntries.find((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date);
    const endDate = scheduleForm.end_time <= scheduleForm.start_time ? nextLocalDate(scheduleForm.work_date) : scheduleForm.work_date;
    const details = scheduleForm.is_working ? {
      start_at: localDateTimeIso(scheduleForm.work_date, scheduleForm.start_time),
      end_at: localDateTimeIso(endDate, scheduleForm.end_time),
      break_minutes: Number(scheduleForm.break_minutes || 0),
    } : { start_at: null, end_at: null, break_minutes: 0 };
    await run('schedule:save', async () => {
      if (existing) await api(dataPath('hrm.work_schedule_entry', existing.id), { method: 'PATCH', body: { is_working: scheduleForm.is_working, ...details } });
      else await api(dataPath('hrm.work_schedule_entry'), { method: 'POST', body: { employee: scheduleForm.employee, work_date: scheduleForm.work_date, is_working: scheduleForm.is_working, ...details } });
    }, existing ? 'Đã cập nhật lịch làm việc trong ngày.' : 'Đã thêm lịch làm việc trong ngày.');
  }

  async function removeScheduleEntry(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_entry', row.id), { method: 'DELETE' }), 'Đã xóa ngoại lệ lịch; ngày này trở về lịch tuần của nhân viên.');
  }

  async function createSchedulePattern(event) {
    event.preventDefault();
    await run('schedule-pattern:create', async () => {
      const row = await api(dataPath('hrm.work_schedule_pattern'), { method: 'POST', body: patternForm });
      if (can('hrm.work_schedule_pattern.applied')) await action('hrm.work_schedule_pattern', row, 'applied');
    }, can('hrm.work_schedule_pattern.applied') ? 'Đã tạo lịch luân phiên và sinh các ca theo ngày; payroll và hạn mức phép sẽ dùng lịch mới.' : 'Đã lưu mẫu ca nháp để người có quyền áp dụng.');
  }

  function useScheduleTemplate(id) {
    setScheduleTemplateId(id);
    const template = scheduleTemplates.find((row) => row.id === id);
    setScheduleTemplateName(template?.name || '');
    if (template) setPatternForm((form) => ({ ...form, timezone: template.timezone || form.timezone, cycle: Array.isArray(template.cycle) ? template.cycle.map((day) => ({ ...day })) : form.cycle }));
  }

  async function saveScheduleTemplate() {
    const name = scheduleTemplateName.trim();
    if (!name) return;
    await run('schedule-template:save', async () => {
      const body = { name, timezone: patternForm.timezone, cycle: patternForm.cycle };
      if (scheduleTemplateId && scheduleTemplates.some((row) => row.id === scheduleTemplateId)) {
        await api(dataPath('hrm.work_schedule_template', scheduleTemplateId), { method: 'PATCH', body });
      } else {
        const row = await api(dataPath('hrm.work_schedule_template'), { method: 'POST', body });
        setScheduleTemplateId(row.id);
      }
    }, 'Đã lưu mẫu ca vào thư viện để tái sử dụng.');
  }

  async function removeScheduleTemplate(row) {
    await run(`${row.id}:template-remove`, () => api(dataPath('hrm.work_schedule_template', row.id), { method: 'DELETE' }), 'Đã xóa mẫu ca khỏi thư viện.');
    if (scheduleTemplateId === row.id) { setScheduleTemplateId(''); setScheduleTemplateName(''); }
  }

  async function applySchedulePattern(row) {
    await run(`${row.id}:applied`, () => action('hrm.work_schedule_pattern', row, 'applied'), 'Đã sinh lịch luân phiên thành các ca theo ngày.');
  }

  async function removeSchedulePattern(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_pattern', row.id), { method: 'DELETE' }), 'Đã xóa mẫu ca nháp.');
  }

  async function createLeave(event) {
    event.preventDefault();
    await run('leave:create', async () => {
      const row = await api(dataPath('hrm.leave_request'), { method: 'POST', body: { ...leaveForm, reason: leaveForm.reason.trim() || undefined } });
      await action('hrm.leave_request', row, 'submitted'); setLeaveForm((form) => ({ ...form, start_date: '', end_date: '', reason: '' }));
    }, 'Đã gửi yêu cầu nghỉ phép. Hạn mức, ngày làm việc, ngày lễ và đơn trùng được kiểm tra trên máy chủ.');
  }

  async function leaveDecision(row, verb) {
    const messages = { approved: 'Đã duyệt nghỉ phép và cập nhật dữ liệu nguồn cho chấm công/bảng lương.', rejected: 'Đã từ chối yêu cầu nghỉ phép.' };
    await run(`${row.id}:${verb}`, () => action('hrm.leave_request', row, verb), messages[verb]);
  }

  async function createRevision(event) {
    event.preventDefault();
    await run('revision:create', async () => {
      const row = await api(dataPath('hrm.salary_revision'), { method: 'POST', body: { ...revisionForm, base_salary: Number(revisionForm.base_salary), reason: revisionForm.reason.trim() } });
      await action('hrm.salary_revision', row, 'submitted'); setRevisionForm((form) => ({ ...form, effective_from: '', base_salary: '', reason: '' }));
    }, 'Đã gửi đề nghị điều chỉnh lương. Mức mới chỉ có hiệu lực sau khi được duyệt theo ngày hiệu lực.');
  }

  async function revisionDecision(row, verb) {
    await run(`${row.id}:${verb}`, () => action('hrm.salary_revision', row, verb), verb === 'approved' ? 'Đã duyệt mức lương mới có hiệu lực theo kỳ.' : 'Đã từ chối đề nghị điều chỉnh lương.');
  }

  async function terminateEmployee(row) {
    const terminationDate = localDate();
    await run(`${row.id}:terminated`, async () => {
      await api(dataPath('hrm.employee', row.id, 'terminated'), { method: 'POST', body: { termination_date: terminationDate } });
    }, 'Đã kết thúc hồ sơ nhân viên. Máy chủ đã kiểm tra chấm công và nghỉ phép còn vướng.');
  }

  const approvalFor = (entity, id) => approvalRequests.find((row) => row.entity === entity && row.record_id === id);
  const linkList = [
    ['hrm.leave_allocation.read', 'hrm.leave_allocation', 'Hạn mức nghỉ'],
    ['hrm.holiday.read', 'hrm.holiday', 'Ngày lễ'],
    ['payroll.payroll_run.read', 'payroll.payroll_run', 'Bảng lương'],
    ['hrm.department.read', 'hrm.department', 'Phòng ban'],
    ['hrm.position.read', 'hrm.position', 'Chức danh'],
  ].filter(([permission]) => can(permission));

  return <div className="page">
    <div className="page-head"><div><h1>Vận hành nhân sự</h1><p className="sub">Quản lý hồ sơ, ghi nhận chấm công, duyệt nghỉ phép và điều chỉnh lương theo ngày hiệu lực.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Nhân viên đang làm</span><strong className="stat-value">{activeEmployees.length}</strong></div><div className="card stat"><span className="stat-label">Đơn nghỉ chờ duyệt</span><strong className="stat-value">{pendingLeaves.length}</strong></div><div className="card stat"><span className="stat-label">Điều chỉnh lương chờ duyệt</span><strong className="stat-value">{pendingRevisions.length}</strong></div><div className="card stat"><span className="stat-label">Thiếu giờ ra hôm nay</span><strong className="stat-value">{attendanceDate === localDate() ? incompleteAttendance : '—'}</strong></div></div>

    <section className="card card-pad"><h2>Chấm công trong ngày</h2><div className="row wrap"><label className="field"><span className="label">Ngày</span><input className="input" type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)}/></label><label className="field grow"><span className="label">Nhân viên ghi nhận giờ vào</span><select className="select" value={punchEmployee} onChange={(event) => setPunchEmployee(event.target.value)}><option value="">Chọn nhân viên</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label>{can('hrm.attendance.create') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !punchEmployee || attendanceDate !== localDate() || Boolean(attendanceByEmployee.get(punchEmployee)?.check_in)} onClick={punchIn}>Ghi giờ vào</button>}</div>
      {attendance.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Nhân viên</th><th>Giờ vào</th><th>Giờ ra</th><th/></tr></thead><tbody>{attendance.map((row) => <tr key={row.id}><td>{employeeMap.get(row.employee) ? recordLabel('hrm.employee', employeeMap.get(row.employee)) : 'Nhân viên'}</td><td>{row.check_in ? fmtTime(row.check_in) : 'Chưa ghi'}</td><td>{row.check_out ? fmtTime(row.check_out) : 'Chưa ghi'}</td><td>{row.check_in && !row.check_out && can('hrm.attendance.update') && attendanceDate === localDate() && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => punchOut(row)}>Ghi giờ ra</button>}</td></tr>)}</tbody></table></div>}
      {!attendance.length && !loading && <p className="small muted">Chưa có bản ghi chấm công trong ngày đã chọn.</p>}
    </section>

    {(can('hrm.work_schedule_pattern.create') || can('hrm.work_schedule_pattern.read') || can('hrm.work_schedule_template.create') || can('hrm.work_schedule_template.read')) && <section className="card card-pad" style={{ marginTop: 16 }}>
      <h2>Lịch ca luân phiên</h2>
      <p className="small muted">Khai báo chu kỳ ngày làm/nghỉ, ngày bắt đầu và múi giờ. Khi áp dụng, hệ thống sinh lịch theo ngày để chấm công, nghỉ phép và payroll cùng sử dụng.</p>
      {(can('hrm.work_schedule_template.read') || can('hrm.work_schedule_template.create')) && <div className="row wrap" style={{ marginBottom: 12 }}>
        {can('hrm.work_schedule_template.read') && <label className="field grow"><span className="label">Dùng mẫu ca trong thư viện</span><select className="select" value={scheduleTemplateId} onChange={(event) => useScheduleTemplate(event.target.value)}><option value="">Chọn mẫu đã lưu</option>{scheduleTemplates.map((row) => <option key={row.id} value={row.id}>{row.name} · {Array.isArray(row.cycle) ? row.cycle.length : 0} ngày</option>)}</select></label>}
        {can('hrm.work_schedule_template.create') && <><label className="field grow"><span className="label">Tên mẫu để lưu hoặc cập nhật</span><input className="input" maxLength="120" value={scheduleTemplateName} onChange={(event) => setScheduleTemplateName(event.target.value)} placeholder="Ví dụ: Ca xoay 2 ngày"/></label><button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !scheduleTemplateName.trim()} onClick={saveScheduleTemplate}>{scheduleTemplateId ? 'Cập nhật mẫu' : 'Lưu thành mẫu'}</button></>}
      </div>}
      {can('hrm.work_schedule_template.read') && scheduleTemplates.length > 0 && <div className="row wrap small muted" style={{ marginBottom: 12 }}><span>Thư viện có {scheduleTemplates.length} mẫu.</span>{can('hrm.work_schedule_template.delete') && scheduleTemplateId && <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { const row = scheduleTemplates.find((item) => item.id === scheduleTemplateId); if (row) removeScheduleTemplate(row); }}>Xóa mẫu đang chọn</button>}</div>}
      {can('hrm.work_schedule_pattern.create') && <form className="form-grid" onSubmit={createSchedulePattern}>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Nhân viên trong đội * ({patternForm.employees.length}/50)</legend><input className="input" value={patternEmployeeFilter} onChange={(event) => setPatternEmployeeFilter(event.target.value)} placeholder="Tìm theo tên hoặc mã nhân viên"/><div className="row wrap" style={{ marginTop: 8, gap: 12 }}>{matchingPatternEmployees.map((row) => <label className="row small" key={row.id}><input type="checkbox" checked={patternForm.employees.includes(row.id)} disabled={!patternForm.employees.includes(row.id) && patternForm.employees.length >= 50} onChange={(event) => setPatternForm((form) => ({ ...form, employees: event.target.checked ? [...form.employees, row.id] : form.employees.filter((id) => id !== row.id) }))}/>{recordLabel('hrm.employee', row)}</label>)}</div>{!matchingPatternEmployees.length && <span className="small muted">Không tìm thấy nhân viên đang làm việc phù hợp.</span>}<span className="small muted">Chọn tối đa 50 nhân viên; lịch sẽ được áp dụng cho cả đội trong cùng giao dịch.</span></fieldset>
        <label className="field"><span className="label">Ngày bắt đầu chu kỳ *</span><input className="input" required type="date" value={patternForm.start_date} onChange={(event) => setPatternForm({ ...patternForm, start_date: event.target.value })}/></label>
        <label className="field"><span className="label">Sinh lịch đến ngày *</span><input className="input" required min={patternForm.start_date} max={addLocalDays(patternForm.start_date, 365)} type="date" value={patternForm.end_date} onChange={(event) => setPatternForm({ ...patternForm, end_date: event.target.value })}/></label>
        <label className="field"><span className="label">Múi giờ IANA *</span><input className="input" required value={patternForm.timezone} onChange={(event) => setPatternForm({ ...patternForm, timezone: event.target.value })} placeholder="Asia/Ho_Chi_Minh"/></label>
        <div className="field" style={{ gridColumn: '1 / -1' }}><span className="label">Các ngày trong chu kỳ (lặp từ ngày bắt đầu)</span><div className="stack" style={{ marginTop: 8 }}>
          {patternForm.cycle.map((day, index) => <div className="row wrap card card-pad" key={index} style={{ gap: 12 }}>
            <strong>Ngày {index + 1}</strong>
            <label className="row small"><input type="checkbox" checked={day.is_working} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, is_working: event.target.checked, start_time: event.target.checked ? (item.start_time || '09:00') : '', end_time: event.target.checked ? (item.end_time || '17:00') : '', break_minutes: event.target.checked ? (item.break_minutes || 0) : 0 } : item) }))}/>Có ca làm</label>
            {day.is_working && <><label className="field"><span className="label">Bắt đầu</span><input className="input" type="time" required value={day.start_time} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, start_time: event.target.value } : item) }))}/></label><label className="field"><span className="label">Kết thúc</span><input className="input" type="time" required value={day.end_time} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, end_time: event.target.value } : item) }))}/></label><label className="field"><span className="label">Nghỉ (phút)</span><input className="input num" type="number" min="0" max="1439" step="1" value={day.break_minutes} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, break_minutes: Number(event.target.value) } : item) }))}/></label></>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={patternForm.cycle.length <= 1} onClick={() => setPatternForm((form) => ({ ...form, cycle: form.cycle.filter((_, itemIndex) => itemIndex !== index) }))}>Xóa ngày</button>
          </div>)}
          <button type="button" className="btn btn-secondary btn-sm" disabled={patternForm.cycle.length >= 31} onClick={() => setPatternForm((form) => ({ ...form, cycle: [...form.cycle, { is_working: true, start_time: '09:00', end_time: '17:00', break_minutes: 60 }] }))}>Thêm ngày vào chu kỳ</button>
        </div></div>
        <div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !patternForm.employees.length || patternForm.employees.length > 50 || !patternForm.start_date || !patternForm.end_date || patternForm.end_date < patternForm.start_date || !patternForm.cycle.length}>{can('hrm.work_schedule_pattern.applied') ? 'Tạo và áp dụng lịch' : 'Lưu mẫu nháp'}</button></div>
      </form>}
      {can('hrm.work_schedule_pattern.read') && <div className="table-wrap" style={{ marginTop: 18 }}><table className="table"><thead><tr><th>Nhân viên</th><th>Khoảng ngày</th><th>Chu kỳ / múi giờ</th><th>Trạng thái</th><th/></tr></thead><tbody>{schedulePatterns.map((row) => <tr key={row.id}><td>{rotationEmployees(row).map((id) => employeeMap.get(id) ? recordLabel('hrm.employee', employeeMap.get(id)) : 'Nhân viên').join(', ')}</td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{Array.isArray(row.cycle) ? `${row.cycle.length} ngày` : '—'} · {row.timezone}</td><td>{statusLabel(row.status)}</td><td><div className="row wrap">{row.status === 'draft' && can('hrm.work_schedule_pattern.applied') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => applySchedulePattern(row)}>Áp dụng</button>}{row.status === 'draft' && can('hrm.work_schedule_pattern.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeSchedulePattern(row)}>Xóa nháp</button>}</div></td></tr>)}</tbody></table>{!schedulePatterns.length && <p className="small muted">Chưa có mẫu ca luân phiên.</p>}</div>}
    </section>}
    {(can('hrm.work_schedule_entry.create') || can('hrm.work_schedule_entry.read')) && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Lịch ca theo ngày</h2><p className="small muted">Mỗi dòng ghi đè lịch tuần của nhân viên trong đúng một ngày. Bỏ lịch để trở về lịch tuần; ca qua đêm được hỗ trợ.</p>{can('hrm.work_schedule_entry.create') && <form className="form-grid" onSubmit={saveScheduleEntry}><label className="field"><span className="label">Nhân viên *</span><select className="select" required value={scheduleForm.employee} onChange={(event) => setScheduleForm({ ...scheduleForm, employee: event.target.value })}><option value="">Chọn nhân viên</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><label className="field"><span className="label">Ngày làm việc *</span><input className="input" required type="date" value={scheduleForm.work_date} onChange={(event) => setScheduleForm({ ...scheduleForm, work_date: event.target.value })}/></label><label className="row small" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={scheduleForm.is_working} onChange={(event) => setScheduleForm({ ...scheduleForm, is_working: event.target.checked })}/>Có ca làm việc trong ngày này</label>{scheduleForm.is_working && <><label className="field"><span className="label">Bắt đầu *</span><input className="input" required type="time" value={scheduleForm.start_time} onChange={(event) => setScheduleForm({ ...scheduleForm, start_time: event.target.value })}/></label><label className="field"><span className="label">Kết thúc *</span><input className="input" required type="time" value={scheduleForm.end_time} onChange={(event) => setScheduleForm({ ...scheduleForm, end_time: event.target.value })}/></label><label className="field"><span className="label">Nghỉ không tính giờ (phút)</span><input className="input num" type="number" min="0" max="1439" step="1" value={scheduleForm.break_minutes} onChange={(event) => setScheduleForm({ ...scheduleForm, break_minutes: event.target.value })}/></label></>}<div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !scheduleForm.employee || !scheduleForm.work_date}>{scheduleEntries.some((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date) ? 'Cập nhật lịch ngày' : 'Lưu lịch ngày'}</button></div></form>}{can('hrm.work_schedule_entry.read') && <><h3 style={{ marginTop: 18 }}>Ngoại lệ trong tháng {scheduleForm.work_date.slice(0, 7)}</h3>{scheduleEntriesThisMonth.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Lịch áp dụng</th><th/></tr></thead><tbody>{scheduleEntriesThisMonth.map((row) => <tr key={row.id}><td>{fmtDate(row.work_date)}</td><td>{employeeMap.get(row.employee) ? recordLabel('hrm.employee', employeeMap.get(row.employee)) : 'Nhân viên'}</td><td>{row.is_working ? `${fmtTime(row.start_at)}–${fmtTime(row.end_at)} · nghỉ ${row.break_minutes || 0} phút` : 'Ngày nghỉ'}</td><td>{can('hrm.work_schedule_entry.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeScheduleEntry(row)}>Xóa ngoại lệ</button>}</td></tr>)}</tbody></table></div> : <p className="small muted">Chưa có ngoại lệ lịch trong tháng này.</p>}</>}</section>}
    {can('hrm.employee.create') && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Tiếp nhận nhân viên</h2><form onSubmit={createEmployee}><div className="form-grid"><label className="field"><span className="label">Họ và tên *</span><input className="input" required value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}/></label><label className="field"><span className="label">Mã nhân viên</span><input className="input" value={employeeForm.code} onChange={(event) => setEmployeeForm({ ...employeeForm, code: event.target.value })}/></label><label className="field"><span className="label">Email</span><input className="input" type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm({ ...employeeForm, email: event.target.value })}/></label><label className="field"><span className="label">Điện thoại</span><input className="input" type="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })}/></label><label className="field"><span className="label">Phòng ban</span><select className="select" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option value="">Chọn phòng ban</option>{[...departments.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.department', row)}</option>)}</select></label><label className="field"><span className="label">Chức danh</span><select className="select" value={employeeForm.position} onChange={(event) => setEmployeeForm({ ...employeeForm, position: event.target.value })}><option value="">Chọn chức danh</option>{[...positions.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.position', row)}</option>)}</select></label><label className="field"><span className="label">Ngày vào làm</span><input className="input" type="date" value={employeeForm.hire_date} onChange={(event) => setEmployeeForm({ ...employeeForm, hire_date: event.target.value })}/></label><label className="field"><span className="label">Lương cơ bản ban đầu</span><input className="input num" type="number" min="0" step="any" value={employeeForm.base_salary} onChange={(event) => setEmployeeForm({ ...employeeForm, base_salary: event.target.value })}/></label></div><div className="field" style={{ gridColumn: '1 / -1' }}><label className="row small"><input type="checkbox" checked={employeeForm.customSchedule} onChange={(event) => setEmployeeForm({ ...employeeForm, customSchedule: event.target.checked })}/>Lịch tuần và giờ chuẩn riêng cho nhân viên</label>{employeeForm.customSchedule && <div className="form-grid" style={{ marginTop: 8 }}><label className="field"><span className="label">Giờ chuẩn mỗi ngày</span><input className="input num" type="number" min="1" max="24" step="0.25" value={employeeForm.standard_hours_per_day} onChange={(event) => setEmployeeForm({ ...employeeForm, standard_hours_per_day: event.target.value })}/></label><fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Ngày làm việc</legend><div className="row wrap" style={{ gap: 10 }}>{weekdayOptions.map(([day, label]) => <label className="row small" key={day} style={{ gap: 5 }}><input type="checkbox" checked={employeeForm.work_weekdays.includes(day)} onChange={() => setEmployeeForm((current) => ({ ...current, work_weekdays: current.work_weekdays.includes(day) ? current.work_weekdays.filter((value) => value !== day) : [...current.work_weekdays, day].sort((a, b) => a - b) }))}/>{label}</label>)}</div></fieldset><span className="small muted" style={{ gridColumn: '1 / -1' }}>Nếu không bật, nhân viên dùng lịch làm việc và giờ chuẩn của kỳ lương.</span></div>}</div><div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || (employeeForm.customSchedule && !employeeForm.work_weekdays.length)}>Tạo hồ sơ</button></div></form></section>}

    {can('hrm.employee.read') && employees.some((row) => Array.isArray(row.work_weekdays) || row.standard_hours_per_day) && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Lịch tuần riêng</h2><div className="table-wrap"><table className="table"><thead><tr><th>Nhân viên</th><th>Ngày làm việc</th><th>Giờ chuẩn mỗi ngày</th></tr></thead><tbody>{employees.filter((row) => Array.isArray(row.work_weekdays) || row.standard_hours_per_day).map((row) => <tr key={row.id}><td>{recordLabel('hrm.employee', row)}</td><td>{Array.isArray(row.work_weekdays) ? row.work_weekdays.map((day) => weekdayOptions.find(([number]) => number === Number(day))?.[1]).filter(Boolean).join(', ') : 'Theo lịch kỳ lương'}</td><td>{row.standard_hours_per_day || 'Theo lịch kỳ lương'}</td></tr>)}</tbody></table></div><p className="small muted" style={{ marginTop: 10 }}>Lịch tuần là mặc định; các ca và ngày nghỉ cụ thể ghi ở phần Lịch ca theo ngày phía trên sẽ được ưu tiên.</p></section>}

    <div className="layout-split" style={{ marginTop: 16 }}>
      {can('hrm.leave_request.create') && <section className="card card-pad"><h2>Gửi yêu cầu nghỉ phép</h2><form onSubmit={createLeave}><label className="field"><span className="label">Nhân viên *</span><select className="select" required value={leaveForm.employee} onChange={(event) => setLeaveForm({ ...leaveForm, employee: event.target.value })}><option value="">Chọn nhân viên</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><div className="form-grid" style={{ marginTop: 10 }}><label className="field"><span className="label">Loại nghỉ</span><select className="select" value={leaveForm.kind} onChange={(event) => setLeaveForm({ ...leaveForm, kind: event.target.value, pay_treatment: event.target.value === 'unpaid' ? 'unpaid' : 'paid' })}><option value="annual">Phép năm</option><option value="sick">Nghỉ ốm</option><option value="unpaid">Không lương</option><option value="maternity">Thai sản</option><option value="other">Khác</option></select></label><label className="field"><span className="label">Hưởng lương</span><select className="select" value={leaveForm.pay_treatment} onChange={(event) => setLeaveForm({ ...leaveForm, pay_treatment: event.target.value })}><option value="paid">Có lương</option><option value="unpaid">Không lương</option></select></label><label className="field"><span className="label">Từ ngày *</span><input className="input" required type="date" value={leaveForm.start_date} onChange={(event) => setLeaveForm({ ...leaveForm, start_date: event.target.value, end_date: leaveForm.partial_day !== 'full' || (leaveForm.end_date && leaveForm.end_date < event.target.value) ? event.target.value : leaveForm.end_date })}/></label><label className="field"><span className="label">Đến ngày *</span><input className="input" required min={leaveForm.start_date || undefined} type="date" value={leaveForm.end_date} onChange={(event) => setLeaveForm({ ...leaveForm, end_date: event.target.value })}/></label><label className="field"><span className="label">Buổi nghỉ</span><select className="select" value={leaveForm.partial_day} onChange={(event) => setLeaveForm({ ...leaveForm, partial_day: event.target.value, end_date: event.target.value === 'full' ? leaveForm.end_date : leaveForm.start_date || leaveForm.end_date })}><option value="full">Cả ngày</option><option value="morning">Buổi sáng</option><option value="afternoon">Buổi chiều</option></select></label></div><label className="field" style={{ marginTop: 10 }}><span className="label">Lý do</span><textarea className="input" rows="2" value={leaveForm.reason} onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })}/></label><button className="btn btn-primary" style={{ marginTop: 10 }} disabled={Boolean(busy) || !activeEmployees.length}>Gửi duyệt</button></form></section>}

      {can('hrm.salary_revision.create') && <section className="card card-pad"><h2>Đề nghị điều chỉnh lương</h2><form onSubmit={createRevision}><label className="field"><span className="label">Nhân viên *</span><select className="select" required value={revisionForm.employee} onChange={(event) => setRevisionForm({ ...revisionForm, employee: event.target.value })}><option value="">Chọn nhân viên</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><div className="form-grid" style={{ marginTop: 10 }}><label className="field"><span className="label">Ngày hiệu lực *</span><input className="input" required type="date" value={revisionForm.effective_from} onChange={(event) => setRevisionForm({ ...revisionForm, effective_from: event.target.value })}/></label><label className="field"><span className="label">Lương cơ bản mới *</span><input className="input num" required type="number" min="0.01" step="any" value={revisionForm.base_salary} onChange={(event) => setRevisionForm({ ...revisionForm, base_salary: event.target.value })}/></label></div><label className="field" style={{ marginTop: 10 }}><span className="label">Lý do *</span><textarea className="input" required rows="2" value={revisionForm.reason} onChange={(event) => setRevisionForm({ ...revisionForm, reason: event.target.value })}/></label><button className="btn btn-primary" style={{ marginTop: 10 }} disabled={Boolean(busy)}>Gửi duyệt điều chỉnh</button></form></section>}
    </div>

    <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Đơn nghỉ phép cần xử lý</h2>{loading ? <div className="skeleton" data-h="row"/> : !leaveRequests.length ? <div className="empty">Chưa có đơn nghỉ phép.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Nhân viên / loại nghỉ</th><th>Thời gian</th><th>Hưởng lương</th><th>Trạng thái</th><th/></tr></thead><tbody>{leaveRequests.slice(0, 100).map((row) => { const req = approvalFor('hrm.leave_request', row.id); return <tr key={row.id}><td><strong>{employeeMap.get(row.employee)?.name || 'Nhân viên'}</strong><div className="small muted">{statusLabel(row.kind)}{row.partial_day !== 'full' ? ` · ${statusLabel(row.partial_day)}` : ''}</div></td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{statusLabel(row.pay_treatment)}</td><td>{statusLabel(row.status)}{row.status === 'submitted' && workflowApproval && req && <div className="small"><a href={`#/e/workflow-approval/approval_request/${req.id}`}>Mở yêu cầu duyệt</a></div>}</td><td>{row.status === 'submitted' && !workflowApproval && can('hrm.leave_request.approved') && <div className="row wrap"><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => leaveDecision(row, 'approved')}>Duyệt</button><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => leaveDecision(row, 'rejected')}>Từ chối</button></div>}{['draft','rejected'].includes(row.status) && can('hrm.leave_request.submitted') && <div className="row wrap"><a className="small" href={recordHref('hrm.leave_request', row.id)}>M&#7903; / s&#7917;a</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:submitted`, () => action('hrm.leave_request', row, 'submitted'), '\u0110\u00e3 g\u1eedi l\u1ea1i \u0111\u01a1n ngh\u1ec9 ph\u00e9p.')}>G&#7917;i l&#7841;i</button></div>}</td></tr>; })}</tbody></table></div>}</section>
      <section className="card card-pad"><h2>Hồ sơ nhân viên</h2>{loading ? <div className="skeleton" data-h="row"/> : !employees.length ? <div className="empty">Chưa có hồ sơ nhân viên.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Nhân viên / chức danh</th><th>Ngày vào</th><th>Trạng thái</th><th/></tr></thead><tbody>{employees.slice(0, 150).map((row) => <tr key={row.id}><td><strong>{recordLabel('hrm.employee', row)}</strong><div className="small muted">{departments.get(row.department)?.name || 'Chưa phân phòng ban'}{positions.get(row.position)?.name ? ` · ${positions.get(row.position).name}` : ''}</div></td><td>{fmtDate(row.hire_date)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'active' && can('hrm.employee.update') && can('hrm.employee.terminated') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => terminateEmployee(row)}>Kết thúc</button>}</td></tr>)}</tbody></table></div>}</section>
    </div>

    <section className="card card-pad" style={{ marginTop: 16 }}><h2>Điều chỉnh lương theo hiệu lực</h2>{!salaryRevisions.length ? <div className="empty">Chưa có đề nghị điều chỉnh lương.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Nhân viên / lý do</th><th>Hiệu lực</th><th>Mức mới</th><th>Trạng thái</th><th/></tr></thead><tbody>{salaryRevisions.slice(0, 100).map((row) => <tr key={row.id}><td><strong>{employeeMap.get(row.employee)?.name || 'Nhân viên'}</strong><div className="small muted">{row.reason}</div></td><td>{fmtDate(row.effective_from)}</td><td>{fmtMoney(row.base_salary || 0)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'submitted' && can('hrm.salary_revision.approved') && <div className="row wrap"><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => revisionDecision(row, 'approved')}>Duyệt</button><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => revisionDecision(row, 'rejected')}>Từ chối</button></div>}{['draft','rejected'].includes(row.status) && can('hrm.salary_revision.submitted') && <div className="row wrap"><a className="small" href={recordHref('hrm.salary_revision', row.id)}>M&#7903; / s&#7917;a</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:submitted`, () => action('hrm.salary_revision', row, 'submitted'), '\u0110\u00e3 g\u1eedi l\u1ea1i \u0111\u1ec1 ngh\u1ecb \u0111i\u1ec1u ch\u1ec9nh.')}>G&#7917;i l&#7841;i</button></div>}</td></tr>)}</tbody></table></div>}</section>

    {linkList.length > 0 && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Danh mục nhân sự và lương</h2><div className="row wrap">{linkList.map(([, entity, label]) => <a className="btn btn-secondary btn-sm" key={entity} href={listHref(entity)}>{label}</a>)}</div><p className="small muted" style={{ marginTop: 10 }}>{allocations.length} bản ghi hạn mức nghỉ đang được cấu hình. Hạn mức, ngày lễ, nghỉ trùng và hiệu lực kỳ lương được kiểm tra trên máy chủ.</p></section>}
  </div>;
}
