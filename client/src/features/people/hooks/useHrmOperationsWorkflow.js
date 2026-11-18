import { useEffect, useMemo, useState } from 'react';
import { addCalendarDays, localDate, localDateTimeToIso } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const nowIso = () => new Date().toISOString();
const nextLocalDate = (date) => addCalendarDays(date, 1);

export function useHrmOperationsWorkflow({ data, attendanceDate, scheduleForm, setScheduleForm, t = uiText }) {
  const { employees, attendance, scheduleEntries, load } = data;
  const [punchEmployee, setPunchEmployee] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' });
  const [leaveForm, setLeaveForm] = useState({ employee: '', kind: 'annual', start_date: '', end_date: '', partial_day: 'full', pay_treatment: 'paid', reason: '' });
  const [revisionForm, setRevisionForm] = useState({ employee: '', effective_from: '', base_salary: '', reason: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const activeEmployee = employees.find((row) => row.status === 'active');
    setPunchEmployee((id) => employees.some((row) => row.id === id && row.status === 'active') ? id : activeEmployee?.id || '');
    setLeaveForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    setRevisionForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    setScheduleForm((form) => ({ ...form, employee: employees.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
  }, [employees, setScheduleForm]);

  const attendanceByEmployee = useMemo(() => new Map(attendance.map((row) => [row.employee, row])), [attendance]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || t('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createEmployee(event) {
    event.preventDefault();
    const body = { name: employeeForm.name.trim(), code: employeeForm.code.trim() || undefined, department: employeeForm.department || undefined, position: employeeForm.position || undefined, email: employeeForm.email.trim() || undefined, phone: employeeForm.phone.trim() || undefined, hire_date: employeeForm.hire_date || undefined, base_salary: employeeForm.base_salary.trim() || undefined, work_weekdays: employeeForm.customSchedule ? employeeForm.work_weekdays : undefined, standard_hours_per_day: employeeForm.customSchedule ? Number(employeeForm.standard_hours_per_day || 8) : undefined };
    await run('employee:create', async () => { await api(dataPath('hrm.employee'), { method: 'POST', body }); setEmployeeForm({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '', customSchedule: false, work_weekdays: [1, 2, 3, 4, 5], standard_hours_per_day: '8' }); }, t('Đã tạo hồ sơ nhân viên mới. Thay đổi lương sau tuyển dụng cần tạo điều chỉnh có ngày hiệu lực.'));
  }

  async function punchIn() {
    if (!punchEmployee) return;
    const existing = attendanceByEmployee.get(punchEmployee);
    await run('punch-in', async () => {
      if (existing) await api(dataPath('hrm.attendance', existing.id), { method: 'PATCH', body: { check_in: nowIso() } });
      else await api(dataPath('hrm.attendance'), { method: 'POST', body: { employee: punchEmployee, date: attendanceDate, check_in: nowIso() } });
    }, t('Đã ghi nhận giờ vào.'));
  }
  async function punchOut(row) {
    await run(`${row.id}:punch-out`, () => api(dataPath('hrm.attendance', row.id), { method: 'PATCH', body: { check_out: nowIso() } }), t('Đã ghi nhận giờ ra.'));
  }

  async function saveScheduleEntry(event) {
    event.preventDefault();
    const existing = scheduleEntries.find((row) => row.employee === scheduleForm.employee && row.work_date === scheduleForm.work_date);
    const endDate = scheduleForm.end_time <= scheduleForm.start_time ? nextLocalDate(scheduleForm.work_date) : scheduleForm.work_date;
    const startAt = scheduleForm.is_working ? localDateTimeToIso(`${scheduleForm.work_date}T${scheduleForm.start_time}`) : null;
    const endAt = scheduleForm.is_working ? localDateTimeToIso(`${endDate}T${scheduleForm.end_time}`) : null;
    if (scheduleForm.is_working && (!startAt || !endAt)) {
      setError(t('Giờ ca này không tồn tại trong múi giờ kinh doanh đã chọn do chuyển đổi giờ mùa hè.'));
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
    }, existing ? t('Đã cập nhật lịch làm việc trong ngày.') : t('Đã thêm lịch làm việc trong ngày.'));
  }
  async function removeScheduleEntry(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_entry', row.id), { method: 'DELETE' }), t('Đã xóa ngoại lệ lịch; ngày này trở về lịch tuần của nhân viên.'));
  }

  async function createLeave(event) {
    event.preventDefault();
    await run('leave:create', async () => {
      const row = await api(dataPath('hrm.leave_request'), { method: 'POST', body: { ...leaveForm, reason: leaveForm.reason.trim() || undefined } });
      await action('hrm.leave_request', row, 'submitted'); setLeaveForm((form) => ({ ...form, start_date: '', end_date: '', reason: '' }));
    }, t('Đã gửi yêu cầu nghỉ phép. Hạn mức, ngày làm việc, ngày lễ và đơn trùng được kiểm tra trên máy chủ.'));
  }
  async function leaveDecision(row, verb) {
    const messages = { approved: t('Đã duyệt nghỉ phép và cập nhật dữ liệu nguồn cho chấm công/bảng lương.'), rejected: t('Đã từ chối yêu cầu nghỉ phép.') };
    await run(`${row.id}:${verb}`, () => action('hrm.leave_request', row, verb), messages[verb]);
  }
  async function createRevision(event) {
    event.preventDefault();
    await run('revision:create', async () => {
      const row = await api(dataPath('hrm.salary_revision'), { method: 'POST', body: { ...revisionForm, base_salary: revisionForm.base_salary.trim(), reason: revisionForm.reason.trim() } });
      await action('hrm.salary_revision', row, 'submitted'); setRevisionForm((form) => ({ ...form, effective_from: '', base_salary: '', reason: '' }));
    }, t('Đã gửi đề nghị điều chỉnh lương. Mức mới chỉ có hiệu lực sau khi được duyệt theo ngày hiệu lực.'));
  }
  async function revisionDecision(row, verb) {
    await run(`${row.id}:${verb}`, () => action('hrm.salary_revision', row, verb), verb === 'approved' ? t('Đã duyệt mức lương mới có hiệu lực theo kỳ.') : t('Đã từ chối đề nghị điều chỉnh lương.'));
  }
  async function terminateEmployee(row) {
    const terminationDate = localDate();
    await run(`${row.id}:terminated`, async () => {
      await api(dataPath('hrm.employee', row.id, 'terminated'), { method: 'POST', body: { termination_date: terminationDate } });
    }, t('Đã kết thúc hồ sơ nhân viên. Máy chủ đã kiểm tra chấm công và nghỉ phép còn vướng.'));
  }

  return {
    punchEmployee, setPunchEmployee, employeeForm, setEmployeeForm, leaveForm, setLeaveForm,
    revisionForm, setRevisionForm, busy, error, notice, attendanceByEmployee,
    run, createEmployee, punchIn, punchOut, saveScheduleEntry, removeScheduleEntry,
    createLeave, leaveDecision, createRevision, revisionDecision, terminateEmployee,
  };
}
