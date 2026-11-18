import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, session, tenantPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { compareDecimals } from '../../lib/decimal.js';
import { calculateAdjustmentRefundable } from './domain/adjustmentRefunds.js';
import { can, loadAll, loadRefs, recordLabel } from '../../lib/state.js';
import { listHref, recordHref } from '../../lib/routes.js';
const today = localDate;
const storageKey = `osp.adjustment-refund-requests:${session.current()?.tenantId || 'tenant'}`;
const readRequests = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { return {}; } };
export default function AccountingAdjustmentRefundsPage() {
  useDocumentTitle(`${uiText('Hoàn tiền và thu tiền hoàn')} · OSP Suite`);
  const [notes, setNotes] = useState({ credit: [], debit: [] });
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState({ amount: '', method: 'bank', paymentDate: today() });
  const [requestIds, setRequestIds] = useState(readRequests);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [creditRows, debitRows, invoiceRows, billRows, paymentRows, partyMap] = await Promise.all([
        can('accounting.credit_note.read') ? loadAll('accounting.credit_note') : Promise.resolve([]),
        can('accounting.debit_note.read') ? loadAll('accounting.debit_note') : Promise.resolve([]),
        can('accounting.invoice.read') ? loadAll('accounting.invoice') : Promise.resolve([]),
        can('accounting.bill.read') ? loadAll('accounting.bill') : Promise.resolve([]),
        can('accounting.payment.read') ? loadAll('accounting.payment') : Promise.resolve([]),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      setNotes({ credit: creditRows.filter((row) => row.status === 'posted'), debit: debitRows.filter((row) => row.status === 'posted') });
      setInvoices(invoiceRows); setBills(billRows); setPayments(paymentRows); setParties(partyMap || new Map());
    } catch (e) { setError(e.message || uiText('Không tải được danh sách phiếu điều chỉnh.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const docs = useMemo(() => ({ invoice: new Map(invoices.map((row) => [row.id, row])), bill: new Map(bills.map((row) => [row.id, row])) }), [invoices, bills]);
  const rows = useMemo(() => [
    ...notes.credit.map((note) => ({ ...note, kind: 'credit_note', title: 'Hoàn tiền khách hàng', sourceDoc: docs.invoice.get(note.invoice), docKind: 'invoice', party: docs.invoice.get(note.invoice)?.party, refundRef: 'refund_credit_note', docRef: 'invoice' })),
    ...notes.debit.map((note) => ({ ...note, kind: 'debit_note', title: 'Nhận tiền hoàn nhà cung cấp', sourceDoc: docs.bill.get(note.bill), docKind: 'bill', party: docs.bill.get(note.bill)?.supplier, refundRef: 'refund_debit_note', docRef: 'bill' })),
  ].map((note) => {
    const linkedPayments = payments.filter((payment) => payment[note.docRef] === note[note.docRef]);
    const allNotes = note.kind === 'credit_note' ? notes.credit : notes.debit;
    const allowance = calculateAdjustmentRefundable({
      noteTotal: note.total,
      paidAmounts: linkedPayments.map((payment) => payment.amount),
      adjustmentTotals: allNotes.filter((entry) => entry[note.docRef] === note[note.docRef]).map((entry) => entry.total),
      documentTotal: note.sourceDoc?.total,
      refundAmounts: payments.filter((payment) => payment[note.refundRef] === note.id).map((payment) => payment.amount),
    });
    return { ...note, ...allowance };
  }), [notes, payments, docs]);
  const active = rows.find((row) => row.id === selected);
  const submit = async (event) => {
    event.preventDefault();
    if (!active || compareDecimals(form.amount || 0, 0) <= 0 || compareDecimals(form.amount, active.refundable) > 0) return;
    setBusy(true); setError(''); setNotice('');
    const requestId = requestIds[active.id] || crypto.randomUUID();
    const pendingRequests = { ...requestIds, [active.id]: requestId };
    setRequestIds(pendingRequests);
    try { sessionStorage.setItem(storageKey, JSON.stringify(pendingRequests)); } catch { /* still safe for retries within this session */ }
    try {
      const payment = await api(tenantPath('/accounting/adjustment-refunds'), { method: 'POST', body: { kind: active.kind, adjustmentId: active.id, amount: String(form.amount), method: form.method, paymentDate: form.paymentDate, requestId } });
      setNotice(uiText('Đã ghi nhận payment hoàn tiền{payment} và tạo bút toán kế toán.').replace('{payment}', payment?.id ? ` ${String(payment.id).slice(0, 8)}` : ''));
      setRequestIds((current) => { const next = { ...current }; delete next[active.id]; try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* optional retry storage */ } return next; });
      setForm((current) => ({ ...current, amount: '' }));
      await load();
    } catch (e) { setError(e.message || uiText('Không tạo được payment hoàn tiền. Có thể gửi lại an toàn.')); }
    finally { setBusy(false); }
  };
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Hoàn tiền và thu tiền hoàn")}</h1><p className="sub">{uiText("Thực hiện chi tiền cho khách theo credit note hoặc nhận tiền nhà cung cấp theo debit note; hệ thống giới hạn số dư, ghi payment âm và tự tạo bút toán tiền mặt/ngân hàng.")}</p></div><button className="btn btn-secondary" onClick={load} disabled={loading || busy}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert error">{uiText(error)}</div>}{notice && <div className="alert success">{uiText(notice)}</div>}
    <div className="card card-pad"><div className="row wrap"><div><strong>{uiText('{count} phiếu điều chỉnh đã ghi sổ').replace('{count}', rows.length)}</strong><div className="small muted">{uiText("Số tiền có thể hoàn được tính từ tổng thanh toán thực tế và các điều chỉnh đã ghi sổ.")}</div></div><span className="grow"/><a className="small" href={listHref('accounting.payment')}>{uiText("Danh sách payment")}</a></div>
      {loading ? <p className="muted">{uiText("Đang tải công nợ và payment…")}</p> : <div className="table-wrap u-legacy-0ee7f66ad9" ><table className="table"><thead><tr><th>{uiText("Nghiệp vụ")}</th><th>{uiText("Đối tác")}</th><th>{uiText("Chứng từ gốc")}</th><th>{uiText("Giá trị phiếu")}</th><th>{uiText("Đã hoàn")}</th><th>{uiText("Còn được hoàn")}</th><th>{uiText("Thao tác")}</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} className={selected === row.id ? 'selected' : ''}><td><strong>{uiText(row.title)}</strong><div className="small muted"><a href={recordHref(`accounting.${row.kind}`, row.id)}>{row.number || String(row.id).slice(0, 8)}</a> · {statusLabel(row.status)}</div></td><td>{parties.get(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{row.sourceDoc ? <a href={recordHref(`accounting.${row.docKind}`, row.sourceDoc.id)}>{row.sourceDoc.number || String(row.sourceDoc.id).slice(0, 8)}</a> : uiText('Không tìm thấy hóa đơn gốc')}<div className="small muted">{fmtDate(row.sourceDoc?.issue_date)}</div></td><td>{fmtMoney(row.total)}</td><td>{fmtMoney(row.alreadyRefunded)}</td><td><strong>{fmtMoney(row.refundable)}</strong></td><td><button className="btn btn-secondary btn-sm" disabled={compareDecimals(row.refundable, '0.005') <= 0 || !can('accounting.payment.create')} onClick={() => { setSelected(row.id); setForm((current) => ({ ...current, amount: row.refundable })); setNotice(''); }}>{uiText("Lập payment")}</button></td></tr>)}
        {!rows.length && <tr><td colSpan="7" className="muted">{uiText("Chưa có credit note hoặc debit note đã ghi sổ.")}</td></tr>}
      </tbody></table></div>}
    </div>
    {active && <section className="card card-pad u-legacy-92c18f6bda" ><h2>{uiText(active.title)}</h2><p className="small muted">{uiText('Phiếu {number} · Số dư tối đa {amount} · Ngày chứng từ {date}').replace('{number}', active.number || String(active.id).slice(0, 8)).replace('{amount}', fmtMoney(active.refundable)).replace('{date}', fmtDate(active.issue_date))}</p><form className="form-grid" onSubmit={submit}>
      <label className="field"><span className="label">{uiText("Số tiền *")}</span><input className="input num" type="number" min="0.01" max={active.refundable} step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Phương thức *")}</span><select className="select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="bank">{uiText("Chuyển khoản ngân hàng")}</option><option value="cash">{uiText("Tiền mặt")}</option><option value="card">{uiText("Thẻ")}</option><option value="transfer">{uiText("Chuyển khoản")}</option><option value="ewallet">{uiText("Ví điện tử")}</option></select></label>
      <label className="field"><span className="label">{uiText("Ngày thanh toán *")}</span><input className="input" type="date" required value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}/></label>
      <div className="row"><span className="grow"/><button className="btn btn-primary" disabled={busy || !form.amount || compareDecimals(form.amount, active.refundable) > 0}>{busy ? uiText('Đang ghi sổ…') : uiText('Ghi nhận payment')}</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setSelected('')}>{uiText("Đóng")}</button></div>
    </form></section>}
  </div>;
}
