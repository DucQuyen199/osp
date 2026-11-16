import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localMonth } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';
import payrollEnglish from './payroll.en.js';

const t = (text) => uiTextWith(text, payrollEnglish);

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const weekdayOptions = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']];
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && (/^[\s]*[=+@]/.test(text) || /^[\s]*-/.test(text)) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

export default function PayrollWorkbenchPage() {
  const [runs, setRuns] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [taxDeductions, setTaxDeductions] = useState([]);
  const [taxPolicies, setTaxPolicies] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ period: localMonth(), hours_per_day: '8', working_weekdays: [1, 2, 3, 4, 5], payment_date: '', payment_method: 'bank' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reportYear, setReportYear] = useState(localMonth().slice(0, 4));
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [runRes, slipRes, employeeMap, requestRes, taxDeductionRes, taxPolicyRes] = await Promise.all([
        can('payroll.payroll_run.read') ? loadAllResponse('payroll.payroll_run') : Promise.resolve({ items: [] }),
        can('payroll.payslip.read') ? loadAllResponse('payroll.payslip') : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('payroll.tax_deduction.read') ? loadAllResponse('payroll.tax_deduction') : Promise.resolve({ items: [] }),
        can('payroll.tax_policy.read') ? loadAllResponse('payroll.tax_policy') : Promise.resolve({ items: [] }),
      ]);
      const runRows = itemsOf(runRes).sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setRuns(runRows); setPayslips(itemsOf(slipRes)); setEmployees(employeeMap); setApprovalRequests(itemsOf(requestRes));
      setTaxDeductions(itemsOf(taxDeductionRes)); setTaxPolicies(itemsOf(taxPolicyRes));
      setSelectedId((id) => runRows.some((row) => row.id === id) ? id : runRows[0]?.id || '');
    } catch (reason) { setError(t(reason.message || 'Không tải được bảng lương.')); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowApproval]);

  useEffect(() => { document.title = `${t('Bảng lương')} · OSP Suite`; load(); }, [load]);
  const selected = runs.find((row) => row.id === selectedId);
  const runSlips = useMemo(() => payslips.filter((row) => row.run === selectedId).sort((a, b) => String(employees.get(a.employee)?.name || '').localeCompare(String(employees.get(b.employee)?.name || ''), 'vi')), [payslips, selectedId, employees]);
  const annualDeductionCaps = useMemo(() => {
    const start = `${reportYear}-01-01`;
    const end = `${reportYear}-12-31`;
    const policies = taxPolicies.filter((policy) => policy.status === 'approved' && String(policy.effective_from || '') <= end && String(policy.effective_to || '9999-12-31') >= start);
    const getCap = (field) => {
      if (!policies.length || policies.some((policy) => policy[field] === null || policy[field] === undefined || policy[field] === '')) return null;
      const values = policies.map((policy) => policy[field]).filter((value) => value !== null && value !== undefined && value !== '').map(Number);
      if (!values.length || values.some((value) => !Number.isFinite(value)) || values.some((value) => value !== values[0])) return null;
      return values[0];
    };
    return { medical: getCap('annual_medical_deduction_cap'), education: getCap('annual_education_deduction_cap') };
  }, [taxPolicies, reportYear]);
  const annualReport = useMemo(() => {
    const paidRuns = new Set(runs.filter((row) => row.status === 'paid' && String(row.payment_date || '').startsWith(`${reportYear}-`)).map((row) => row.id));
    const byEmployee = new Map();
    for (const slip of payslips) {
      if (!paidRuns.has(slip.run) || !slip.employee) continue;
      const current = byEmployee.get(slip.employee) || { employee: slip.employee, paidRuns: new Set(), gross: 0, taxable_income: 0, income_tax: 0, employee_contribution: 0, net: 0 };
      current.paidRuns.add(slip.run);
      for (const field of ['gross', 'taxable_income', 'income_tax', 'employee_contribution', 'net']) current[field] += Number(slip[field]) || 0;
      byEmployee.set(slip.employee, current);
    }
    for (const claim of taxDeductions) {
      if (claim.status !== 'approved' || String(claim.tax_year) !== reportYear || !claim.employee) continue;
      const current = byEmployee.get(claim.employee) || { employee: claim.employee, paidRuns: new Set(), gross: 0, taxable_income: 0, income_tax: 0, employee_contribution: 0, net: 0, medical_claims: 0, education_claims: 0 };
      const field = claim.category === 'medical' ? 'medical_claims' : claim.category === 'education' ? 'education_claims' : null;
      if (field) current[field] = (current[field] || 0) + (Number(claim.approved_amount) || 0);
      byEmployee.set(claim.employee, current);
    }
    return [...byEmployee.values()].map((row) => ({
      ...row,
      paidRuns: row.paidRuns.size,
      gross: Math.round((row.gross + Number.EPSILON) * 100) / 100,
      taxable_income: Math.round((row.taxable_income + Number.EPSILON) * 100) / 100,
      income_tax: Math.round((row.income_tax + Number.EPSILON) * 100) / 100,
      employee_contribution: Math.round((row.employee_contribution + Number.EPSILON) * 100) / 100,
      net: Math.round((row.net + Number.EPSILON) * 100) / 100,
      medical_deduction: annualDeductionCaps.medical === null ? null : Math.min(Math.round(((row.medical_claims || 0) + Number.EPSILON) * 100) / 100, annualDeductionCaps.medical),
      education_deduction: annualDeductionCaps.education === null ? null : Math.min(Math.round(((row.education_claims || 0) + Number.EPSILON) * 100) / 100, annualDeductionCaps.education),
    })).sort((a, b) => String(employees.get(a.employee)?.name || '').localeCompare(String(employees.get(b.employee)?.name || ''), 'vi'));
  }, [runs, payslips, employees, taxDeductions, annualDeductionCaps, reportYear]);
  const reportYears = useMemo(() => {
    const years = new Set([localMonth().slice(0, 4), ...runs.map((row) => String(row.period || '').slice(0, 4)), ...taxDeductions.map((row) => String(row.tax_year || ''))].filter((year) => /^\d{4}$/.test(year)));
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [runs, taxDeductions]);
  const requestByRun = approvalRequests.find((row) => row.entity === 'payroll.payroll_run' && row.record_id === selectedId);
  const totals = useMemo(() => ({
    draft: runs.filter((row) => ['draft', 'rejected'].includes(row.status)).length,
    pending: runs.filter((row) => row.status === 'submitted').length,
    approved: runs.filter((row) => row.status === 'approved').length,
    paid: runs.filter((row) => row.status === 'paid').length,
  }), [runs]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
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

  function exportAnnualReport() {
    const columns = ['Mã nhân viên', 'Nhân viên', 'Số bảng lương đã chi', 'Lương gộp', 'Thu nhập tính thuế', 'Thuế TNCN đã khấu trừ', 'Khoản đóng góp của nhân viên', 'Thực nhận', 'Giảm trừ y tế đã duyệt', 'Giảm trừ giáo dục đã duyệt'].map(t);
    const rows = annualReport.map((row) => {
      const employee = employees.get(row.employee);
      return [employee?.code || '', employee?.name || t('Nhân viên'), row.paidRuns, row.gross, row.taxable_income, row.income_tax, row.employee_contribution, row.net, row.medical_deduction ?? '', row.education_deduction ?? ''].map(csvCell).join(',');
    });
    const blob = new Blob([`\uFEFF${[columns.map(csvCell).join(','), ...rows].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `payroll-withholding-${reportYear}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const runApproval = (row) => approvalRequests.find((item) => item.entity === 'payroll.payroll_run' && item.record_id === row.id);
  const canDirectApprove = !workflowApproval && can('payroll.payroll_run.approved');
  const inputLinks = [
    ['payroll.overtime_entry.read', 'payroll.overtime_entry', 'Tăng ca'],
    ['payroll.payroll_adjustment.read', 'payroll.payroll_adjustment', 'Điều chỉnh lương'],
    ['payroll.tax_policy.read', 'payroll.tax_policy', 'Chính sách thuế'],
    ['payroll.tax_deduction.read', 'payroll.tax_deduction', 'Hồ sơ giảm trừ thuế năm'],
    ['payroll.contribution_policy.read', 'payroll.contribution_policy', 'Chính sách đóng góp'],
    ['payroll.contribution_remittance.read', 'payroll.contribution_remittance', 'Nộp khoản đóng góp'],
    ['hrm.attendance.read', 'hrm.attendance', 'Chấm công'],
    ['hrm.leave_request.read', 'hrm.leave_request', 'Nghỉ phép'],
  ].filter(([permission]) => can(permission));

  return <div className="page">
    <div className="page-head"><div><h1>{t('Điều hành bảng lương')}</h1><p className="sub">{t('Chốt kỳ lương từ chấm công, phép, tăng ca và chính sách đã duyệt; gửi phê duyệt, ghi sổ kế toán và xác nhận chi trả.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{t('Nháp / cần xử lý')}</span><strong className="stat-value">{totals.draft}</strong></div><div className="card stat"><span className="stat-label">{t('Chờ duyệt')}</span><strong className="stat-value">{totals.pending}</strong></div><div className="card stat"><span className="stat-label">{t('Đã duyệt / chờ trả')}</span><strong className="stat-value">{totals.approved}</strong></div><div className="card stat"><span className="stat-label">{t('Đã chi trả')}</span><strong className="stat-value">{totals.paid}</strong></div></div>

    {can('payroll.payroll_run.create') && <section className="card card-pad"><h2>{t('Mở kỳ lương')}</h2><form className="form-grid" onSubmit={createRun}><label className="field"><span className="label">{t('Kỳ lương *')}</span><input className="input" required type="month" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })}/></label><label className="field"><span className="label">{t('Giờ chuẩn mặc định mỗi ngày')}</span><input className="input num" type="number" min="1" max="24" step="0.25" value={form.hours_per_day} onChange={(event) => setForm({ ...form, hours_per_day: event.target.value })}/><span className="small muted">{t('Giờ chuẩn riêng trong hồ sơ nhân viên được ưu tiên; giá trị này dùng khi nhân viên chưa cấu hình. Thời gian vượt chuẩn tính qua tăng ca đã duyệt.')}</span></label><fieldset className="field u-legacy-d865c2ed50" ><legend className="label">{t('Ngày làm việc mặc định trong tuần *')}</legend><div className="row wrap u-legacy-d5a33b90d3" >{weekdayOptions.map(([day, label]) => <label className="row small u-legacy-0d6046eefe" key={day} ><input type="checkbox" checked={form.working_weekdays.includes(day)} onChange={() => setForm((current) => ({ ...current, working_weekdays: current.working_weekdays.includes(day) ? current.working_weekdays.filter((value) => value !== day) : [...current.working_weekdays, day].sort((a, b) => a - b) }))}/>{t(label)}</label>)}</div><span className="small muted">{t('Mặc định thứ Hai–thứ Sáu. Hệ thống ưu tiên lịch tuần của từng nhân viên và lịch theo ngày/ca xoay đã áp dụng trong HRM; lịch của kỳ dùng làm giá trị mặc định khi nhân viên chưa cấu hình.')}</span></fieldset><label className="field"><span className="label">{t('Ngày dự kiến chi *')}</span><input className="input" required type="date" value={form.payment_date} onChange={(event) => setForm({ ...form, payment_date: event.target.value })}/></label><label className="field"><span className="label">{t('Phương thức chi *')}</span><select className="select" required value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}><option value="bank">{t('Chuyển khoản')}</option><option value="cash">{t('Tiền mặt')}</option></select></label><div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !form.period || !form.payment_date || !form.working_weekdays.length}>{t('Tạo kỳ lương nháp')}</button></div></form></section>}

    <section className="card card-pad u-legacy-92c18f6bda" ><div className="row wrap"><h2>{t('Đầu vào và chính sách')}</h2><span className="grow"/><span className="small muted">{t('Hoàn tất và duyệt dữ liệu nguồn trước khi tính kỳ lương.')}</span></div><div className="row wrap u-legacy-43a97fe494" >{inputLinks.map(([, entity, label]) => <a className="btn btn-secondary btn-sm" key={entity} href={listHref(entity)}>{t(label)}</a>)}</div></section>

    {can('payroll.payroll_run.read') && can('payroll.payslip.read') && <section className="card card-pad u-legacy-92c18f6bda" ><div className="row wrap"><div><h2>{t('Tổng hợp lương và thuế theo năm')}</h2><p className="small muted">{t('Cộng phiếu từ bảng lương có ngày chi trong năm. Các khoản y tế/giáo dục là hồ sơ đã duyệt, giới hạn theo chính sách thuế năm. Nếu dùng các khoản giảm trừ này để quyết toán, cá nhân phải tự quyết toán; báo cáo không tính nghĩa vụ thuế cuối cùng.')}</p></div><span className="grow"/><label className="field"><span className="label">{t('Năm')}</span><select className="select" value={reportYear} onChange={(event) => setReportYear(event.target.value)}>{reportYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><button className="btn btn-secondary" type="button" disabled={!annualReport.length} onClick={exportAnnualReport}>{t('Tải CSV')}</button></div>
      {loading ? <div className="skeleton" data-h="row"/> : annualReport.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t('Nhân viên')}</th><th>{t('Số bảng lương đã chi')}</th><th>{t('Lương gộp')}</th><th>{t('Thu nhập tính thuế')}</th><th>{t('Thuế đã khấu trừ')}</th><th>{t('Đóng góp nhân viên')}</th><th>{t('Thực nhận')}</th><th>{t('Giảm trừ y tế')}</th><th>{t('Giảm trừ giáo dục')}</th></tr></thead><tbody>{annualReport.map((row) => <tr key={row.employee}><td>{employees.get(row.employee) ? recordLabel('hrm.employee', employees.get(row.employee)) : t('Nhân viên')}</td><td>{row.paidRuns}</td><td>{fmtMoney(row.gross)}</td><td>{fmtMoney(row.taxable_income)}</td><td>{fmtMoney(row.income_tax)}</td><td>{fmtMoney(row.employee_contribution)}</td><td><strong>{fmtMoney(row.net)}</strong></td><td>{row.medical_deduction === null ? '—' : fmtMoney(row.medical_deduction)}</td><td>{row.education_deduction === null ? '—' : fmtMoney(row.education_deduction)}</td></tr>)}</tbody><tfoot><tr><th>{t('Tổng')}</th><th>—</th>{['gross', 'taxable_income', 'income_tax', 'employee_contribution', 'net', 'medical_deduction', 'education_deduction'].map((field) => <th key={field}>{annualReport.some((row) => row[field] === null) ? '—' : fmtMoney(annualReport.reduce((sum, row) => sum + (Number(row[field]) || 0), 0))}</th>)}</tr></tfoot></table></div> : <div className="empty">{t('Chưa có payroll hoặc hồ sơ giảm trừ đã duyệt trong năm')} {reportYear}.</div>}
    </section>}

    {loading ? <div className="skeleton" data-h="row"/> : !runs.length ? <div className="card card-pad empty u-legacy-92c18f6bda" >{t('Chưa có kỳ lương. Mở kỳ mới sau khi xác nhận kỳ chấm công và chính sách lương.')}</div> : <div className="layout-split u-legacy-92c18f6bda" >
      <section className="card card-pad"><h2>{t('Các kỳ lương')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{t('Kỳ')}</th><th>{t('Ngày chi')}</th><th>{t('Thực nhận')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{runs.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={[selectedId === row.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{row.period}</strong><div className="small muted">{runSlips.length && selectedId === row.id ? `${runSlips.length} ${t('phiếu lương')}` : ''}</div></td><td>{fmtDate(row.payment_date)}</td><td>{fmtMoney(row.total_net || 0)}</td><td>{t(statusLabel(row.status))}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{t('Bảng lương')} {selected.period}</h2><div className="small muted">{runSlips.length} {t('nhân viên')} · {fmtMoney(selected.total_net || 0)} {t('thực nhận')} · {t('Chi ngày')} {fmtDate(selected.payment_date)} {t('bằng')} {t(selected.payment_method === 'cash' ? 'tiền mặt' : 'chuyển khoản')} · {t('Ngày làm việc mặc định:')} {(Array.isArray(selected.working_weekdays) ? selected.working_weekdays : [1, 2, 3, 4, 5]).map((day) => t(weekdayOptions.find(([number]) => number === Number(day))?.[1] || '')).filter(Boolean).join(', ')}</div></div><span className="grow"/><span className="badge warning">{t(statusLabel(selected.status))}</span></div>
        {selected.status === 'submitted' && workflowApproval && runApproval(selected) && <p className="small muted u-legacy-df928149c5" >{t('Yêu cầu duyệt:')} <a href={`#/e/workflow-approval/approval_request/${runApproval(selected).id}`}>{t(statusLabel(runApproval(selected).status))} · {t('mở yêu cầu')}</a></p>}
        <div className="row wrap u-legacy-0e001e227c" >{selected.status === 'draft' && can('payroll.payroll_run.calculated') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'calculated')}>{t(runSlips.length ? 'Tính lại từ dữ liệu hiện tại' : 'Tính bảng lương')}</button>}{selected.status === 'draft' && can('payroll.payroll_run.submitted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !runSlips.length || Number(selected.total_net) <= 0} onClick={() => doAction(selected, 'submitted')}>{t('Gửi duyệt và khóa kỳ')}</button>}{selected.status === 'submitted' && canDirectApprove && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'approved')}>{t('Duyệt và ghi sổ')}</button>{can('payroll.payroll_run.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'rejected')}>{t('Từ chối')}</button>}</>}{selected.status === 'approved' && can('payroll.payroll_run.paid') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !selected.payment_date || !selected.payment_method} onClick={() => doAction(selected, 'paid')}>{t('Xác nhận đã chi trả')}</button>}{['draft','rejected'].includes(selected.status) && can('payroll.payroll_run.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => doAction(selected, 'cancelled')}>{t('Hủy bản nháp')}</button>}</div>
        {runSlips.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>{t('Nhân viên')}</th><th>{t('Ngày công')}</th><th>{t('Lương gộp')}</th><th>{t('Khấu trừ')}</th><th>{t('Thực nhận')}</th></tr></thead><tbody>{runSlips.map((slip) => <tr key={slip.id}><td>{employees.get(slip.employee) ? recordLabel('hrm.employee', employees.get(slip.employee)) : t('Nhân viên')}</td><td>{slip.paid_days} / {slip.working_days}</td><td>{fmtMoney(slip.gross || 0)}</td><td>{fmtMoney(slip.deductions || 0)}</td><td><strong>{fmtMoney(slip.net || 0)}</strong></td></tr>)}</tbody><tfoot><tr><th colSpan="4">{t('Tổng thực nhận')}</th><th>{fmtMoney(runSlips.reduce((sum, slip) => sum + Number(slip.net || 0), 0))}</th></tr></tfoot></table></div>}
        {selected.status === 'draft' && <p className="small muted u-legacy-0ee7f66ad9" >{t('Tính lại sẽ thay thế toàn bộ phiếu lương nháp của kỳ. Sau khi gửi duyệt, kỳ bị khóa; thay đổi chấm công/nhân sự cần hoàn tất trước thời điểm này.')}</p>}
      </section>}
    </div>}
    <p className="small muted u-legacy-0ee7f66ad9" >{t('Khi duyệt, hệ thống tạo bút toán chi phí và công nợ lương. Khi xác nhận đã trả, hệ thống tạo payment kế toán qua tài khoản tiền mặt hoặc ngân hàng tương ứng.')}</p>
  </div>;
}
