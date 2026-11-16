import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { addCalendarDays, addCalendarMonths, localDate, localDateTimeToIso, localTime } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { listHref, recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const rotationEmployees = (row) => Array.isArray(row?.employees) ? row.employees : row?.employee ? [row.employee] : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const weekdayOptions = [[1, uiText('T2')], [2, uiText('T3')], [3, uiText('T4')], [4, uiText('T5')], [5, uiText('T6')], [6, uiText('T7')], [7, uiText('CN')]];
const MAX_ROTATION_DAYS = 3653;
const MAX_GENERATED_SCHEDULE_ROWS = 40_000;
const rotationDayLimit = (employeeCount) => Math.min(MAX_ROTATION_DAYS, Math.floor(MAX_GENERATED_SCHEDULE_ROWS / Math.max(employeeCount, 1)));
const nowIso = () => new Date().toISOString();
const nextLocalDate = (date) => addCalendarDays(date, 1);
const addLocalDays = addCalendarDays;
const nextMonthStart = (date) => addCalendarMonths(`${date.slice(0, 7)}-01`, 1);
const fmtTime = (value) => value ? localTime(new Date(value)) : '--';
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
  const maxPatternEndDate = patternForm.start_date
    ? addLocalDays(patternForm.start_date, rotationDayLimit(patternForm.employees.length) - 1)
    : undefined;

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
    } catch (reason) { setError(reason.message || uiText('Không tải được dữ liệu nhân sự.')); }
    finally { if (!quiet) setLoading(false); }
  }, [attendanceDate, scheduleMonthStart, scheduleMonthEnd, workflowApproval]);

  useEffect(() => { document.title = `${uiText('Vận hành nhân sự')} · OSP Suite`; load(); }, [load]);
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
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createEmployee(event) {
    event.preventDefault();
    const body = { name: employeeForm.name.trim(), code: employeeForm.code.trim() || undefined, department: employeeForm.department || undefined, position: employeeForm.position || undefined, email: employeeForm.email.trim() || undefined, phone: employeeForm.phone.trim() || undefined, hire_date: employeeForm.hire_date || undefined, base_salary: employeeForm.base_salary ? Number(employeeForm.base_salary) : undefined, work_weekdays: employeeForm.customSchedule ? employeeForm.work_weekdays : undefined, standard_hours_per_day: employeeForm.customSchedule ? Number(employeeForm.standard_hours_per_day || 8) : undefined };
    await run('employee:create', async () => { await api(dataPath('hrm.employee'), { method: 'POST', body }); setEmployeeForm({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' }); }, uiText('Đã tạo hồ sơ nhân viên mới. Thay đổi lương sau tuyển dụng cần tạo điều chỉnh có ngày hiệu lực.'));
  }

  async function punchIn() {
    if (!punchEmployee) return;
    const existing = attendanceByEmployee.get(punchEmployee);
    await run('punch-in', async () => {
      if (existing) await api(dataPath('hrm.attendance', existing.id), { method: 'PATCH', body: { check_in: nowIso() } });
      else await api(dataPath('hrm.attendance'), { method: 'POST', body: { employee: punchEmployee, date: attendanceDate, check_in: nowIso() } });
    }, uiText('Đã ghi nhận giờ vào.'));
  }

  async function punchOut(row) {
    await run(`${row.id}:punch-out`, () => api(dataPath('hrm.attendance', row.id), { method: 'PATCH', body: { check_out: nowIso() } }), uiText('Đã ghi nhận giờ ra.'));
  }

  async function saveScheduleEntry(event) {
    event.preventDefault();
    const existing = scheduleEntries.find((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date);
    const endDate = scheduleForm.end_time <= scheduleForm.start_time ? nextLocalDate(scheduleForm.work_date) : scheduleForm.work_date;
    const startAt = scheduleForm.is_working ? localDateTimeToIso(`${scheduleForm.work_date}T${scheduleForm.start_time}`) : null;
    const endAt = scheduleForm.is_working ? localDateTimeToIso(`${endDate}T${scheduleForm.end_time}`) : null;
    if (scheduleForm.is_working && (!startAt || !endAt)) {
      setError(uiText('Giờ ca này không tồn tại trong múi giờ kinh doanh đã chọn do chuyển đổi giờ mùa hè.'));
      return;
    }
    const details = scheduleForm.is_working ? {
      start_at: startAt,
      end_at: endAt,
      break_minutes: Number(scheduleForm.break_minutes || 0),
    } : { start_at: null, end_at: null, break_minutes: 0 };
    await run('schedule:save', async () => {
      if (existing) await api(dataPath('hrm.work_schedule_entry', existing.id), { method: 'PATCH', body: { is_working: scheduleForm.is_working, ...details } });
      else await api(dataPath('hrm.work_schedule_entry'), { method: 'POST', body: { employee: scheduleForm.employee, work_date: scheduleForm.work_date, is_working: scheduleForm.is_working, ...details } });
    }, existing ? uiText('Đã cập nhật lịch làm việc trong ngày.') : uiText('Đã thêm lịch làm việc trong ngày.'));
  }

  async function removeScheduleEntry(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_entry', row.id), { method: 'DELETE' }), uiText('Đã xóa ngoại lệ lịch; ngày này trở về lịch tuần của nhân viên.'));
  }

  async function createSchedulePattern(event) {
    event.preventDefault();
    await run('schedule-pattern:create', async () => {
      const row = await api(dataPath('hrm.work_schedule_pattern'), { method: 'POST', body: patternForm });
      if (can('hrm.work_schedule_pattern.applied')) await action('hrm.work_schedule_pattern', row, 'applied');
    }, can('hrm.work_schedule_pattern.applied') ? uiText('Đã tạo lịch luân phiên và sinh các ca theo ngày; payroll và hạn mức phép sẽ dùng lịch mới.') : uiText('Đã lưu mẫu ca nháp để người có quyền áp dụng.'));
  }

  function updatePatternEmployees(employeeId, selected) {
    setPatternForm((form) => {
      const employees = selected
        ? [...form.employees, employeeId]
        : form.employees.filter((id) => id !== employeeId);
      const maxEnd = addLocalDays(form.start_date, rotationDayLimit(employees.length) - 1);
      return {
        ...form,
        employees,
        end_date: form.end_date > maxEnd ? maxEnd : form.end_date,
      };
    });
  }

  function updatePatternStartDate(startDate) {
    setPatternForm((form) => {
      const maxEnd = addLocalDays(startDate, rotationDayLimit(form.employees.length) - 1);
      return {
        ...form,
        start_date: startDate,
        end_date: !form.end_date || form.end_date < startDate ? startDate : form.end_date > maxEnd ? maxEnd : form.end_date,
      };
    });
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
    }, uiText('Đã lưu mẫu ca vào thư viện để tái sử dụng.'));
  }

  async function removeScheduleTemplate(row) {
    await run(`${row.id}:template-remove`, () => api(dataPath('hrm.work_schedule_template', row.id), { method: 'DELETE' }), uiText('Đã xóa mẫu ca khỏi thư viện.'));
    if (scheduleTemplateId === row.id) { setScheduleTemplateId(''); setScheduleTemplateName(''); }
  }

  async function applySchedulePattern(row) {
    await run(`${row.id}:applied`, () => action('hrm.work_schedule_pattern', row, 'applied'), uiText('Đã sinh lịch luân phiên thành các ca theo ngày.'));
  }

  async function removeSchedulePattern(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_pattern', row.id), { method: 'DELETE' }), uiText('Đã xóa mẫu ca nháp.'));
  }

  async function createLeave(event) {
    event.preventDefault();
    await run('leave:create', async () => {
      const row = await api(dataPath('hrm.leave_request'), { method: 'POST', body: { ...leaveForm, reason: leaveForm.reason.trim() || undefined } });
      await action('hrm.leave_request', row, 'submitted'); setLeaveForm((form) => ({ ...form, start_date: '', end_date: '', reason: '' }));
    }, uiText('Đã gửi yêu cầu nghỉ phép. Hạn mức, ngày làm việc, ngày lễ và đơn trùng được kiểm tra trên máy chủ.'));
  }

  async function leaveDecision(row, verb) {
    const messages = { approved: uiText('Đã duyệt nghỉ phép và cập nhật dữ liệu nguồn cho chấm công/bảng lương.'), rejected: uiText('Đã từ chối yêu cầu nghỉ phép.') };
    await run(`${row.id}:${verb}`, () => action('hrm.leave_request', row, verb), messages[verb]);
  }

  async function createRevision(event) {
    event.preventDefault();
    await run('revision:create', async () => {
      const row = await api(dataPath('hrm.salary_revision'), { method: 'POST', body: { ...revisionForm, base_salary: Number(revisionForm.base_salary), reason: revisionForm.reason.trim() } });
      await action('hrm.salary_revision', row, 'submitted'); setRevisionForm((form) => ({ ...form, effective_from: '', base_salary: '', reason: '' }));
    }, uiText('Đã gửi đề nghị điều chỉnh lương. Mức mới chỉ có hiệu lực sau khi được duyệt theo ngày hiệu lực.'));
  }

  async function revisionDecision(row, verb) {
    await run(`${row.id}:${verb}`, () => action('hrm.salary_revision', row, verb), verb === 'approved' ? uiText('Đã duyệt mức lương mới có hiệu lực theo kỳ.') : uiText('Đã từ chối đề nghị điều chỉnh lương.'));
  }

  async function terminateEmployee(row) {
    const terminationDate = localDate();
    await run(`${row.id}:terminated`, async () => {
      await api(dataPath('hrm.employee', row.id, 'terminated'), { method: 'POST', body: { termination_date: terminationDate } });
    }, uiText('Đã kết thúc hồ sơ nhân viên. Máy chủ đã kiểm tra chấm công và nghỉ phép còn vướng.'));
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
    <div className="page-head"><div><h1>{uiText("Vận hành nhân sự")}</h1><p className="sub">{uiText("Quản lý hồ sơ, ghi nhận chấm công, duyệt nghỉ phép và điều chỉnh lương theo ngày hiệu lực.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText("Nhân viên đang làm")}</span><strong className="stat-value">{activeEmployees.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đơn nghỉ chờ duyệt")}</span><strong className="stat-value">{pendingLeaves.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Điều chỉnh lương chờ duyệt")}</span><strong className="stat-value">{pendingRevisions.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Thiếu giờ ra hôm nay")}</span><strong className="stat-value">{attendanceDate === localDate() ? incompleteAttendance : '—'}</strong></div></div>

    <section className="card card-pad"><h2>{uiText("Chấm công trong ngày")}</h2><div className="row wrap"><label className="field"><span className="label">{uiText("Ngày")}</span><input className="input" type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)}/></label><label className="field grow"><span className="label">{uiText("Nhân viên ghi nhận giờ vào")}</span><select className="select" value={punchEmployee} onChange={(event) => setPunchEmployee(event.target.value)}><option value="">{uiText("Chọn nhân viên")}</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label>{can('hrm.attendance.create') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !punchEmployee || attendanceDate !== localDate() || Boolean(attendanceByEmployee.get(punchEmployee)?.check_in)} onClick={punchIn}>{uiText("Ghi giờ vào")}</button>}</div>
      {attendance.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>{uiText("Nhân viên")}</th><th>{uiText("Giờ vào")}</th><th>{uiText("Giờ ra")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.id}><td>{employeeMap.get(row.employee) ? recordLabel('hrm.employee', employeeMap.get(row.employee)) : uiText('Nhân viên')}</td><td>{row.check_in ? fmtTime(row.check_in) : uiText('Chưa ghi')}</td><td>{row.check_out ? fmtTime(row.check_out) : uiText('Chưa ghi')}</td><td>{row.check_in && !row.check_out && can('hrm.attendance.update') && attendanceDate === localDate() && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => punchOut(row)}>{uiText("Ghi giờ ra")}</button>}</td></tr>)}</tbody></table></div>}
      {!attendance.length && !loading && <p className="small muted">{uiText("Chưa có bản ghi chấm công trong ngày đã chọn.")}</p>}
    </section>

    {(can('hrm.work_schedule_pattern.create') || can('hrm.work_schedule_pattern.read') || can('hrm.work_schedule_template.create') || can('hrm.work_schedule_template.read')) && <section className="card card-pad" style={{ marginTop: 16 }}>
      <h2>{uiText("Lịch ca luân phiên")}</h2>
      <p className="small muted">{uiText("Khai báo chu kỳ ngày làm/nghỉ, ngày bắt đầu và múi giờ. Khi áp dụng, hệ thống sinh lịch theo ngày để chấm công, nghỉ phép và payroll cùng sử dụng. Mỗi đợt tối đa 10 năm và 40.000 dòng; phạm vi ngày tối đa giảm theo số nhân viên trong đội.")}</p>
      {(can('hrm.work_schedule_template.read') || can('hrm.work_schedule_template.create')) && <div className="row wrap" style={{ marginBottom: 12 }}>
        {can('hrm.work_schedule_template.read') && <label className="field grow"><span className="label">{uiText("Dùng mẫu ca trong thư viện")}</span><select className="select" value={scheduleTemplateId} onChange={(event) => useScheduleTemplate(event.target.value)}><option value="">{uiText("Chọn mẫu đã lưu")}</option>{scheduleTemplates.map((row) => <option key={row.id} value={row.id}>{row.name} · {Array.isArray(row.cycle) ? row.cycle.length : 0}{uiText("ngày")}</option>)}</select></label>}
        {can('hrm.work_schedule_template.create') && <><label className="field grow"><span className="label">{uiText("Tên mẫu để lưu hoặc cập nhật")}</span><input className="input" maxLength="120" value={scheduleTemplateName} onChange={(event) => setScheduleTemplateName(event.target.value)} placeholder={uiText("Ví dụ: Ca xoay 2 ngày")}/></label><button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !scheduleTemplateName.trim()} onClick={saveScheduleTemplate}>{scheduleTemplateId ? uiText('Cập nhật mẫu') : uiText('Lưu thành mẫu')}</button></>}
      </div>}
      {can('hrm.work_schedule_template.read') && scheduleTemplates.length > 0 && <div className="row wrap small muted" style={{ marginBottom: 12 }}><span>{uiText("Thư viện có")} {scheduleTemplates.length} {uiText("mẫu.")}</span>{can('hrm.work_schedule_template.delete') && scheduleTemplateId && <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { const row = scheduleTemplates.find((item) => item.id === scheduleTemplateId); if (row) removeScheduleTemplate(row); }}>{uiText("Xóa mẫu đang chọn")}</button>}</div>}
      {can('hrm.work_schedule_pattern.create') && <form className="form-grid" onSubmit={createSchedulePattern}>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">{uiText("Nhân viên trong đội * (")}{patternForm.employees.length}/50)</legend><input className="input" value={patternEmployeeFilter} onChange={(event) => setPatternEmployeeFilter(event.target.value)} placeholder={uiText("Tìm theo tên hoặc mã nhân viên")}/><div className="row wrap" style={{ marginTop: 8, gap: 12 }}>{matchingPatternEmployees.map((row) => <label className="row small" key={row.id}><input type="checkbox" checked={patternForm.employees.includes(row.id)} disabled={!patternForm.employees.includes(row.id) && patternForm.employees.length >= 50} onChange={(event) => updatePatternEmployees(row.id, event.target.checked)}/>{recordLabel('hrm.employee', row)}</label>)}</div>{!matchingPatternEmployees.length && <span className="small muted">{uiText("Không tìm thấy nhân viên đang làm việc phù hợp.")}</span>}<span className="small muted">{uiText("Chọn tối đa 50 nhân viên; phạm vi tối đa hiện tại là")} {rotationDayLimit(patternForm.employees.length)} {uiText("ngày để không vượt giới hạn 40.000 dòng và trần 10 năm.")}</span></fieldset>
        <label className="field"><span className="label">{uiText("Ngày bắt đầu chu kỳ *")}</span><input className="input" required type="date" value={patternForm.start_date} onChange={(event) => updatePatternStartDate(event.target.value)}/></label>
        <label className="field"><span className="label">{uiText("Sinh lịch đến ngày *")}</span><input className="input" required min={patternForm.start_date} max={maxPatternEndDate} type="date" value={patternForm.end_date} onChange={(event) => setPatternForm({ ...patternForm, end_date: event.target.value })}/></label>
        <label className="field"><span className="label">{uiText("Múi giờ IANA *")}</span><input className="input" required value={patternForm.timezone} onChange={(event) => setPatternForm({ ...patternForm, timezone: event.target.value })} placeholder="Asia/Ho_Chi_Minh"/></label>
        <div className="field" style={{ gridColumn: '1 / -1' }}><span className="label">{uiText("Các ngày trong chu kỳ (lặp từ ngày bắt đầu)")}</span><div className="stack" style={{ marginTop: 8 }}>
          {patternForm.cycle.map((day, index) => <div className="row wrap card card-pad" key={index} style={{ gap: 12 }}>
            <strong>{uiText("Ngày")}{index + 1}</strong>
            <label className="row small"><input type="checkbox" checked={day.is_working} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, is_working: event.target.checked, start_time: event.target.checked ? (item.start_time || '09:00') : '', end_time: event.target.checked ? (item.end_time || '17:00') : '', break_minutes: event.target.checked ? (item.break_minutes || 0) : 0 } : item) }))}/>{uiText("Có ca làm")}</label>
            {day.is_working && <><label className="field"><span className="label">{uiText("Bắt đầu")}</span><input className="input" type="time" required value={day.start_time} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, start_time: event.target.value } : item) }))}/></label><label className="field"><span className="label">{uiText("Kết thúc")}</span><input className="input" type="time" required value={day.end_time} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, end_time: event.target.value } : item) }))}/></label><label className="field"><span className="label">{uiText("Nghỉ (phút)")}</span><input className="input num" type="number" min="0" max="1439" step="1" value={day.break_minutes} onChange={(event) => setPatternForm((form) => ({ ...form, cycle: form.cycle.map((item, itemIndex) => itemIndex === index ? { ...item, break_minutes: Number(event.target.value) } : item) }))}/></label></>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={patternForm.cycle.length <= 1} onClick={() => setPatternForm((form) => ({ ...form, cycle: form.cycle.filter((_, itemIndex) => itemIndex !== index) }))}>{uiText("Xóa ngày")}</button>
          </div>)}
          <button type="button" className="btn btn-secondary btn-sm" disabled={patternForm.cycle.length >= 31} onClick={() => setPatternForm((form) => ({ ...form, cycle: [...form.cycle, { is_working: true, start_time: '09:00', end_time: '17:00', break_minutes: 60 }] }))}>{uiText("Thêm ngày vào chu kỳ")}</button>
        </div></div>
        <div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !patternForm.employees.length || patternForm.employees.length > 50 || !patternForm.start_date || !patternForm.end_date || patternForm.end_date < patternForm.start_date || !patternForm.cycle.length}>{can('hrm.work_schedule_pattern.applied') ? uiText('Tạo và áp dụng lịch') : uiText('Lưu mẫu nháp')}</button></div>
      </form>}
      {can('hrm.work_schedule_pattern.read') && <div className="table-wrap" style={{ marginTop: 18 }}><table className="table"><thead><tr><th>{uiText("Nhân viên")}</th><th>{uiText("Khoảng ngày")}</th><th>{uiText("Chu kỳ / múi giờ")}</th><th>{uiText("Trạng thái")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{schedulePatterns.map((row) => <tr key={row.id}><td>{rotationEmployees(row).map((id) => employeeMap.get(id) ? recordLabel('hrm.employee', employeeMap.get(id)) : uiText('Nhân viên')).join(', ')}</td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{Array.isArray(row.cycle) ? `${row.cycle.length} ngày` : '—'} · {row.timezone}</td><td>{statusLabel(row.status)}</td><td><div className="row wrap">{row.status === 'draft' && can('hrm.work_schedule_pattern.applied') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => applySchedulePattern(row)}>{uiText("Áp dụng")}</button>}{row.status === 'draft' && can('hrm.work_schedule_pattern.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeSchedulePattern(row)}>{uiText("Xóa nháp")}</button>}</div></td></tr>)}</tbody></table>{!schedulePatterns.length && <p className="small muted">{uiText("Chưa có mẫu ca luân phiên.")}</p>}</div>}
    </section>}
    {(can('hrm.work_schedule_entry.create') || can('hrm.work_schedule_entry.read')) && <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Lịch ca theo ngày")}</h2><p className="small muted">{uiText("Mỗi dòng ghi đè lịch tuần của nhân viên trong đúng một ngày. Bỏ lịch để trở về lịch tuần; ca qua đêm được hỗ trợ.")}</p>{can('hrm.work_schedule_entry.create') && <form className="form-grid" onSubmit={saveScheduleEntry}><label className="field"><span className="label">{uiText("Nhân viên *")}</span><select className="select" required value={scheduleForm.employee} onChange={(event) => setScheduleForm({ ...scheduleForm, employee: event.target.value })}><option value="">{uiText("Chọn nhân viên")}</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày làm việc *")}</span><input className="input" required type="date" value={scheduleForm.work_date} onChange={(event) => setScheduleForm({ ...scheduleForm, work_date: event.target.value })}/></label><label className="row small" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={scheduleForm.is_working} onChange={(event) => setScheduleForm({ ...scheduleForm, is_working: event.target.checked })}/>{uiText("Có ca làm việc trong ngày này")}</label>{scheduleForm.is_working && <><label className="field"><span className="label">{uiText("Bắt đầu *")}</span><input className="input" required type="time" value={scheduleForm.start_time} onChange={(event) => setScheduleForm({ ...scheduleForm, start_time: event.target.value })}/></label><label className="field"><span className="label">{uiText("Kết thúc *")}</span><input className="input" required type="time" value={scheduleForm.end_time} onChange={(event) => setScheduleForm({ ...scheduleForm, end_time: event.target.value })}/></label><label className="field"><span className="label">{uiText("Nghỉ không tính giờ (phút)")}</span><input className="input num" type="number" min="0" max="1439" step="1" value={scheduleForm.break_minutes} onChange={(event) => setScheduleForm({ ...scheduleForm, break_minutes: event.target.value })}/></label></>}<div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !scheduleForm.employee || !scheduleForm.work_date}>{scheduleEntries.some((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date) ? uiText('Cập nhật lịch ngày') : uiText('Lưu lịch ngày')}</button></div></form>}{can('hrm.work_schedule_entry.read') && <><h3 style={{ marginTop: 18 }}>{uiText("Ngoại lệ trong tháng")} {scheduleForm.work_date.slice(0, 7)}</h3>{scheduleEntriesThisMonth.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Ngày")}</th><th>{uiText("Nhân viên")}</th><th>{uiText("Lịch áp dụng")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{scheduleEntriesThisMonth.map((row) => <tr key={row.id}><td>{fmtDate(row.work_date)}</td><td>{employeeMap.get(row.employee) ? recordLabel('hrm.employee', employeeMap.get(row.employee)) : uiText('Nhân viên')}</td><td>{row.is_working ? `${fmtTime(row.start_at)}–${fmtTime(row.end_at)} · nghỉ ${row.break_minutes || 0} phút` : uiText('Ngày nghỉ')}</td><td>{can('hrm.work_schedule_entry.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeScheduleEntry(row)}>{uiText("Xóa ngoại lệ")}</button>}</td></tr>)}</tbody></table></div> : <p className="small muted">{uiText("Chưa có ngoại lệ lịch trong tháng này.")}</p>}</>}</section>}
    {can('hrm.employee.create') && <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Tiếp nhận nhân viên")}</h2><form onSubmit={createEmployee}><div className="form-grid"><label className="field"><span className="label">{uiText("Họ và tên *")}</span><input className="input" required value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}/></label><label className="field"><span className="label">{uiText("Mã nhân viên")}</span><input className="input" value={employeeForm.code} onChange={(event) => setEmployeeForm({ ...employeeForm, code: event.target.value })}/></label><label className="field"><span className="label">Email</span><input className="input" type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm({ ...employeeForm, email: event.target.value })}/></label><label className="field"><span className="label">{uiText("Điện thoại")}</span><input className="input" type="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })}/></label><label className="field"><span className="label">{uiText("Phòng ban")}</span><select className="select" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option value="">{uiText("Chọn phòng ban")}</option>{[...departments.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.department', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Chức danh")}</span><select className="select" value={employeeForm.position} onChange={(event) => setEmployeeForm({ ...employeeForm, position: event.target.value })}><option value="">{uiText("Chọn chức danh")}</option>{[...positions.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.position', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày vào làm")}</span><input className="input" type="date" value={employeeForm.hire_date} onChange={(event) => setEmployeeForm({ ...employeeForm, hire_date: event.target.value })}/></label><label className="field"><span className="label">{uiText("Lương cơ bản ban đầu")}</span><input className="input num" type="number" min="0" step="any" value={employeeForm.base_salary} onChange={(event) => setEmployeeForm({ ...employeeForm, base_salary: event.target.value })}/></label></div><div className="field" style={{ gridColumn: '1 / -1' }}><label className="row small"><input type="checkbox" checked={employeeForm.customSchedule} onChange={(event) => setEmployeeForm({ ...employeeForm, customSchedule: event.target.checked })}/>{uiText("Lịch tuần và giờ chuẩn riêng cho nhân viên")}</label>{employeeForm.customSchedule && <div className="form-grid" style={{ marginTop: 8 }}><label className="field"><span className="label">{uiText("Giờ chuẩn mỗi ngày")}</span><input className="input num" type="number" min="1" max="24" step="0.25" value={employeeForm.standard_hours_per_day} onChange={(event) => setEmployeeForm({ ...employeeForm, standard_hours_per_day: event.target.value })}/></label><fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">{uiText("Ngày làm việc")}</legend><div className="row wrap" style={{ gap: 10 }}>{weekdayOptions.map(([day, label]) => <label className="row small" key={day} style={{ gap: 5 }}><input type="checkbox" checked={employeeForm.work_weekdays.includes(day)} onChange={() => setEmployeeForm((current) => ({ ...current, work_weekdays: current.work_weekdays.includes(day) ? current.work_weekdays.filter((value) => value !== day) : [...current.work_weekdays, day].sort((a, b) => a - b) }))}/>{label}</label>)}</div></fieldset><span className="small muted" style={{ gridColumn: '1 / -1' }}>{uiText("Nếu không bật, nhân viên dùng lịch làm việc và giờ chuẩn của kỳ lương.")}</span></div>}</div><div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || (employeeForm.customSchedule && !employeeForm.work_weekdays.length)}>{uiText("Tạo hồ sơ")}</button></div></form></section>}

    {can('hrm.employee.read') && employees.some((row) => Array.isArray(row.work_weekdays) || row.standard_hours_per_day) && <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Lịch tuần riêng")}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Nhân viên")}</th><th>{uiText("Ngày làm việc")}</th><th>{uiText("Giờ chuẩn mỗi ngày")}</th></tr></thead><tbody>{employees.filter((row) => Array.isArray(row.work_weekdays) || row.standard_hours_per_day).map((row) => <tr key={row.id}><td>{recordLabel('hrm.employee', row)}</td><td>{Array.isArray(row.work_weekdays) ? row.work_weekdays.map((day) => weekdayOptions.find(([number]) => number === Number(day))?.[1]).filter(Boolean).join(', ') : uiText('Theo lịch kỳ lương')}</td><td>{row.standard_hours_per_day || uiText('Theo lịch kỳ lương')}</td></tr>)}</tbody></table></div><p className="small muted" style={{ marginTop: 10 }}>{uiText("Lịch tuần là mặc định; các ca và ngày nghỉ cụ thể ghi ở phần Lịch ca theo ngày phía trên sẽ được ưu tiên.")}</p></section>}

    <div className="layout-split" style={{ marginTop: 16 }}>
      {can('hrm.leave_request.create') && <section className="card card-pad"><h2>{uiText("Gửi yêu cầu nghỉ phép")}</h2><form onSubmit={createLeave}><label className="field"><span className="label">{uiText("Nhân viên *")}</span><select className="select" required value={leaveForm.employee} onChange={(event) => setLeaveForm({ ...leaveForm, employee: event.target.value })}><option value="">{uiText("Chọn nhân viên")}</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><div className="form-grid" style={{ marginTop: 10 }}><label className="field"><span className="label">{uiText("Loại nghỉ")}</span><select className="select" value={leaveForm.kind} onChange={(event) => setLeaveForm({ ...leaveForm, kind: event.target.value, pay_treatment: event.target.value === 'unpaid' ? 'unpaid' : 'paid' })}><option value="annual">{uiText("Phép năm")}</option><option value="sick">{uiText("Nghỉ ốm")}</option><option value="unpaid">{uiText("Không lương")}</option><option value="maternity">{uiText("Thai sản")}</option><option value="other">{uiText("Khác")}</option></select></label><label className="field"><span className="label">{uiText("Hưởng lương")}</span><select className="select" value={leaveForm.pay_treatment} onChange={(event) => setLeaveForm({ ...leaveForm, pay_treatment: event.target.value })}><option value="paid">{uiText("Có lương")}</option><option value="unpaid">{uiText("Không lương")}</option></select></label><label className="field"><span className="label">{uiText("Từ ngày *")}</span><input className="input" required type="date" value={leaveForm.start_date} onChange={(event) => setLeaveForm({ ...leaveForm, start_date: event.target.value, end_date: leaveForm.partial_day !== 'full' || (leaveForm.end_date && leaveForm.end_date < event.target.value) ? event.target.value : leaveForm.end_date })}/></label><label className="field"><span className="label">{uiText("Đến ngày *")}</span><input className="input" required min={leaveForm.start_date || undefined} type="date" value={leaveForm.end_date} onChange={(event) => setLeaveForm({ ...leaveForm, end_date: event.target.value })}/></label><label className="field"><span className="label">{uiText("Buổi nghỉ")}</span><select className="select" value={leaveForm.partial_day} onChange={(event) => setLeaveForm({ ...leaveForm, partial_day: event.target.value, end_date: event.target.value === 'full' ? leaveForm.end_date : leaveForm.start_date || leaveForm.end_date })}><option value="full">{uiText("Cả ngày")}</option><option value="morning">{uiText("Buổi sáng")}</option><option value="afternoon">{uiText("Buổi chiều")}</option></select></label></div><label className="field" style={{ marginTop: 10 }}><span className="label">{uiText("Lý do")}</span><textarea className="input" rows="2" value={leaveForm.reason} onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })}/></label><button className="btn btn-primary" style={{ marginTop: 10 }} disabled={Boolean(busy) || !activeEmployees.length}>{uiText("Gửi duyệt")}</button></form></section>}

      {can('hrm.salary_revision.create') && <section className="card card-pad"><h2>{uiText("Đề nghị điều chỉnh lương")}</h2><form onSubmit={createRevision}><label className="field"><span className="label">{uiText("Nhân viên *")}</span><select className="select" required value={revisionForm.employee} onChange={(event) => setRevisionForm({ ...revisionForm, employee: event.target.value })}><option value="">{uiText("Chọn nhân viên")}</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><div className="form-grid" style={{ marginTop: 10 }}><label className="field"><span className="label">{uiText("Ngày hiệu lực *")}</span><input className="input" required type="date" value={revisionForm.effective_from} onChange={(event) => setRevisionForm({ ...revisionForm, effective_from: event.target.value })}/></label><label className="field"><span className="label">{uiText("Lương cơ bản mới *")}</span><input className="input num" required type="number" min="0.01" step="any" value={revisionForm.base_salary} onChange={(event) => setRevisionForm({ ...revisionForm, base_salary: event.target.value })}/></label></div><label className="field" style={{ marginTop: 10 }}><span className="label">{uiText("Lý do *")}</span><textarea className="input" required rows="2" value={revisionForm.reason} onChange={(event) => setRevisionForm({ ...revisionForm, reason: event.target.value })}/></label><button className="btn btn-primary" style={{ marginTop: 10 }} disabled={Boolean(busy)}>{uiText("Gửi duyệt điều chỉnh")}</button></form></section>}
    </div>

    <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>{uiText("Đơn nghỉ phép cần xử lý")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !leaveRequests.length ? <div className="empty">{uiText("Chưa có đơn nghỉ phép.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Nhân viên / loại nghỉ")}</th><th>{uiText("Thời gian")}</th><th>{uiText("Hưởng lương")}</th><th>{uiText("Trạng thái")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{leaveRequests.slice(0, 100).map((row) => { const req = approvalFor('hrm.leave_request', row.id); return <tr key={row.id}><td><strong>{employeeMap.get(row.employee)?.name || uiText('Nhân viên')}</strong><div className="small muted">{statusLabel(row.kind)}{row.partial_day !== 'full' ? ` · ${statusLabel(row.partial_day)}` : ''}</div></td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{statusLabel(row.pay_treatment)}</td><td>{statusLabel(row.status)}{row.status === 'submitted' && workflowApproval && req && <div className="small"><a href={`#/e/workflow-approval/approval_request/${req.id}`}>{uiText("Mở yêu cầu duyệt")}</a></div>}</td><td>{row.status === 'submitted' && !workflowApproval && can('hrm.leave_request.approved') && <div className="row wrap"><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => leaveDecision(row, 'approved')}>{uiText("Duyệt")}</button><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => leaveDecision(row, 'rejected')}>{uiText("Từ chối")}</button></div>}{['draft','rejected'].includes(row.status) && can('hrm.leave_request.submitted') && <div className="row wrap"><a className="small" href={recordHref('hrm.leave_request', row.id)}>{uiText('M\u1edf / s\u1eeda')}</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:submitted`, () => action('hrm.leave_request', row, 'submitted'), uiText('\u0110\u00e3 g\u1eedi l\u1ea1i \u0111\u01a1n ngh\u1ec9 ph\u00e9p.'))}>{uiText('G\u1eedi l\u1ea1i')}</button></div>}</td></tr>; })}</tbody></table></div>}</section>
      <section className="card card-pad"><h2>{uiText("Hồ sơ nhân viên")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !employees.length ? <div className="empty">{uiText("Chưa có hồ sơ nhân viên.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Nhân viên / chức danh")}</th><th>{uiText("Ngày vào")}</th><th>{uiText("Trạng thái")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{employees.slice(0, 150).map((row) => <tr key={row.id}><td><strong>{recordLabel('hrm.employee', row)}</strong><div className="small muted">{departments.get(row.department)?.name || uiText('Chưa phân phòng ban')}{positions.get(row.position)?.name ? ` · ${positions.get(row.position).name}` : ''}</div></td><td>{fmtDate(row.hire_date)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'active' && can('hrm.employee.update') && can('hrm.employee.terminated') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => terminateEmployee(row)}>{uiText("Kết thúc")}</button>}</td></tr>)}</tbody></table></div>}</section>
    </div>

    <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Điều chỉnh lương theo hiệu lực")}</h2>{!salaryRevisions.length ? <div className="empty">{uiText("Chưa có đề nghị điều chỉnh lương.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Nhân viên / lý do")}</th><th>{uiText("Hiệu lực")}</th><th>{uiText("Mức mới")}</th><th>{uiText("Trạng thái")}</th><th scope="col">{uiText("Thao tác")}</th></tr></thead><tbody>{salaryRevisions.slice(0, 100).map((row) => <tr key={row.id}><td><strong>{employeeMap.get(row.employee)?.name || uiText('Nhân viên')}</strong><div className="small muted">{row.reason}</div></td><td>{fmtDate(row.effective_from)}</td><td>{fmtMoney(row.base_salary || 0)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'submitted' && can('hrm.salary_revision.approved') && <div className="row wrap"><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => revisionDecision(row, 'approved')}>{uiText("Duyệt")}</button><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => revisionDecision(row, 'rejected')}>{uiText("Từ chối")}</button></div>}{['draft','rejected'].includes(row.status) && can('hrm.salary_revision.submitted') && <div className="row wrap"><a className="small" href={recordHref('hrm.salary_revision', row.id)}>{uiText('M\u1edf / s\u1eeda')}</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:submitted`, () => action('hrm.salary_revision', row, 'submitted'), uiText('\u0110\u00e3 g\u1eedi l\u1ea1i \u0111\u1ec1 ngh\u1ecb \u0111i\u1ec1u ch\u1ec9nh.'))}>{uiText('G\u1eedi l\u1ea1i')}</button></div>}</td></tr>)}</tbody></table></div>}</section>

    {linkList.length > 0 && <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Danh mục nhân sự và lương")}</h2><div className="row wrap">{linkList.map(([, entity, label]) => <a className="btn btn-secondary btn-sm" key={entity} href={listHref(entity)}>{uiText(label)}</a>)}</div><p className="small muted" style={{ marginTop: 10 }}>{allocations.length} {uiText("bản ghi hạn mức nghỉ đang được cấu hình. Hạn mức, ngày lễ, nghỉ trùng và hiệu lực kỳ lương được kiểm tra trên máy chủ.")}</p></section>}
  </div>;
}
