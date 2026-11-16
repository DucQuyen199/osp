import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const today = localDate;
const num = (value) => Number(value || 0);
async function listAll(qname) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await api(`${dataPath(qname)}?${new URLSearchParams({ limit: '1000', offset: String(offset) })}`);
    const items = itemsOf(response); rows.push(...items);
    if (items.length < 1000 || rows.length >= Number(response?.total ?? rows.length)) break;
  }
  return rows;
}

export default function AccountingSettlementWorkbenchPage() {
  const [batches, setBatches] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [currencies, setCurrencies] = useState(new Map());
  const [approvals, setApprovals] = useState([]);
  const [form, setForm] = useState({ direction: 'receipt', party: '', currency: '', method: 'bank', payment_date: today(), reference: '' });
  const [allocations, setAllocations] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [batchRows, invoiceRows, billRows, paymentRows, partyMap, currencyRows, approvalRows] = await Promise.all([
        can('accounting.settlement_batch.read') ? listAll('accounting.settlement_batch') : Promise.resolve([]),
        can('accounting.invoice.read') ? listAll('accounting.invoice') : Promise.resolve([]),
        can('accounting.bill.read') ? listAll('accounting.bill') : Promise.resolve([]),
        can('accounting.payment.read') ? listAll('accounting.payment') : Promise.resolve([]),
        loadRefs('master-data.party'),
        can('master-data.currency.read') ? listAll('master-data.currency') : Promise.resolve([]),
        workflowApproval && can('workflow-approval.approval_request.read') ? listAll('workflow-approval.approval_request') : Promise.resolve([]),
      ]);
      batchRows.sort((a, b) => String(b.payment_date || '').localeCompare(String(a.payment_date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setBatches(batchRows); setInvoices(invoiceRows); setBills(billRows); setPayments(paymentRows); setParties(partyMap || new Map());
      setCurrencies(new Map(currencyRows.map((currency) => [currency.id, currency]))); setApprovals(approvalRows);
    } catch (reason) { setError(reason.message || uiText('Không tải được phiếu thu/chi công nợ.')); }
    finally { setLoading(false); }
  }, [workflowApproval]);
  useEffect(() => { document.title = `${uiText('Thu/chi phân bổ công nợ')} · OSP Suite`; load(); }, [load]);

  const docs = form.direction === 'receipt' ? invoices : bills;
  const partyField = form.direction === 'receipt' ? 'party' : 'supplier';
  const available = useMemo(() => docs.filter((doc) => doc[partyField] === form.party && ['posted', 'partially_paid', 'partially_settled'].includes(doc.status) && num(doc.balance_due) > 0.005), [docs, partyField, form.party]);
  const currencyOptions = useMemo(() => {
    const ids = new Set(available.map((doc) => doc.currency || '').filter(Boolean));
    const baseCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
    const base = [...currencies.values()].find((currency) => String(currency.code || '').toUpperCase() === baseCode);
    if (available.some((doc) => !doc.currency) && base) ids.add(base.id);
    return [...ids].map((id) => currencies.get(id)).filter(Boolean);
  }, [available, currencies]);
  const selectedCurrency = form.currency || currencyOptions[0]?.id || '';
  const currencyDocs = available.filter((doc) => (doc.currency || currencyOptions.find((currency) => currency.code?.toUpperCase() === String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase())?.id) === selectedCurrency);
  const selectedAllocations = currencyDocs.filter((doc) => num(allocations[doc.id]) > 0);
  const total = selectedAllocations.reduce((sum, doc) => sum + num(allocations[doc.id]), 0);

  function changeForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (['direction', 'party', 'currency'].includes(key)) setAllocations({});
    if (key === 'direction' || key === 'party') setForm((current) => ({ ...current, [key]: value, currency: '' }));
  }
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(); }
    catch (reason) { setError(reason.message || uiText('Không cập nhật được phiếu thu/chi.')); }
    finally { setBusy(''); }
  }
  async function createDraft(event) {
    event.preventDefault();
    if (!form.party || !selectedCurrency || !selectedAllocations.length || total <= 0) return;
    const allocationRows = selectedAllocations.map((doc) => ({ [form.direction === 'receipt' ? 'invoice' : 'bill']: doc.id, amount: Number(num(allocations[doc.id]).toFixed(2)) }));
    await run('create', async () => {
      await api(dataPath('accounting.settlement_batch'), { method: 'POST', body: { ...form, currency: selectedCurrency, amount: Number(total.toFixed(2)), allocations: allocationRows } });
      setAllocations({});
    }, uiText('Đã lưu phiếu nháp. Gửi duyệt khi thông tin và phân bổ đã chính xác.'));
  }
  async function action(row, verb) {
    await run(`${row.id}:${verb}`, () => api(dataPath('accounting.settlement_batch', row.id, verb), { method: 'POST' }), uiText(verb === 'approved' ? 'Đã duyệt và ghi nhận các payment cùng bút toán tổng hợp.' : verb === 'submitted' ? 'Đã gửi phiếu đi duyệt.' : verb === 'rejected' ? 'Đã từ chối phiếu.' : 'Đã hủy phiếu.'));
  }
  function approvalFor(row) { return approvals.find((request) => request.entity === 'accounting.settlement_batch' && request.record_id === row.id); }
  function allocationLabel(row) {
    const name = row.direction === 'receipt' ? 'invoice' : 'bill';
    return (row.allocations || []).map((allocation) => {
      const doc = (name === 'invoice' ? invoices : bills).find((item) => item.id === allocation[name]);
      return `${doc?.number || String(allocation[name] || '').slice(0, 8)} · ${fmtMoney(allocation.amount)}`;
    }).join(' | ');
  }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Thu/chi phân bổ công nợ")}</h1><p className="sub">{uiText("Gom một lần thu hoặc chi để phân bổ vào nhiều hóa đơn cùng đối tác và tiền tệ. Mỗi hóa đơn vẫn có payment riêng; sổ cái nhận một bút toán tổng hợp để đối soát giao dịch ngân hàng.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={load}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('accounting.settlement_batch.create') && <section className="card card-pad"><h2>{uiText("Lập phiếu thu/chi")}</h2><form className="form-grid" onSubmit={createDraft}>
      <label className="field"><span className="label">{uiText("Nghiệp vụ *")}</span><select className="select" value={form.direction} onChange={(event) => changeForm('direction', event.target.value)}><option value="receipt">{uiText("Thu khách hàng")}</option><option value="disbursement">{uiText("Chi nhà cung cấp")}</option></select></label>
      <label className="field"><span className="label">{uiText("Đối tác *")}</span><select className="select" required value={form.party} onChange={(event) => changeForm('party', event.target.value)}><option value="">{uiText("Chọn đối tác")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Tiền tệ *")}</span><select className="select" required value={selectedCurrency} onChange={(event) => changeForm('currency', event.target.value)}><option value="">{uiText("Chọn tiền tệ")}</option>{currencyOptions.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Phương thức *")}</span><select className="select" value={form.method} onChange={(event) => changeForm('method', event.target.value)}><option value="bank">{uiText("Ngân hàng")}</option><option value="cash">{uiText("Tiền mặt")}</option><option value="transfer">{uiText("Chuyển khoản")}</option><option value="card">{uiText("Thẻ")}</option><option value="ewallet">{uiText("Ví điện tử")}</option></select></label>
      <label className="field"><span className="label">{uiText("Ngày thanh toán *")}</span><input className="input" type="date" required value={form.payment_date} onChange={(event) => setForm((current) => ({ ...current, payment_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText("Mã tham chiếu ngân hàng")}</span><input className="input" maxLength="160" value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}/></label>
      <div className="full"><h3>{uiText("Hóa đơn còn dư")}</h3>{!form.party ? <p className="small muted">{uiText("Chọn đối tác để xem chứng từ còn công nợ.")}</p> : !selectedCurrency ? <p className="small muted">{uiText("Đối tác này chưa có hóa đơn còn dư.")}</p> : currencyDocs.length === 0 ? <p className="small muted">{uiText("Không có chứng từ cùng loại và tiền tệ còn số dư.")}</p> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Chứng từ")}</th><th>{uiText("Ngày")}</th><th>{uiText("Còn nợ")}</th><th>{uiText("Phân bổ")}</th></tr></thead><tbody>{currencyDocs.map((doc) => <tr key={doc.id}><td><a href={recordHref(`accounting.${form.direction === 'receipt' ? 'invoice' : 'bill'}`, doc.id)}>{doc.number || String(doc.id).slice(0, 8)}</a><div className="small muted">{statusLabel(doc.status)}</div></td><td>{fmtDate(doc.issue_date)}</td><td>{fmtMoney(doc.balance_due)}</td><td><input className="input num" aria-label={`${uiText('Số tiền phân bổ')} ${doc.number || doc.id}`} type="number" min="0" max={num(doc.balance_due)} step="0.01" value={allocations[doc.id] || ''} onChange={(event) => setAllocations((current) => ({ ...current, [doc.id]: event.target.value }))}/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setAllocations((current) => ({ ...current, [doc.id]: num(doc.balance_due).toFixed(2) }))}>{uiText("Tất cả dư nợ")}</button></td></tr>)}</tbody></table></div>}</div>
      <div className="row full"><strong>{uiText('Tổng phân bổ:')} {fmtMoney(total)}</strong><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !form.party || !selectedCurrency || !selectedAllocations.length || total <= 0}>{uiText("Lưu phiếu nháp")}</button></div>
    </form></section>}
    <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Phiếu thu/chi")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !batches.length ? <div className="empty">{uiText("Chưa có phiếu thu/chi phân bổ.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Phiếu")}</th><th>{uiText("Đối tác")}</th><th>{uiText("Ngày / tiền tệ")}</th><th>{uiText("Phân bổ")}</th><th>{uiText("Tổng")}</th><th>{uiText("Trạng thái / thao tác")}</th></tr></thead><tbody>{batches.map((row) => { const request = approvalFor(row); const rowPayments = payments.filter((payment) => payment.settlement_batch === row.id); const currency = currencies.get(row.currency); return <tr key={row.id}><td><a href={recordHref('accounting.settlement_batch', row.id)}>{row.number || String(row.id).slice(0, 8)}</a><div className="small muted">{row.direction === 'receipt' ? uiText('Thu khách hàng') : uiText('Chi nhà cung cấp')} · {row.reference || uiText('Không có mã tham chiếu')}</div></td><td>{recordLabel('master-data.party', parties.get(row.party))}</td><td>{fmtDate(row.payment_date)}<div className="small muted">{currency?.code || '—'} · {statusLabel(row.method)}</div></td><td><span className="small">{allocationLabel(row)}</span></td><td><strong>{fmtMoney(row.amount)}</strong><div className="small muted">{rowPayments.length} {uiText(rowPayments.length === 1 ? 'payment' : 'payments')}</div></td><td><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span>{row.status === 'submitted' && workflowApproval && request && <div className="small"><a href={recordHref('workflow-approval.approval_request', request.id)}>{uiText('Mở yêu cầu duyệt ·')} {statusLabel(request.status)}</a></div>}{row.status === 'submitted' && !workflowApproval && <div className="row wrap">{can('accounting.settlement_batch.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => action(row, 'approved')}>{uiText("Duyệt")}</button>}{can('accounting.settlement_batch.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => action(row, 'rejected')}>{uiText("Từ chối")}</button>}</div>}{['draft','rejected'].includes(row.status) && <div className="row wrap">{can('accounting.settlement_batch.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => action(row, 'submitted')}>{uiText("Gửi duyệt")}</button>}{can('accounting.settlement_batch.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => action(row, 'cancelled')}>{uiText("Hủy")}</button>}</div>}</td></tr>; })}</tbody></table></div>}</section>
  </div>;
}
