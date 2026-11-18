import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { addCalendarDays, addCalendarMonths, localDate, localDateTimeToIso, localTime } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { listHref, recordHref } from '../../lib/routes.js';
import AttendanceEntriesTable from './components/AttendanceEntriesTable.jsx';
import WorkSchedulePatternForm from './components/WorkSchedulePatternForm.jsx';
import EmployeeIntakeForm from './components/EmployeeIntakeForm.jsx';
import LeaveRequestForm from './components/LeaveRequestForm.jsx';
import SalaryRevisionForm from './components/SalaryRevisionForm.jsx';
import WorkScheduleEntriesPanel from './components/WorkScheduleEntriesPanel.jsx';
import WorkSchedulePatternsTable from './components/WorkSchedulePatternsTable.jsx';
import { EmployeeDirectoryTable, LeaveRequestsTable, SalaryRevisionsTable } from './components/HrmWorkflowTables.jsx';
import EmployeeWeekScheduleTable from './components/EmployeeWeekScheduleTable.jsx';
import { useHrmOperationsData } from './hooks/useHrmOperationsData.js';
const fmtTime = (value) => value ? localTime(new Date(value)) : '--';
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const MAX_ROTATION_DAYS = 3653;
const MAX_GENERATED_SCHEDULE_ROWS = 40_000;
const WORKFLOW_TABLE_PAGE_SIZE = 25;
const blankScheduleCycleDay = (is_working = true) => ({ rowId: crypto.randomUUID(), is_working, start_time: is_working ? '09:00' : '', end_time: is_working ? '17:00' : '', break_minutes: is_working ? 60 : 0 });
const serializeScheduleCycle = (cycle) => cycle.map(({ rowId, ...day }) => day);
const rotationDayLimit = (employeeCount) => Math.min(MAX_ROTATION_DAYS, Math.floor(MAX_GENERATED_SCHEDULE_ROWS / Math.max(employeeCount, 1)));
const nowIso = () => new Date().toISOString();
const nextLocalDate = (date) => addCalendarDays(date, 1);
const addLocalDays = addCalendarDays;
const nextMonthStart = (date) => addCalendarMonths(`${date.slice(0, 7)}-01`, 1);
export default function HrmOperationsPage() {
  useDocumentTitle(`${uiText('Vận hành nhân sự')} · OSP Suite`);
  const weekdayOptions = [[1, uiText('T2')], [2, uiText('T3')], [3, uiText('T4')], [4, uiText('T5')], [5, uiText('T6')], [6, uiText('T7')], [7, uiText('CN')]];
  const [error, setError] = useState('');
  const [leavePage, setLeavePage] = useState(0);
  const [employeePage, setEmployeePage] = useState(0);
  const [revisionPage, setRevisionPage] = useState(0);
  const [attendanceDate, setAttendanceDate] = useState(localDate());
  const [punchEmployee, setPunchEmployee] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' });
  const [leaveForm, setLeaveForm] = useState({ employee: '', kind: 'annual', start_date: '', end_date: '', partial_day: 'full', pay_treatment: 'paid', reason: '' });
  const [revisionForm, setRevisionForm] = useState({ employee: '', effective_from: '', base_salary: '', reason: '' });
  const [scheduleForm, setScheduleForm] = useState({ employee: '', work_date: localDate(), is_working: true, start_time: '09:00', end_time: '17:00', break_minutes: '60' });
  const [patternForm, setPatternForm] = useState(() => ({ employees: [], start_date: localDate(), end_date: addLocalDays(localDate(), 27), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', cycle: [blankScheduleCycleDay(), blankScheduleCycleDay(false)] }));
  const [scheduleTemplateName, setScheduleTemplateName] = useState('');
  const [scheduleTemplateId, setScheduleTemplateId] = useState('');
  const [patternEmployeeFilter, setPatternEmployeeFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const scheduleMonth = scheduleForm.work_date.slice(0, 7);
  const scheduleMonthStart = `${scheduleMonth}-01`;
  const scheduleMonthEnd = nextMonthStart(scheduleForm.work_date);
  const { employees, employeeMap, departments, positions, leaveRequests, attendance, scheduleEntries, schedulePatterns, scheduleTemplates, salaryRevisions, allocations, approvalRequests, loading, error: dataError, load } = useHrmOperationsData(attendanceDate, scheduleMonthStart, scheduleMonthEnd, workflowApproval);
  const maxPatternEndDate = patternForm.start_date
    ? addLocalDays(patternForm.start_date, rotationDayLimit(patternForm.employees.length) - 1)
    : undefined;
  useEffect(() => {
    const activeEmployee = employees.find((row) => row.status === 'active');
    setPunchEmployee((id) => employees.some((row) => row.id === id && row.status === 'active') ? id : activeEmployee?.id || '');
    setLeaveForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    setRevisionForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    setScheduleForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    setPatternForm((form) => ({ ...form, employees: form.employees.filter((id) => employees.some((row) => row.id === id && row.status === 'active')) }));
  }, [employees]);
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
      const row = await api(dataPath('hrm.work_schedule_pattern'), { method: 'POST', body: { ...patternForm, cycle: serializeScheduleCycle(patternForm.cycle) } });
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
  function updatePatternField(field, value) {
    setPatternForm((form) => ({ ...form, [field]: value }));
  }
  function togglePatternCycleDay(index, isWorking) {
    setPatternForm((form) => ({ ...form, cycle: form.cycle.map((day, itemIndex) => itemIndex === index ? {
      ...day,
      is_working: isWorking,
      start_time: isWorking ? (day.start_time || '09:00') : '',
      end_time: isWorking ? (day.end_time || '17:00') : '',
      break_minutes: isWorking ? (day.break_minutes || 0) : 0,
    } : day) }));
  }
  function updatePatternCycleField(index, field, value) {
    setPatternForm((form) => ({ ...form, cycle: form.cycle.map((day, itemIndex) => itemIndex === index ? { ...day, [field]: value } : day) }));
  }
  function removePatternCycleDay(index) {
    setPatternForm((form) => ({ ...form, cycle: form.cycle.filter((_, itemIndex) => itemIndex !== index) }));
  }
  function addPatternCycleDay() {
    setPatternForm((form) => ({ ...form, cycle: [...form.cycle, blankScheduleCycleDay()] }));
  }
  function useScheduleTemplate(id) {
    setScheduleTemplateId(id);
    const template = scheduleTemplates.find((row) => row.id === id);
    setScheduleTemplateName(template?.name || '');
    if (template) setPatternForm((form) => ({ ...form, timezone: template.timezone || form.timezone, cycle: Array.isArray(template.cycle) ? template.cycle.map((day) => ({ ...day, rowId: crypto.randomUUID() })) : form.cycle }));
  }
  async function saveScheduleTemplate() {
    const name = scheduleTemplateName.trim();
    if (!name) return;
    await run('schedule-template:save', async () => {
      const body = { name, timezone: patternForm.timezone, cycle: serializeScheduleCycle(patternForm.cycle) };
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
    {(error || dataError) && <div className="alert danger" role="alert">{uiText(error || dataError)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{uiText("Nhân viên đang làm")}</span><strong className="stat-value">{activeEmployees.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đơn nghỉ chờ duyệt")}</span><strong className="stat-value">{pendingLeaves.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Điều chỉnh lương chờ duyệt")}</span><strong className="stat-value">{pendingRevisions.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Thiếu giờ ra hôm nay")}</span><strong className="stat-value">{attendanceDate === localDate() ? incompleteAttendance : '—'}</strong></div></div>
    <section className="card card-pad"><h2>{uiText("Chấm công trong ngày")}</h2><div className="row wrap"><label className="field"><span className="label">{uiText("Ngày")}</span><input className="input" type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)}/></label><label className="field grow"><span className="label">{uiText("Nhân viên ghi nhận giờ vào")}</span><select className="select" value={punchEmployee} onChange={(event) => setPunchEmployee(event.target.value)}><option value="">{uiText("Chọn nhân viên")}</option>{activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label>{can('hrm.attendance.create') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !punchEmployee || attendanceDate !== localDate() || Boolean(attendanceByEmployee.get(punchEmployee)?.check_in)} onClick={punchIn}>{uiText("Ghi giờ vào")}</button>}</div>
      {attendance.length > 0 && <AttendanceEntriesTable attendance={attendance} employees={employeeMap} busy={busy} canPunchOut={can('hrm.attendance.update') && attendanceDate === localDate()} onPunchOut={punchOut} />}
      {!attendance.length && !loading && <p className="small muted">{uiText("Chưa có bản ghi chấm công trong ngày đã chọn.")}</p>}
    </section>
    {(can('hrm.work_schedule_pattern.create') || can('hrm.work_schedule_pattern.read') || can('hrm.work_schedule_template.create') || can('hrm.work_schedule_template.read')) && <section className="card card-pad u-legacy-92c18f6bda" >
      <h2>{uiText("Lịch ca luân phiên")}</h2>
      <p className="small muted">{uiText("Khai báo chu kỳ ngày làm/nghỉ, ngày bắt đầu và múi giờ. Khi áp dụng, hệ thống sinh lịch theo ngày để chấm công, nghỉ phép và payroll cùng sử dụng. Mỗi đợt tối đa 10 năm và 40.000 dòng; phạm vi ngày tối đa giảm theo số nhân viên trong đội.")}</p>
      {(can('hrm.work_schedule_template.read') || can('hrm.work_schedule_template.create')) && <div className="row wrap u-legacy-b56987dbcb" >
        {can('hrm.work_schedule_template.read') && <label className="field grow"><span className="label">{uiText("Dùng mẫu ca trong thư viện")}</span><select className="select" value={scheduleTemplateId} onChange={(event) => useScheduleTemplate(event.target.value)}><option value="">{uiText("Chọn mẫu đã lưu")}</option>{scheduleTemplates.map((row) => <option key={row.id} value={row.id}>{row.name} · {Array.isArray(row.cycle) ? row.cycle.length : 0}{uiText("ngày")}</option>)}</select></label>}
        {can('hrm.work_schedule_template.create') && <><label className="field grow"><span className="label">{uiText("Tên mẫu để lưu hoặc cập nhật")}</span><input className="input" maxLength="120" value={scheduleTemplateName} onChange={(event) => setScheduleTemplateName(event.target.value)} placeholder={uiText("Ví dụ: Ca xoay 2 ngày")}/></label><button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !scheduleTemplateName.trim()} onClick={saveScheduleTemplate}>{scheduleTemplateId ? uiText('Cập nhật mẫu') : uiText('Lưu thành mẫu')}</button></>}
      </div>}
      {can('hrm.work_schedule_template.read') && scheduleTemplates.length > 0 && <div className="row wrap small muted u-legacy-b56987dbcb" ><span>{uiText("Thư viện có")} {scheduleTemplates.length} {uiText("mẫu.")}</span>{can('hrm.work_schedule_template.delete') && scheduleTemplateId && <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { const row = scheduleTemplates.find((item) => item.id === scheduleTemplateId); if (row) removeScheduleTemplate(row); }}>{uiText("Xóa mẫu đang chọn")}</button>}</div>}
      {can('hrm.work_schedule_pattern.create') && <WorkSchedulePatternForm
        patternForm={patternForm}
        matchingEmployees={matchingPatternEmployees}
        employeeFilter={patternEmployeeFilter}
        maxEndDate={maxPatternEndDate}
        dayLimit={rotationDayLimit(patternForm.employees.length)}
        busy={busy}
        canApply={can('hrm.work_schedule_pattern.applied')}
        onSubmit={createSchedulePattern}
        onEmployeeFilterChange={setPatternEmployeeFilter}
        onEmployeeToggle={updatePatternEmployees}
        onFieldChange={updatePatternField}
        onStartDateChange={updatePatternStartDate}
        onCycleDayToggle={togglePatternCycleDay}
        onCycleFieldChange={updatePatternCycleField}
        onCycleDayRemove={removePatternCycleDay}
        onCycleDayAdd={addPatternCycleDay}
      />}
      {can('hrm.work_schedule_pattern.read') && <WorkSchedulePatternsTable
        patterns={schedulePatterns} employeeMap={employeeMap} busy={busy}
        canApply={can('hrm.work_schedule_pattern.applied')} canDelete={can('hrm.work_schedule_pattern.delete')}
        onApply={applySchedulePattern} onDelete={removeSchedulePattern}
        formatDate={fmtDate} statusLabel={statusLabel} recordLabel={recordLabel}
      />}
    </section>}
    {(can('hrm.work_schedule_entry.create') || can('hrm.work_schedule_entry.read')) && <WorkScheduleEntriesPanel
      canCreate={can('hrm.work_schedule_entry.create')} canRead={can('hrm.work_schedule_entry.read')} canDelete={can('hrm.work_schedule_entry.delete')}
      scheduleForm={scheduleForm} existingEntry={scheduleEntries.some((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date)}
      scheduleEntriesThisMonth={scheduleEntriesThisMonth} activeEmployees={activeEmployees} employeeMap={employeeMap}
      recordLabel={recordLabel} busy={busy} onFormChange={(field, value) => setScheduleForm((form) => ({ ...form, [field]: value }))}
      onSubmit={saveScheduleEntry} onRemoveEntry={removeScheduleEntry} formatDate={fmtDate} formatTime={fmtTime}
    />}
    {can('hrm.employee.create') && <EmployeeIntakeForm
      form={employeeForm}
      departments={departments}
      positions={positions}
      weekdays={weekdayOptions}
      busy={busy}
      onSubmit={createEmployee}
      onFieldChange={(field, value) => setEmployeeForm((current) => ({ ...current, [field]: value }))}
      onWeekdayToggle={(day) => setEmployeeForm((current) => ({ ...current, work_weekdays: current.work_weekdays.includes(day) ? current.work_weekdays.filter((value) => value !== day) : [...current.work_weekdays, day].sort((a, b) => a - b) }))}
      recordLabel={recordLabel}
      t={uiText}
    />}
    {can('hrm.employee.read') && <EmployeeWeekScheduleTable employees={employees} weekdays={weekdayOptions} recordLabel={recordLabel} t={uiText} />}
    <div className="layout-split u-legacy-92c18f6bda" >
      {can('hrm.leave_request.create') && <LeaveRequestForm
        form={leaveForm}
        employees={activeEmployees}
        busy={busy}
        onSubmit={createLeave}
        onFieldChange={(field, value) => setLeaveForm((current) => ({ ...current, [field]: value }))}
        onKindChange={(kind) => setLeaveForm((current) => ({ ...current, kind, pay_treatment: kind === 'unpaid' ? 'unpaid' : 'paid' }))}
        onStartDateChange={(start_date) => setLeaveForm((current) => ({ ...current, start_date, end_date: current.partial_day !== 'full' || (current.end_date && current.end_date < start_date) ? start_date : current.end_date }))}
        onPartialDayChange={(partial_day) => setLeaveForm((current) => ({ ...current, partial_day, end_date: partial_day === 'full' ? current.end_date : current.start_date || current.end_date }))}
        recordLabel={recordLabel}
        t={uiText}
      />}
      {can('hrm.salary_revision.create') && <SalaryRevisionForm
        form={revisionForm} employees={activeEmployees} busy={busy} onSubmit={createRevision}
        onFieldChange={(field, value) => setRevisionForm((current) => ({ ...current, [field]: value }))}
        recordLabel={recordLabel} t={uiText}
      />}
    </div>
    <div className="layout-split u-legacy-92c18f6bda" >
      <LeaveRequestsTable
        loading={loading} leaveRequests={leaveRequests} employeeMap={employeeMap}
        page={leavePage} pageSize={WORKFLOW_TABLE_PAGE_SIZE} onPageChange={setLeavePage}
        workflowApproval={workflowApproval} approvalFor={approvalFor} can={can} busy={busy}
        onDecision={leaveDecision}
        onSubmitAgain={(row) => run(`${row.id}:submitted`, () => action('hrm.leave_request', row, 'submitted'), uiText('Đã gửi lại đơn nghỉ phép.'))}
        statusLabel={statusLabel} formatDate={fmtDate} t={uiText}
      />
      <EmployeeDirectoryTable
        loading={loading} employees={employees} departments={departments} positions={positions}
        page={employeePage} pageSize={WORKFLOW_TABLE_PAGE_SIZE} onPageChange={setEmployeePage}
        can={can} busy={busy} onTerminate={terminateEmployee} recordLabel={recordLabel}
        formatDate={fmtDate} statusLabel={statusLabel} t={uiText}
      />
    </div>
    <SalaryRevisionsTable
      salaryRevisions={salaryRevisions} employeeMap={employeeMap} can={can} busy={busy}
      page={revisionPage} pageSize={WORKFLOW_TABLE_PAGE_SIZE} onPageChange={setRevisionPage}
      onDecision={revisionDecision}
      onSubmitAgain={(row) => run(`${row.id}:submitted`, () => action('hrm.salary_revision', row, 'submitted'), uiText('Đã gửi lại đề nghị điều chỉnh.'))}
      statusLabel={statusLabel} formatDate={fmtDate} formatMoney={fmtMoney} t={uiText}
    />
    {linkList.length > 0 && <section className="card card-pad u-legacy-92c18f6bda" ><h2>{uiText("Danh mục nhân sự và lương")}</h2><div className="row wrap">{linkList.map(([, entity, label]) => <a className="btn btn-secondary btn-sm" key={entity} href={listHref(entity)}>{uiText(label)}</a>)}</div><p className="small muted u-legacy-df928149c5" >{allocations.length} {uiText("bản ghi hạn mức nghỉ đang được cấu hình. Hạn mức, ngày lễ, nghỉ trùng và hiệu lực kỳ lương được kiểm tra trên máy chủ.")}</p></section>}
  </div>;
}
