import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, app, loadAllResponse } from '../../lib/state.js';
import { listHref, recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export default function ExpenseWorkbenchPage() {
  const [claims, setClaims] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ employee: '', payment_date: '', payment_method: 'bank', note: '' });
  const [lines, setLines] = useState([{ description: '', amount: '', account_code: '' }]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [claimRes, employeeMap, accountMap, paymentRes, requestRes] = await Promise.all([
        can('expense.expense_claim.read') ? api(`${dataPath('expense.expense_claim')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
        can('accounting.payment.read') ? api(`${dataPath('accounting.payment')}?limit=2000`) : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const claimRows = itemsOf(claimRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const expenseAccounts = [...accountMap.values()].filter((row) => row.kind === 'expense').sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      setClaims(claimRows); setEmployees(employeeMap); setAccounts(expenseAccounts); setPayments(itemsOf(paymentRes)); setApprovalRequests(itemsOf(requestRes));
      setSelectedId((id) => claimRows.some((row) => row.id === id) ? id : claimRows[0]?.id || '');
      setForm((current) => ({ ...current, employee: current.employee || [...employeeMap.values()].find((row) => row.status === 'active')?.id || '' }));
      setLines((current) => current.map((line) => ({ ...line, account_code: line.account_code || expenseAccounts[0]?.code || '' })));
    } catch (reason) { setError(reason.message || uiText('Không tải được đề nghị chi phí.')); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowApproval]);

  useEffect(() => { document.title = `${uiText('Chi phí và hoàn ứng nhân viên')} · OSP Suite`; load(); }, [load]);
  const selected = claims.find((row) => row.id === selectedId);
  const stats = useMemo(() => ({ draft: claims.filter((row) => ['draft', 'rejected'].includes(row.status)).length, pending: claims.filter((row) => row.status === 'submitted').length, approved: claims.filter((row) => row.status === 'approved').length, paid: claims.filter((row) => row.status === 'paid').length }), [claims]);
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createClaim(event) {
    event.preventDefault();
    const claimItems = lines.filter((line) => line.account_code && Number(line.amount) > 0).map((line) => ({ description: line.description.trim() || undefined, amount: Number(line.amount), account_code: line.account_code }));
    if (!claimItems.length) { setError(uiText('Thêm ít nhất một khoản chi hợp lệ.')); return; }
    await run('claim:create', async () => {
      const claim = await api(dataPath('expense.expense_claim'), { method: 'POST', body: { ...form, items: claimItems, note: form.note.trim() || undefined } });
      await action('expense.expense_claim', claim, 'submitted'); setSelectedId(claim.id);
      setForm((current) => ({ ...current, payment_date: '', note: '' })); setLines([{ description: '', amount: '', account_code: accounts[0]?.code || '' }]);
    }, uiText('Đã gửi đề nghị chi. Tổng tiền được tính từ các khoản chi; tài khoản và nhân viên được kiểm tra trước khi phê duyệt.'));
  }

  async function claimAction(row, verb) {
    const messages = { submitted: 'Đã gửi lại đề nghị chi.', approved: 'Đã duyệt; kế toán đã ghi bút toán chi phí và công nợ nhân viên.', rejected: 'Đã từ chối đề nghị chi.', paid: 'Đã ghi nhận hoàn ứng/thanh toán và tạo payment kế toán.' };
    await run(`${row.id}:${verb}`, () => action('expense.expense_claim', row, verb), uiText(messages[verb]));
  }

  const requestFor = (row) => approvalRequests.find((request) => request.entity === 'expense.expense_claim' && request.record_id === row.id);
  const paymentFor = (row) => payments.find((payment) => payment.source === 'expense_claim' && payment.source_id === row.id);
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Chi phí và hoàn ứng nhân viên")}</h1><p className="sub">{uiText("Lập khoản chi theo tài khoản kế toán, gửi duyệt, ghi nhận chi phí và xác nhận thanh toán.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText("Nháp / bị từ chối")}</span><strong className="stat-value">{stats.draft}</strong></div><div className="card stat"><span className="stat-label">{uiText("Chờ phê duyệt")}</span><strong className="stat-value">{stats.pending}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đã duyệt / chờ chi")}</span><strong className="stat-value">{stats.approved}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đã thanh toán")}</span><strong className="stat-value">{stats.paid}</strong></div></div>

    {can('expense.expense_claim.create') && <section className="card card-pad"><h2>{uiText("Lập đề nghị chi phí")}</h2><form onSubmit={createClaim}><div className="form-grid"><label className="field"><span className="label">{uiText("Nhân viên *")}</span><select className="select" required value={form.employee} onChange={(event) => setForm({ ...form, employee: event.target.value })}><option value="">{uiText("Chọn nhân viên")}</option>{[...employees.values()].filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày dự kiến thanh toán *")}</span><input className="input" required type="date" value={form.payment_date} onChange={(event) => setForm({ ...form, payment_date: event.target.value })}/></label><label className="field"><span className="label">{uiText("Phương thức chi *")}</span><select className="select" required value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}><option value="bank">{uiText("Chuyển khoản")}</option><option value="cash">{uiText("Tiền mặt")}</option></select></label></div>
      <div className="row wrap" style={{ marginTop: 12 }}><strong>{uiText("Các khoản chi")}</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" onClick={() => setLines((current) => [...current, { description: '', amount: '', account_code: accounts[0]?.code || '' }])} disabled={!accounts.length}>{uiText("Thêm khoản")}</button></div>
      {lines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><input className="input grow" aria-label={uiText("Nội dung khoản chi")} placeholder={uiText("Nội dung / chứng từ")} value={line.description} onChange={(event) => updateLine(index, 'description', event.target.value)}/><input className="input num" aria-label={uiText("Số tiền khoản chi")} required type="number" min="0.01" step="any" value={line.amount} onChange={(event) => updateLine(index, 'amount', event.target.value)} style={{ maxWidth: 180 }}/><select className="select" aria-label={uiText("Tài khoản chi phí")} required value={line.account_code} onChange={(event) => updateLine(index, 'account_code', event.target.value)}><option value="">{uiText("Chọn tài khoản chi")}</option>{accounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {recordLabel('accounting.account', account)}</option>)}</select>{lines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>{uiText("Bỏ")}</button>}</div>)}
      <label className="field" style={{ marginTop: 10 }}><span className="label">{uiText("Ghi chú / thông tin chứng từ")}</span><textarea className="input" rows="2" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
      <div className="row wrap" style={{ marginTop: 10 }}><span className="grow"/><strong>{uiText('Tổng đề nghị: {amount}').replace('{amount}', fmtMoney(total))}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !accounts.length || !employees.size || total <= 0}>{uiText("Gửi duyệt")}</button></div>
    </form></section>}

    {loading ? <div className="skeleton" data-h="row"/> : !claims.length ? <div className="card card-pad empty" style={{ marginTop: 16 }}>{uiText('Chưa có đề nghị chi phí.')}</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>{uiText("Đề nghị chi phí")}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Nhân viên / ghi chú")}</th><th>{uiText("Ngày chi")}</th><th>{uiText("Tổng")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{claims.map((row) => <tr {...selectableTableRowProps} key={row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{employees.has(row.employee) ? recordLabel('hrm.employee', employees.get(row.employee)) : uiText('Nhân viên')}</strong><div className="small muted">{row.note || String(row.id).slice(0, 8)}</div></td><td>{fmtDate(row.payment_date)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{employees.has(selected.employee) ? recordLabel('hrm.employee', employees.get(selected.employee)) : uiText('Đề nghị chi phí')}</h2><div className="small muted">{uiText('Thanh toán {date} · {method} · {amount}').replace('{date}', fmtDate(selected.payment_date)).replace('{method}', uiText(selected.payment_method === 'bank' ? 'Chuyển khoản' : 'Tiền mặt')).replace('{amount}', fmtMoney(selected.total || 0))}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>{uiText("Nội dung")}</th><th>{uiText("Tài khoản")}</th><th>{uiText("Số tiền")}</th></tr></thead><tbody>{(selected.items || []).map((item, index) => <tr key={`${item.account_code}-${index}`}><td>{item.description || uiText('Khoản chi')}</td><td>{item.account_code}</td><td>{fmtMoney(item.amount || 0)}</td></tr>)}</tbody><tfoot><tr><th colSpan="2">{uiText("Tổng")}</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && requestFor(selected) && <p className="small muted" style={{ marginTop: 10 }}>{uiText('Yêu cầu duyệt:')} <a href={`#/e/workflow-approval/approval_request/${requestFor(selected).id}`}>{statusLabel(requestFor(selected).status)} · {uiText('mở yêu cầu')}</a></p>}
        <div className="row wrap" style={{ marginTop: 12 }}>{selected.status === 'submitted' && !workflowApproval && can('expense.expense_claim.approved') && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => claimAction(selected, 'approved')}>{uiText("Duyệt và ghi sổ")}</button>{can('expense.expense_claim.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => claimAction(selected, 'rejected')}>{uiText("Từ chối")}</button>}</>}{selected.status === 'approved' && can('expense.expense_claim.paid') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !selected.payment_date} onClick={() => claimAction(selected, 'paid')}>{uiText("Xác nhận đã thanh toán")}</button>}{['draft','rejected'].includes(selected.status) && can('expense.expense_claim.submitted') && <><a className="small" href={recordHref('expense.expense_claim', selected.id)}>{uiText("Mở / sửa")}</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => claimAction(selected, 'submitted')}>{uiText("Gửi lại")}</button></>}</div>
        {selected.status === 'paid' && paymentFor(selected) && <p className="small" style={{ marginTop: 10 }}>{uiText('Payment đã tạo:')} <a href={recordHref('accounting.payment', paymentFor(selected).id)}>{paymentFor(selected).number || String(paymentFor(selected).id).slice(0, 8)} · {uiText('mở chứng từ')}</a></p>}
      </section>}
    </div>}
    <p className="small muted" style={{ marginTop: 12 }}>{uiText("Mỗi khoản chi được ghi Nợ vào tài khoản chi phí đã chọn và Có công nợ nhân viên khi duyệt. Khi thanh toán, payment kế toán được tạo theo phương thức tiền mặt hoặc ngân hàng.")}</p>
    {can('accounting.payment.read') && <a className="small" href={listHref('accounting.payment')}>{uiText("Mở danh sách thanh toán")}</a>}
  </div>;
}
