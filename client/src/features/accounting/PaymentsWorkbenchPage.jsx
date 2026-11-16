import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const providerLabels = { vnpay: 'VNPay', momo: 'MoMo', zalopay: 'ZaloPay', stripe: 'Stripe', bank: 'Ngân hàng' };
const methodLabels = { cash: 'Tiền mặt', card: 'Thẻ', transfer: 'Chuyển khoản', ewallet: 'Ví điện tử', bank: 'Ngân hàng' };
const transactionLabels = { pending: 'Chờ xác nhận', succeeded: 'Thành công', failed: 'Thất bại', partially_refunded: 'Hoàn một phần', refunded: 'Đã hoàn' };
const refundLabels = { pending: 'Chờ xử lý', succeeded: 'Đã hoàn', failed: 'Thất bại' };

export default function PaymentsWorkbenchPage() {
  const [transactions, setTransactions] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [invoices, setInvoices] = useState(new Map());
  const [bills, setBills] = useState(new Map());
  const [form, setForm] = useState({ provider: 'bank', method: 'transfer', party: '', amount: '', invoice: '', bill: '', reference: '' });
  const [refundForm, setRefundForm] = useState({ payment_txn: '', amount: '', reference: '' });
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [txnRes, refundRes, partyMap, invoiceMap, billMap] = await Promise.all([
        can('payments.payment_txn.read') ? loadAllResponse('payments.payment_txn') : Promise.resolve({ items: [] }),
        can('payments.payment_refund.read') ? loadAllResponse('payments.payment_refund') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('accounting.invoice.read') ? loadRefs('accounting.invoice') : Promise.resolve(new Map()),
        can('accounting.bill.read') ? loadRefs('accounting.bill') : Promise.resolve(new Map()),
      ]);
      setTransactions(rows(txnRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))));
      setRefunds(rows(refundRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))));
      setParties(partyMap); setInvoices(invoiceMap); setBills(billMap);
      setForm((current) => ({ ...current, party: current.party && partyMap.has(current.party) ? current.party : [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || uiText('Không tải được giao dịch thanh toán.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${uiText('Giao dịch thanh toán')} · OSP Suite`; load(); }, [load]);

  const visible = useMemo(() => transactions.filter((row) => filter === 'all' || row.status === filter), [transactions, filter]);
  const paidCount = transactions.filter((row) => row.status === 'succeeded').length;
  const pendingCount = transactions.filter((row) => row.status === 'pending').length;
  const refundTotal = refunds.filter((row) => row.status === 'succeeded').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function createTransaction(event) {
    event.preventDefault();
    if (!(Number(form.amount) > 0) || !form.party || Boolean(form.invoice) === Boolean(form.bill)) { setError(uiText('Chọn đúng một hóa đơn bán hoặc hóa đơn mua và nhập số tiền hợp lệ.')); return; }
    const payload = { provider: form.provider, method: form.method, party: form.party, amount: Number(form.amount), ...(form.invoice ? { invoice: form.invoice } : { bill: form.bill }), ...(form.reference.trim() ? { reference: form.reference.trim() } : {}) };
    await run('transaction:create', async () => {
      await api(dataPath('payments.payment_txn'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, amount: '', reference: '', invoice: '', bill: '' }));
    }, uiText('Đã tạo giao dịch chờ kết quả nhà cung cấp.'));
  }

  async function recordOutcome(transaction, action) {
    const reference = window.prompt(uiText(action === 'succeeded' ? 'Nhập mã giao dịch thành công do nhà cung cấp trả về:' : 'Mã tham chiếu (nếu đã có):'), transaction.reference || '');
    if (reference === null) return;
    await run(`${transaction.id}:${action}`, async () => {
      const normalizedReference = reference.trim();
      const changed = normalizedReference !== (transaction.reference || '');
      await api(dataPath('payments.payment_txn', transaction.id, action), {
        method: 'POST',
        ...(changed ? { body: { reference: normalizedReference } } : {}),
      });
    }, uiText(action === 'succeeded' ? 'Đã ghi nhận thanh toán thành công và cập nhật công nợ.' : 'Đã ghi nhận giao dịch thất bại.'));
  }

  async function createRefund(event) {
    event.preventDefault();
    if (!refundForm.payment_txn || !(Number(refundForm.amount) > 0)) return;
    await run('refund:create', async () => {
      await api(dataPath('payments.payment_refund'), { method: 'POST', body: { payment_txn: refundForm.payment_txn, amount: Number(refundForm.amount), ...(refundForm.reference.trim() ? { reference: refundForm.reference.trim() } : {}) } });
      setRefundForm({ payment_txn: '', amount: '', reference: '' });
    }, uiText('Đã tạo hồ sơ hoàn tiền chờ xử lý.'));
  }

  async function recordRefund(refund, action) {
    const reference = action === 'succeeded' ? window.prompt(uiText('Nhập mã hoàn tiền do nhà cung cấp trả về:'), refund.reference || '') : window.prompt(uiText('Ghi chú hoặc mã tham chiếu (nếu có):'), refund.reference || '');
    if (reference === null) return;
    await run(`${refund.id}:${action}`, async () => {
      const normalizedReference = reference.trim();
      const changed = normalizedReference !== (refund.reference || '');
      await api(dataPath('payments.payment_refund', refund.id, action), {
        method: 'POST',
        ...(changed ? { body: { reference: normalizedReference } } : {}),
      });
    }, uiText(action === 'succeeded' ? 'Đã ghi nhận hoàn tiền; sổ kế toán được cập nhật.' : 'Đã ghi nhận hoàn tiền thất bại.'));
  }

  const partyLabel = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : '—';
  const documentLabel = (txn) => txn.invoice ? uiText('HĐ bán · {number}').replace('{number}', invoices.get(txn.invoice)?.invoice_number || String(txn.invoice).slice(0, 8)) : txn.bill ? uiText('HĐ mua · {number}').replace('{number}', bills.get(txn.bill)?.bill_number || String(txn.bill).slice(0, 8)) : uiText('Chưa gắn hóa đơn');
  const refundsFor = (txn) => refunds.filter((refund) => refund.payment_txn === txn.id);
  const refundable = (txn) => Math.max(0, Number(txn.amount || 0) - refundsFor(txn).filter((row) => row.status === 'succeeded').reduce((sum, row) => sum + Number(row.amount || 0), 0));

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Giao dịch thanh toán")}</h1><p className="sub">{uiText("Tạo giao dịch chờ, đối chiếu kết quả từ VNPay, MoMo, ZaloPay, Stripe hoặc ngân hàng, và theo dõi hoàn tiền. Thành công chỉ ghi nhận sau khi xác minh mã tham chiếu từ nhà cung cấp.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText("Giao dịch chờ")}</span><strong className="stat-value">{pendingCount}</strong></div><div className="card stat"><span className="stat-label">{uiText("Thanh toán thành công")}</span><strong className="stat-value">{paidCount}</strong></div><div className="card stat"><span className="stat-label">{uiText("Tổng đã hoàn")}</span><strong className="stat-value">{fmtMoney(refundTotal)}</strong></div></div>
    {can('payments.payment_txn.create') && <section className="card card-pad"><h2>{uiText("Tạo giao dịch chờ")}</h2><form className="form-grid" onSubmit={createTransaction}>
      <label className="field"><span className="label">{uiText("Nhà cung cấp")}</span><select className="select" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>{Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Phương thức")}</span><select className="select" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Đối tác *")}</span><select className="select" required value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })}><option value="">{uiText("Chọn đối tác")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Số tiền *")}</span><input className="input num" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Hóa đơn bán")}</span><select className="select" value={form.invoice} onChange={(event) => { const invoice = invoices.get(event.target.value); setForm({ ...form, invoice: event.target.value, bill: '', ...(invoice ? { party: invoice.party } : {}) }); }}><option value="">{uiText("Không chọn")}</option>{[...invoices.values()].filter((row) => ['issued', 'partially_paid'].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{row.invoice_number || String(row.id).slice(0, 8)} · {fmtMoney(row.total)} · {partyLabel(row.party)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Hóa đơn mua")}</span><select className="select" value={form.bill} onChange={(event) => { const bill = bills.get(event.target.value); setForm({ ...form, bill: event.target.value, invoice: '', ...(bill ? { party: bill.supplier } : {}) }); }}><option value="">{uiText("Không chọn")}</option>{[...bills.values()].filter((row) => ['approved', 'partially_paid'].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{row.bill_number || String(row.id).slice(0, 8)} · {fmtMoney(row.total)} · {partyLabel(row.supplier)}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Mã tham chiếu (nếu đã có)")}</span><input className="input" maxLength="240" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })}/></label>
      <div className="row full"><span className="grow small muted">{uiText("Giao dịch success phải gắn đúng một hóa đơn và có mã tham chiếu.")}</span><button className="btn btn-primary" disabled={Boolean(busy) || !form.party}>{uiText("Tạo giao dịch")}</button></div>
    </form></section>}
    {can('payments.payment_txn.read') && <section className="card card-pad" style={{ marginTop: 16 }}><div className="row wrap"><div><h2>{uiText("Sổ giao dịch")}</h2><p className="small muted">{uiText("Xác minh trạng thái thực tế ở nhà cung cấp trước khi ghi nhận success hoặc thất bại.")}</p></div><span className="grow"/><label className="field"><span className="label">{uiText("Trạng thái")}</span><select className="select" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{uiText("Tất cả")}</option>{Object.entries(transactionLabels).map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}</select></label></div>
      {loading ? <div className="skeleton" data-h="row"/> : !visible.length ? <div className="empty">{uiText("Không có giao dịch trong bộ lọc này.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Thời điểm / nguồn")}</th><th>{uiText("Đối tác")}</th><th>{uiText("Hóa đơn")}</th><th>{uiText("Nhà cung cấp / tham chiếu")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Trạng thái / thao tác")}</th></tr></thead><tbody>{visible.map((txn) => { const paymentRefunds = refundsFor(txn); return <tr key={txn.id}><td>{fmtDateTime(txn.createdAt)}<div className="small muted">{txn.source || uiText('Thanh toán')}{txn.source_id ? ` · ${txn.source_id}` : ''}</div></td><td>{partyLabel(txn.party)}</td><td>{documentLabel(txn)}</td><td>{uiText(providerLabels[txn.provider] || txn.provider)}<div className="small mono">{txn.reference || uiText('Chưa có mã')}</div></td><td className="money">{fmtMoney(txn.amount)}<div className="small muted">{uiText(methodLabels[txn.method] || txn.method || '')}</div></td><td><span className={`badge ${txn.status === 'succeeded' ? 'success' : txn.status === 'failed' ? 'danger' : txn.status === 'pending' ? 'warning' : 'plain'}`}>{uiText(transactionLabels[txn.status]) || statusLabel(txn.status)}</span>{txn.status === 'pending' && <div className="row wrap" style={{ marginTop: 6 }}>{can('payments.payment_txn.succeeded') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => recordOutcome(txn, 'succeeded')}>{uiText("Xác nhận thành công")}</button>}{can('payments.payment_txn.failed') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => recordOutcome(txn, 'failed')}>{uiText("Thất bại")}</button>}</div>}{['succeeded', 'partially_refunded'].includes(txn.status) && can('payments.payment_refund.create') && refundable(txn) > 0 && <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} disabled={Boolean(busy)} onClick={() => setRefundForm({ payment_txn: txn.id, amount: refundable(txn).toFixed(2), reference: '' })}>{uiText('Lập hoàn tiền · tối đa {amount}').replace('{amount}', fmtMoney(refundable(txn)))}</button>}{paymentRefunds.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{uiText('{count} hồ sơ hoàn tiền').replace('{count}', paymentRefunds.length)}</div>}</td></tr>; })}</tbody></table></div>}
    </section>}
    {refundForm.payment_txn && <section className="card card-pad" style={{ marginTop: 16 }}><div className="row"><div><h2>{uiText("Lập hồ sơ hoàn tiền")}</h2><p className="small muted">{uiText('{party} · số dư hoàn tối đa {amount}').replace('{party}', partyLabel(transactions.find((row) => row.id === refundForm.payment_txn)?.party)).replace('{amount}', fmtMoney(refundable(transactions.find((row) => row.id === refundForm.payment_txn) || {})))}</p></div><span className="grow"/><button className="btn btn-ghost" type="button" onClick={() => setRefundForm({ payment_txn: '', amount: '', reference: '' })}>{uiText("Đóng")}</button></div><form className="form-grid" onSubmit={createRefund}><label className="field"><span className="label">{uiText("Số tiền *")}</span><input className="input num" type="number" min="0.01" max={refundable(transactions.find((row) => row.id === refundForm.payment_txn) || {})} step="0.01" required value={refundForm.amount} onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })}/></label><label className="field"><span className="label">{uiText("Mã hoàn tiền (nếu đã có)")}</span><input className="input" maxLength="240" value={refundForm.reference} onChange={(event) => setRefundForm({ ...refundForm, reference: event.target.value })}/></label><div className="row full"><span className="grow small muted">{uiText("Khi nhà cung cấp xác nhận hoàn tiền, mở hồ sơ và ghi mã tham chiếu để hạch toán.")}</span><button className="btn btn-primary" disabled={Boolean(busy) || Number(refundForm.amount) > refundable(transactions.find((row) => row.id === refundForm.payment_txn) || {})}>{uiText("Tạo hồ sơ")}</button></div></form></section>}
    {can('payments.payment_refund.read') && <section className="card card-pad" style={{ marginTop: 16 }}><h2>{uiText("Sổ hoàn tiền")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !refunds.length ? <div className="empty">{uiText("Chưa có hồ sơ hoàn tiền.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Thời điểm")}</th><th>{uiText("Giao dịch gốc")}</th><th>{uiText("Đối tác")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Mã hoàn")}</th><th>{uiText("Trạng thái / thao tác")}</th></tr></thead><tbody>{refunds.map((refund) => { const txn = transactions.find((row) => row.id === refund.payment_txn); return <tr key={refund.id}><td>{fmtDateTime(refund.createdAt)}</td><td>{txn ? `${uiText(providerLabels[txn.provider] || txn.provider)} · ${String(txn.id).slice(0, 8)}` : String(refund.payment_txn || '').slice(0, 8)}</td><td>{txn ? partyLabel(txn.party) : '—'}</td><td className="money">{fmtMoney(refund.amount)}</td><td className="mono small">{refund.reference || uiText('Chưa có mã')}</td><td><span className={`badge ${refund.status === 'succeeded' ? 'success' : refund.status === 'failed' ? 'danger' : 'warning'}`}>{uiText(refundLabels[refund.status]) || statusLabel(refund.status)}</span>{refund.status === 'pending' && <div className="row wrap" style={{ marginTop: 6 }}>{can('payments.payment_refund.succeeded') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => recordRefund(refund, 'succeeded')}>{uiText("Xác nhận hoàn tất")}</button>}{can('payments.payment_refund.failed') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => recordRefund(refund, 'failed')}>{uiText("Thất bại")}</button>}</div>}</td></tr>; })}</tbody></table></div>}</section>}
  </div>;
}
