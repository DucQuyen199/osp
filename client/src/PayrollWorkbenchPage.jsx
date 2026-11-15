import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localMonth } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';
import { listHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const weekdayOptions = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']];

export default function PayrollWorkbenchPage() {
  const [runs, setRuns] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ period: localMonth(), hours_per_day: '8', working_weekdays: [1, 2, 3, 4, 5], payment_date: '', payment_method: 'bank' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [runRes, slipRes, employeeMap, requestRes] = await Promise.all([
        can('payroll.payroll_run.read') ? loadAllResponse('payroll.payroll_run') : Promise.resolve({ items: [] }),
        can('payroll.payslip.read') ? loadAllResponse('payroll.payslip') : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const runRows = itemsOf(runRes).sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setRuns(runRows); setPayslips(itemsOf(slipRes)); setEmployees(employeeMap); setApprovalRequests(itemsOf(requestRes));
      setSelectedId((id) => runRows.some((row) => row.id === id) ? id : runRows[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được bảng lương.'); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowApproval]);

  useEffect(() => { document.title = 'Bảng lương · OSP Suite'; load(); }, [load]);
  const selected = runs.find((row) => row.id === selectedId);
  const runSlips = useMemo(() => payslips.filter((row) => row.run === selectedId).sort((a, b) => String(employees.get(a.employee)?.name || '').localeCompare(String(employees.get(b.employee)?.name || ''), 'vi')), [payslips, selectedId, employees]);
  const requestByRun = approvalRequests.find((row) => row.entity === 'payroll.payroll_run' && row.record_id === selectedId);
  const totals = useMemo(() => ({
    draft: runs.filter((row) => ['draft', 'rejected'].includes(row.status)).length,
    pending: runs.filter((row) => row.status === 'submitted').length,
    approved: runs.filter((row) => row.status === 'approved').length,
    paid: runs.filter((row) => row.status === 'paid').length,
  }), [runs]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createRun(event) {
    event.preventDefault();
    await run('create', async () => {
      const row = await api(dataPath('payroll.payroll_run'), { method: 'POST', body: { period: form.period, hours_per_day: Number(form.hours_per_day || 8), working_weekdays: form.working_weekdays, payment_date: form.payment_date, payment_method: form.payment_method } });
      setSelectedId(row.id); setForm((current) => ({ ...current, period: '', payment_date: '' }));
    }, 'Đã mở bảng lương nháp. Hãy hoàn tất chấm công, nghỉ phép và các khoản điều chỉnh trước khi tính.');
  }

  async function doAction(row, verb) {
    const messages = {
      calculated: 'Đã tính phiếu lương theo nhân viên, lương hiệu lực, chấm công, nghỉ phép, ngày lễ, tăng ca và chính sách thuế/đóng góp đã duyệt.',
      submitted: 'Đã khóa bảng lương và gửi duyệt. Không thể thay đổi dữ liệu đầu vào trong kỳ sau bước này.',
      approved: 'Đã duyệt bảng lương; hệ thống ghi nhận bút toán chi phí và công nợ lương.',
      rejected: 'Bảng lương bị từ chối. Hãy hủy bản nháp này, điều chỉnh dữ liệu đầu vào rồi lập kỳ thay thế.',
      paid: 'Đã ghi nhận thanh toán lương qua tài khoản đã chọn.',
      cancelled: 'Đã hủy bảng lương nháp.',
    };
    await run(`${row.id}:${verb}`, () => action('payroll.payroll_run', row, verb), messages[verb]);
  }

  const runApproval = (row) => approvalRequests.find((item) => item.entity === 'payroll.payroll_run' && item.record_id === row.id);
  const canDirectApprove = !workflowApproval && can('payroll.payroll_run.approved');
  const inputLinks = [
    ['payroll.overtime_entry.read', 'payroll.overtime_entry', 'Tăng ca'],
    ['payroll.payroll_adjustment.read', 'payroll.payroll_adjustment', 'Điều chỉnh lương'],
    ['payroll.tax_policy.read', 'payroll.tax_policy', 'Chính sách thuế'],
    ['payroll.contribution_policy.read', 'payroll.contribution_policy', 'Chính sách đóng góp'],
    ['payroll.contribution_remittance.read', 'payroll.contribution_remittance', 'Nộp khoản đóng góp'],
    ['hrm.attendance.read', 'hrm.attendance', 'Chấm công'],
    ['hrm.leave_request.read', 'hrm.leave_request', 'Nghỉ phép'],
  ].filter(([permission]) => can(permission));

  return <div className="page">
    <div className="page-head"><div><h1>Điều hành bảng lương</h1><p className="sub">Chốt kỳ lương từ chấm công, phép, tăng ca và chính sách đã duyệt; gửi phê duyệt, ghi sổ kế toán và xác nhận chi trả.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Nháp / cần xử lý</span><strong className="stat-value">{totals.draft}</strong></div><div className="card stat"><span className="stat-label">Chờ duyệt</span><strong className="stat-value">{totals.pending}</strong></div><div className="card stat"><span className="stat-label">Đã duyệt / chờ trả</span><strong className="stat-value">{totals.approved}</strong></div><div className="card stat"><span className="stat-label">Đã chi trả</span><strong className="stat-value">{totals.paid}</strong></div></div>

    {can('payroll.payroll_run.create') && <section className="card card-pad"><h2>Mở kỳ lương</h2><form className="form-grid" onSubmit={createRun}><label className="field"><span className="label">Kỳ lương *</span><input className="input" required type="month" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })}/></label><label className="field"><span className="label">Giờ chuẩn mỗi ngày</span><input className="input num" type="number" min="1" max="24" step="0.25" value={form.hours_per_day} onChange={(event) => setForm({ ...form, hours_per_day: event.target.value })}/><span className="small muted">Giờ chấm công được quy đổi thành tỷ lệ ngày công theo chuẩn này; thời gian vượt tính qua tăng ca đã duyệt.</span></label><fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Ngày làm việc trong tuần *</legend><div className="row wrap" style={{ gap: 12 }}>{weekdayOptions.map(([day, label]) => <label className="row small" key={day} style={{ gap: 5 }}><input type="checkbox" checked={form.working_weekdays.includes(day)} onChange={() => setForm((current) => ({ ...current, working_weekdays: current.working_weekdays.includes(day) ? current.working_weekdays.filter((value) => value !== day) : [...current.working_weekdays, day].sort((a, b) => a - b) }))}/>{label}</label>)}</div><span className="small muted">Mặc định thứ Hai–thứ Sáu. Lịch này được chốt trong kỳ lương; ca xoay riêng từng nhân viên chưa được áp dụng.</span></fieldset><label className="field"><span className="label">Ngày dự kiến chi *</span><input className="input" required type="date" value={form.payment_date} onChange={(event) => setForm({ ...form, payment_date: event.target.value })}/></label><label className="field"><span className="label">Phương thức chi *</span><select className="select" required value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}><option value="bank">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label><div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !form.period || !form.payment_date || !form.working_weekdays.length}>Tạo kỳ lương nháp</button></div></form></section>}

    <section className="card card-pad" style={{ marginTop: 16 }}><div className="row wrap"><h2>Đầu vào và chính sách</h2><span className="grow"/><span className="small muted">Hoàn tất và duyệt dữ liệu nguồn trước khi tính kỳ lương.</span></div><div className="row wrap" style={{ marginTop: 8 }}>{inputLinks.map(([, entity, label]) => <a className="btn btn-secondary btn-sm" key={entity} href={listHref(entity)}>{label}</a>)}</div></section>

    {loading ? <div className="skeleton" data-h="row"/> : !runs.length ? <div className="card card-pad empty" style={{ marginTop: 16 }}>Chưa có kỳ lương. Mở kỳ mới sau khi xác nhận kỳ chấm công và chính sách lương.</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Các kỳ lương</h2><div className="table-wrap"><table className="table"><thead><tr><th>Kỳ</th><th>Ngày chi</th><th>Thực nhận</th><th>Trạng thái</th></tr></thead><tbody>{runs.map((row) => <tr key={row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{row.period}</strong><div className="small muted">{runSlips.length && selectedId === row.id ? `${runSlips.length} phiếu lương` : ''}</div></td><td>{fmtDate(row.payment_date)}</td><td>{fmtMoney(row.total_net || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>Bảng lương {selected.period}</h2><div className="small muted">{runSlips.length} nhân viên · {fmtMoney(selected.total_net || 0)} thực nhận · Chi ngày {fmtDate(selected.payment_date)} bằng {selected.payment_method === 'cash' ? 'tiền mặt' : 'chuyển khoản'} · Lịch làm việc: {(Array.isArray(selected.working_weekdays) ? selected.working_weekdays : [1, 2, 3, 4, 5]).map((day) => weekdayOptions.find(([number]) => number === Number(day))?.[1]).filter(Boolean).join(', ')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        {selected.status === 'submitted' && workflowApproval && runApproval(selected) && <p className="small muted" style={{ marginTop: 10 }}>Yêu cầu duyệt: <a href={`#/e/workflow-approval/approval_request/${runApproval(selected).id}`}>{statusLabel(runApproval(selected).status)} · mở yêu cầu</a></p>}
        <div className="row wrap" style={{ margin: '12px 0' }}>{selected.status === 'draft' && can('payroll.payroll_run.calculated') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'calculated')}>{runSlips.length ? 'Tính lại từ dữ liệu hiện tại' : 'Tính bảng lương'}</button>}{selected.status === 'draft' && can('payroll.payroll_run.submitted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !runSlips.length || Number(selected.total_net) <= 0} onClick={() => doAction(selected, 'submitted')}>Gửi duyệt và khóa kỳ</button>}{selected.status === 'submitted' && canDirectApprove && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'approved')}>Duyệt và ghi sổ</button>{can('payroll.payroll_run.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'rejected')}>Từ chối</button>}</>}{selected.status === 'approved' && can('payroll.payroll_run.paid') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !selected.payment_date || !selected.payment_method} onClick={() => doAction(selected, 'paid')}>Xác nhận đã chi trả</button>}{['draft','rejected'].includes(selected.status) && can('payroll.payroll_run.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'cancelled')}>Hủy bản nháp</button>}</div>
        {runSlips.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>Nhân viên</th><th>Ngày công</th><th>Lương gộp</th><th>Khấu trừ</th><th>Thực nhận</th></tr></thead><tbody>{runSlips.map((slip) => <tr key={slip.id}><td>{employees.get(slip.employee) ? recordLabel('hrm.employee', employees.get(slip.employee)) : 'Nhân viên'}</td><td>{slip.paid_days} / {slip.working_days}</td><td>{fmtMoney(slip.gross || 0)}</td><td>{fmtMoney((Number(slip.deductions) || 0) + (Number(slip.income_tax) || 0) + (Number(slip.employee_contribution) || 0))}</td><td><strong>{fmtMoney(slip.net || 0)}</strong></td></tr>)}</tbody><tfoot><tr><th colSpan="4">Tổng thực nhận</th><th>{fmtMoney(runSlips.reduce((sum, slip) => sum + Number(slip.net || 0), 0))}</th></tr></tfoot></table></div>}
        {selected.status === 'draft' && <p className="small muted" style={{ marginTop: 12 }}>Tính lại sẽ thay thế toàn bộ phiếu lương nháp của kỳ. Sau khi gửi duyệt, kỳ bị khóa; thay đổi chấm công/nhân sự cần hoàn tất trước thời điểm này.</p>}
      </section>}
    </div>}
    <p className="small muted" style={{ marginTop: 12 }}>Khi duyệt, hệ thống tạo bút toán chi phí và công nợ lương. Khi xác nhận đã trả, hệ thống tạo payment kế toán qua tài khoản tiền mặt hoặc ngân hàng tương ứng.</p>
  </div>;
}
