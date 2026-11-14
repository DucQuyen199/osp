import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';
import { listHref, recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const nowIso = () => {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = Math.abs(offsetMinutes);
  const localTimestamp = new Date(now.getTime() + offsetMinutes * 60000).toISOString().slice(0, -1);
  return `${localTimestamp}${sign}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`;
};
const fmtTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '--';

export default function HrmOperationsPage() {
  const [employees, setEmployees] = useState([]);
  const [employeeMap, setEmployeeMap] = useState(new Map());
  const [departments, setDepartments] = useState(new Map());
  const [positions, setPositions] = useState(new Map());
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [salaryRevisions, setSalaryRevisions] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(localDate());
  const [punchEmployee, setPunchEmployee] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '' });
  const [leaveForm, setLeaveForm] = useState({ employee: '', kind: 'annual', start_date: '', end_date: '', partial_day: 'full', pay_treatment: 'paid', reason: '' });
  const [revisionForm, setRevisionForm] = useState({ employee: '', effective_from: '', base_salary: '', reason: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [employeeRes, leaveRes, attendanceRes, revisionRes, allocationRes, departmentMap, positionMap, requestRes] = await Promise.all([
        can('hrm.employee.read') ? api(`${dataPath('hrm.employee')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.leave_request.read') ? api(`${dataPath('hrm.leave_request')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.attendance.read') ? api(`${dataPath('hrm.attendance')}?limit=3000`) : Promise.resolve({ items: [] }),
        can('hrm.salary_revision.read') ? api(`${dataPath('hrm.salary_revision')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('hrm.leave_allocation.read') ? api(`${dataPath('hrm.leave_allocation')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.department.read') ? loadRefs('hrm.department') : Promise.resolve(new Map()),
        can('hrm.position.read') ? loadRefs('hrm.position') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? api(`${dataPath('workflow-approval.approval_request')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      const employeeRows = itemsOf(employeeRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      setEmployees(employeeRows); setEmployeeMap(new Map(employeeRows.map((row) => [row.id, row])));
      setLeaveRequests(itemsOf(leaveRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setAttendance(itemsOf(attendanceRes).filter((row) => row.date === attendanceDate).sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || ''))));
      setSalaryRevisions(itemsOf(revisionRes).sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || ''))));
      setAllocations(itemsOf(allocationRes)); setDepartments(departmentMap); setPositions(positionMap); setApprovalRequests(itemsOf(requestRes));
      const activeEmployee = employeeRows.find((row) => row.status === 'active');
      setPunchEmployee((id) => employeeRows.some((row) => row.id === id && row.status === 'active') ? id : activeEmployee?.id || '');
      setLeaveForm((form) => ({ ...form, employee: employeeRows.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
      setRevisionForm((form) => ({ ...form, employee: employeeRows.some((row) => row.id === form.employee && row.status === 'active') ? form.employee : activeEmployee?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu nhân sự.'); }
    finally { if (!quiet) setLoading(false); }
  }, [attendanceDate, workflowApproval]);

  useEffect(() => { document.title = 'Vận hành nhân sự · OSP Suite'; load(); }, [load]);
  const activeEmployees = employees.filter((row) => row.status === 'active');
  const pendingLeaves = leaveRequests.filter((row) => row.status === 'submitted');
  const pendingRevisions = salaryRevisions.filter((row) => row.status === 'submitted');
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
    const body = { name: employeeForm.name.trim(), code: employeeForm.code.trim() || undefined, department: employeeForm.department || undefined, position: employeeForm.position || undefined, email: employeeForm.email.trim() || undefined, phone: employeeForm.phone.trim() || undefined, hire_date: employeeForm.hire_date || undefined, base_salary: employeeForm.base_salary ? Number(employeeForm.base_salary) : undefined };
    await run('employee:create', async () => { await api(dataPath('hrm.employee'), { method: 'POST', body }); setEmployeeForm({ name: '', code: '', department: '', position: '', email: '', phone: '', hire_date: localDate(), base_salary: '' }); }, 'Đã tạo hồ sơ nhân viên mới. Thay đổi lương sau tuyển dụng cần tạo điều chỉnh có ngày hiệu lực.');
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

    {can('hrm.employee.create') && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Tiếp nhận nhân viên</h2><form onSubmit={createEmployee}><div className="form-grid"><label className="field"><span className="label">Họ và tên *</span><input className="input" required value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}/></label><label className="field"><span className="label">Mã nhân viên</span><input className="input" value={employeeForm.code} onChange={(event) => setEmployeeForm({ ...employeeForm, code: event.target.value })}/></label><label className="field"><span className="label">Email</span><input className="input" type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm({ ...employeeForm, email: event.target.value })}/></label><label className="field"><span className="label">Điện thoại</span><input className="input" type="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })}/></label><label className="field"><span className="label">Phòng ban</span><select className="select" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option value="">Chọn phòng ban</option>{[...departments.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.department', row)}</option>)}</select></label><label className="field"><span className="label">Chức danh</span><select className="select" value={employeeForm.position} onChange={(event) => setEmployeeForm({ ...employeeForm, position: event.target.value })}><option value="">Chọn chức danh</option>{[...positions.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.position', row)}</option>)}</select></label><label className="field"><span className="label">Ngày vào làm</span><input className="input" type="date" value={employeeForm.hire_date} onChange={(event) => setEmployeeForm({ ...employeeForm, hire_date: event.target.value })}/></label><label className="field"><span className="label">Lương cơ bản ban đầu</span><input className="input num" type="number" min="0" step="any" value={employeeForm.base_salary} onChange={(event) => setEmployeeForm({ ...employeeForm, base_salary: event.target.value })}/></label></div><div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Tạo hồ sơ</button></div></form></section>}

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
