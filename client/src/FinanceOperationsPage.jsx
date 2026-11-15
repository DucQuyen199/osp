import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';

const today = localDate;
const defaultFirstDueDate = () => {
  const [year, month, day] = today().split('-').map(Number);
  const nextMonth = new Date(year, month - 1, 1);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  nextMonth.setDate(Math.min(day, lastDay));
  return today(nextMonth);
};
const money = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const actions = async (qname, row, action) => api(dataPath(qname, row.id, action), { method: 'POST' });

export default function FinanceOperationsPage() {
  const [parties, setParties] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [claimPay, setClaimPay] = useState({});
  const [claimApprovalAmounts, setClaimApprovalAmounts] = useState({});
  const [claimRejectionReasons, setClaimRejectionReasons] = useState({});
  const [repaymentMethods, setRepaymentMethods] = useState({});
  const [loanForm, setLoanForm] = useState({ party: '', principal: '', rate: '', term_months: '12', first_due_date: defaultFirstDueDate(), method: 'bank' });
  const [policyForm, setPolicyForm] = useState({ number: '', party: '', product: '', premium: '', coverage_limit: '', start_date: today(), end_date: '' });
  const [claimForm, setClaimForm] = useState({ number: '', policy: '', amount: '', incident_date: today(), description: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [partyMap, accountRes, loanRes, repaymentRes, policyRes, claimRes, invoiceRes] = await Promise.all([
        loadRefs('master-data.party'),
        can('accounting.account.read') ? loadAllResponse('accounting.account') : Promise.resolve({ items: [] }),
        can('lending.loan.read') ? loadAllResponse('lending.loan') : Promise.resolve({ items: [] }),
        can('lending.repayment.read') ? loadAllResponse('lending.repayment') : Promise.resolve({ items: [] }),
        can('insurance.policy.read') ? loadAllResponse('insurance.policy') : Promise.resolve({ items: [] }),
        can('insurance.claim.read') ? loadAllResponse('insurance.claim') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      setParties(partyMap); setAccounts(accountRes.items || []);
      setLoans((loanRes.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setRepayments(repaymentRes.items || []); setPolicies(policyRes.items || []); setClaims(claimRes.items || []); setInvoices(invoiceRes.items || []);
      setClaimApprovalAmounts((current) => {
        const next = { ...current };
        for (const claim of claimRes.items || []) next[claim.id] ??= String(claim.approved_amount ?? claim.amount ?? '');
        return next;
      });
      setLoanForm((x) => ({ ...x, party: x.party || [...partyMap.keys()][0] || '' }));
      setPolicyForm((x) => ({ ...x, party: x.party || [...partyMap.keys()][0] || '' }));
      setClaimForm((x) => ({ ...x, policy: x.policy || (policyRes.items || []).find((p) => p.status === 'active')?.id || '' }));
      setClaimPay((current) => {
        const next = { ...current };
        for (const claim of claimRes.items || []) if (!next[claim.id]) next[claim.id] = { method: 'bank', expense_account: (accountRes.items || []).find((a) => a.kind === 'expense')?.id || '' };
        return next;
      });
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu hồ sơ tài chính.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều hành cho vay và bảo hiểm · OSP Suite'; load(); }, [load]);
  const invoiceByPolicy = useMemo(() => new Map(invoices.filter((item) => item.source === 'policy').map((item) => [item.source_id, item])), [invoices]);
  const repaymentsByLoan = useMemo(() => {
    const map = new Map();
    for (const repayment of repayments) map.set(repayment.loan, [...(map.get(repayment.loan) || []), repayment]);
    for (const rows of map.values()) rows.sort((a, b) => Number(a.installment_no) - Number(b.installment_no));
    return map;
  }, [repayments]);
  const activePolicies = policies.filter((policy) => policy.status === 'active');

  async function createLoan(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('lending.loan'), { method: 'POST', body: { ...loanForm, principal: Number(loanForm.principal), rate: Number(loanForm.rate), term_months: Number(loanForm.term_months), status: 'applied' } });
      setLoanForm((x) => ({ ...x, principal: '', rate: '' })); setNotice('Đã tiếp nhận hồ sơ vay ở trạng thái chờ thẩm định.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể tiếp nhận hồ sơ vay.'); }
    finally { setBusy(false); }
  }

  async function loanAction(loan, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await actions('lending.loan', loan, action);
      setNotice(action === 'disbursed' ? 'Đã giải ngân; hệ thống tạo lịch trả nợ và bút toán giải ngân.' : `Đã cập nhật khoản vay: ${statusLabel(action)}.`); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật khoản vay.'); }
    finally { setBusy(false); }
  }

  async function repaymentAction(row, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      const method = repaymentMethods[row.id] || row.method;
      if (action === 'paid' && !['cash', 'bank'].includes(method)) throw new Error('Chọn phương thức thu tiền trước khi ghi nhận thanh toán.');
      if (action === 'paid' && row.method !== method) await api(dataPath('lending.repayment', row.id), { method: 'PATCH', body: { method } });
      await actions('lending.repayment', row, action);
      setNotice(action === 'paid' ? 'Đã ghi nhận thu kỳ trả nợ và hạch toán.' : 'Đã chuyển kỳ trả nợ sang quá hạn.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật kỳ trả nợ.'); }
    finally { setBusy(false); }
  }

  async function createPolicy(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.policy'), { method: 'POST', body: { ...policyForm, premium: Number(policyForm.premium), coverage_limit: Number(policyForm.coverage_limit), status: 'quoted' } });
      setPolicyForm((x) => ({ ...x, number: '', product: '', premium: '', coverage_limit: '' })); setNotice('Đã tạo báo giá bảo hiểm.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể tạo hợp đồng bảo hiểm.'); }
    finally { setBusy(false); }
  }

  async function createClaim(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.claim'), { method: 'POST', body: { ...claimForm, amount: Number(claimForm.amount), status: 'submitted' } });
      setClaimForm((x) => ({ ...x, number: '', amount: '', description: '' })); setNotice('Đã tiếp nhận hồ sơ bồi thường để thẩm định.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể tiếp nhận hồ sơ bồi thường.'); }
    finally { setBusy(false); }
  }

  async function payClaim(claim) {
    const values = claimPay[claim.id] || {};
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.claim', claim.id, 'paid'), { method: 'POST', body: { method: values.method, expense_account: values.expense_account } });
      setNotice('Đã chi trả bồi thường và ghi bút toán kế toán.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể chi trả hồ sơ bồi thường.'); }
    finally { setBusy(false); }
  }

  async function claimAction(claim, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      let body;
      if (action === 'approved') {
        const approvedAmount = Number(claimApprovalAmounts[claim.id] ?? claim.amount);
        if (!Number.isFinite(approvedAmount) || approvedAmount <= 0 || approvedAmount > Number(claim.amount)) {
          throw new Error('Số tiền duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu.');
        }
        body = { approved_amount: approvedAmount };
      } else {
        const reason = (claimRejectionReasons[claim.id] || '').trim();
        if (reason.length < 5 || reason.length > 1000) throw new Error('Nhập lý do từ chối từ 5 đến 1000 ký tự.');
        body = { rejection_reason: reason };
      }
      await api(dataPath('insurance.claim', claim.id, action), { method: 'POST', body });
      setNotice(action === 'approved' ? 'Đã duyệt hồ sơ bồi thường.' : 'Đã từ chối hồ sơ bồi thường.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật hồ sơ bồi thường.'); }
    finally { setBusy(false); }
  }

  async function policyAction(policy, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await actions('insurance.policy', policy, action);
      setNotice(action === 'activated' ? 'Đã kích hoạt hợp đồng và tạo hóa đơn phí phải thu.' : 'Đã cập nhật trạng thái hợp đồng.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật hợp đồng.'); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>Điều hành cho vay và bảo hiểm</h1><p className="sub">Theo dõi hồ sơ qua các bước tiếp nhận, thẩm định, giải ngân hoặc chi trả và thu nợ.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}

    {can('lending.loan.read') && <section className="card card-pad"><h2>Khoản vay và trả nợ</h2>
      {can('lending.loan.create') && <form className="form-grid" onSubmit={createLoan}>
        <label className="field"><span className="label">Người vay *</span><select className="select" required value={loanForm.party} onChange={(e) => setLoanForm((x) => ({ ...x, party: e.target.value }))}><option value="">Chọn người vay</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
        <label className="field"><span className="label">Số tiền vay *</span><input className="input num" required type="number" min="0.01" step="any" value={loanForm.principal} onChange={(e) => setLoanForm((x) => ({ ...x, principal: e.target.value }))} /></label>
        <label className="field"><span className="label">Lãi suất năm (%) *</span><input className="input num" required type="number" min="0" max="1000" step="any" value={loanForm.rate} onChange={(e) => setLoanForm((x) => ({ ...x, rate: e.target.value }))} /></label>
        <label className="field"><span className="label">Kỳ hạn (tháng) *</span><input className="input num" required type="number" min="1" max="600" step="1" value={loanForm.term_months} onChange={(e) => setLoanForm((x) => ({ ...x, term_months: e.target.value }))} /></label>
        <label className="field"><span className="label">Ngày đến hạn kỳ đầu theo hợp đồng *</span><input className="input" required type="date" value={loanForm.first_due_date} onChange={(e) => setLoanForm((x) => ({ ...x, first_due_date: e.target.value }))} /></label>
        <label className="field"><span className="label">Phương thức giải ngân *</span><select className="select" required value={loanForm.method} onChange={(e) => setLoanForm((x) => ({ ...x, method: e.target.value }))}><option value="bank">Ngân hàng</option><option value="cash">Tiền mặt</option></select></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !loanForm.party}>Tiếp nhận hồ sơ vay</button></div>
      </form>}
        {!loans.length && !loading ? <div className="empty">Chưa có hồ sơ vay.</div> : <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Người vay</th><th>Gốc</th><th>Lãi năm</th><th>Kỳ hạn</th><th>Kỳ đầu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{loans.map((loan) => { const schedule = repaymentsByLoan.get(loan.id) || []; const paid = schedule.filter((r) => r.status === 'paid').length; return <React.Fragment key={loan.id}><tr><td>{parties.get(loan.party) ? recordLabel('master-data.party', parties.get(loan.party)) : 'Người vay'}</td><td>{money(loan.principal)}</td><td>{loan.rate}%</td><td>{loan.term_months} tháng</td><td>{loan.first_due_date || '—'}</td><td>{statusLabel(loan.status)}{loan.status === 'disbursed' && <div className="small muted">Đã thu {paid}/{schedule.length} kỳ</div>}</td><td className="row wrap">{loan.status === 'applied' && can('lending.loan.approved') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => loanAction(loan, 'approved')}>Duyệt</button>}{loan.status === 'applied' && can('lending.loan.rejected') && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => loanAction(loan, 'rejected')}>Từ chối</button>}{loan.status === 'approved' && can('lending.loan.disbursed') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => loanAction(loan, 'disbursed')}>Giải ngân</button>}{loan.status === 'disbursed' && can('lending.loan.closed') && <button className="btn btn-secondary btn-sm" disabled={busy || paid !== schedule.length || !schedule.length} onClick={() => loanAction(loan, 'closed')}>Đóng khoản vay</button>}{loan.status === 'disbursed' && can('lending.loan.defaulted') && <button className="btn btn-ghost btn-sm" disabled={busy || !schedule.some((r) => r.status === 'overdue')} onClick={() => loanAction(loan, 'defaulted')}>Chuyển nợ xấu</button>}</td></tr>{schedule.map((row) => <tr key={row.id}><td className="small muted">Kỳ {row.installment_no} · {row.due_date}</td><td>{money(row.amount)}</td><td>Gốc {money(row.principal_component)}</td><td>Lãi {money(row.interest_component)}</td><td>{statusLabel(row.status)}</td><td className="row wrap">{['due', 'overdue'].includes(row.status) && can('lending.repayment.paid') && <><select className="select" aria-label="Phương thức thu kỳ trả nợ" value={repaymentMethods[row.id] || row.method || ''} disabled={!can('lending.repayment.update')} onChange={(e) => setRepaymentMethods((current) => ({ ...current, [row.id]: e.target.value }))}><option value="">Phương thức thu</option><option value="bank">Ngân hàng</option><option value="cash">Tiền mặt</option></select><button className="btn btn-primary btn-sm" disabled={busy || !['cash', 'bank'].includes(repaymentMethods[row.id] || row.method)} onClick={() => repaymentAction(row, 'paid')}>Ghi nhận đã thu</button></>}{row.status === 'due' && row.due_date < today() && can('lending.repayment.overdue') && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => repaymentAction(row, 'overdue')}>Đánh dấu quá hạn</button>}</td></tr>)}</React.Fragment>; })}</tbody></table></div>}
      <p className="small muted">Giải ngân sinh lịch niên kim và bút toán. Kỳ trả nợ được đối chiếu gốc/lãi theo lịch; khoản vay chỉ đóng khi đã thu đủ mọi kỳ.</p>
    </section>}

    {can('insurance.policy.read') && <section className="card card-pad" style={{ marginTop: 20 }}><h2>Hợp đồng và phí bảo hiểm</h2>
      {can('insurance.policy.create') && <form className="form-grid" onSubmit={createPolicy}>
        <label className="field"><span className="label">Số hợp đồng *</span><input className="input" required value={policyForm.number} onChange={(e) => setPolicyForm((x) => ({ ...x, number: e.target.value }))} /></label>
        <label className="field"><span className="label">Bên mua *</span><select className="select" required value={policyForm.party} onChange={(e) => setPolicyForm((x) => ({ ...x, party: e.target.value }))}><option value="">Chọn khách hàng</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
        <label className="field"><span className="label">Sản phẩm bảo hiểm *</span><input className="input" required value={policyForm.product} onChange={(e) => setPolicyForm((x) => ({ ...x, product: e.target.value }))} /></label>
        <label className="field"><span className="label">Phí bảo hiểm *</span><input className="input num" required type="number" min="0.01" step="any" value={policyForm.premium} onChange={(e) => setPolicyForm((x) => ({ ...x, premium: e.target.value }))} /></label>
        <label className="field"><span className="label">Hạn mức bảo hiểm *</span><input className="input num" required type="number" min="0.01" step="any" value={policyForm.coverage_limit} onChange={(e) => setPolicyForm((x) => ({ ...x, coverage_limit: e.target.value }))} /></label>
        <label className="field"><span className="label">Hiệu lực từ *</span><input className="input" type="date" required value={policyForm.start_date} onChange={(e) => setPolicyForm((x) => ({ ...x, start_date: e.target.value }))} /></label>
        <label className="field"><span className="label">Đến ngày *</span><input className="input" type="date" required min={policyForm.start_date} value={policyForm.end_date} onChange={(e) => setPolicyForm((x) => ({ ...x, end_date: e.target.value }))} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !policyForm.party}>Tạo báo giá</button></div>
      </form>}
      {!policies.length && !loading ? <div className="empty">Chưa có hợp đồng bảo hiểm.</div> : <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Số hợp đồng</th><th>Khách hàng</th><th>Sản phẩm</th><th>Phí</th><th>Thời hạn</th><th>Trạng thái / hóa đơn phí</th><th>Thao tác</th></tr></thead><tbody>{policies.map((policy) => { const invoice = invoiceByPolicy.get(policy.id); return <tr key={policy.id}><td>{policy.number}</td><td>{parties.get(policy.party) ? recordLabel('master-data.party', parties.get(policy.party)) : 'Khách hàng'}</td><td>{policy.product}</td><td>{money(policy.premium)}</td><td>{fmtDate(policy.start_date)} – {fmtDate(policy.end_date)}</td><td>{statusLabel(policy.status)}{invoice && <div><a href={`#/e/accounting/invoice/${invoice.id}`}>{statusLabel(invoice.status)} · xem hóa đơn phí</a></div>}</td><td className="row wrap">{policy.status === 'quoted' && can('insurance.policy.activated') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => policyAction(policy, 'activated')}>Kích hoạt</button>}{['quoted', 'active'].includes(policy.status) && can('insurance.policy.cancelled') && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => policyAction(policy, 'cancelled')}>Hủy</button>}</td></tr>; })}</tbody></table></div>}
    </section>}

    {can('insurance.claim.read') && <section className="card card-pad" style={{ marginTop: 20 }}><h2>Hồ sơ bồi thường</h2>
      {can('insurance.claim.create') && <form className="form-grid" onSubmit={createClaim}>
        <label className="field"><span className="label">Mã hồ sơ *</span><input className="input" required value={claimForm.number} onChange={(e) => setClaimForm((x) => ({ ...x, number: e.target.value }))} /></label>
        <label className="field"><span className="label">Hợp đồng còn hiệu lực *</span><select className="select" required value={claimForm.policy} onChange={(e) => setClaimForm((x) => ({ ...x, policy: e.target.value }))}><option value="">Chọn hợp đồng</option>{activePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.number} · {parties.get(policy.party)?.name || policy.product}</option>)}</select></label>
        <label className="field"><span className="label">Số tiền yêu cầu *</span><input className="input num" required type="number" min="0.01" step="any" value={claimForm.amount} onChange={(e) => setClaimForm((x) => ({ ...x, amount: e.target.value }))} /></label>
        <label className="field"><span className="label">Ngày sự cố *</span><input className="input" required type="date" max={today()} value={claimForm.incident_date} onChange={(e) => setClaimForm((x) => ({ ...x, incident_date: e.target.value }))} /></label>
        <label className="field full"><span className="label">Mô tả sự cố</span><textarea className="textarea" value={claimForm.description} onChange={(e) => setClaimForm((x) => ({ ...x, description: e.target.value }))} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !activePolicies.length}>Tiếp nhận hồ sơ</button></div>
      </form>}
      {!claims.length && !loading ? <div className="empty">Chưa có hồ sơ bồi thường.</div> : <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Mã hồ sơ</th><th>Hợp đồng</th><th>Sự cố</th><th>Yêu cầu / duyệt</th><th>Trạng thái</th><th>Thẩm định / chi trả</th></tr></thead><tbody>{claims.map((claim) => {
        const policy = policies.find((item) => item.id === claim.policy); const pay = claimPay[claim.id] || {};
        const canApprove = can('insurance.claim.approved') && can('insurance.claim.update');
        const canReject = can('insurance.claim.rejected') && can('insurance.claim.update');
        const canPay = can('insurance.claim.paid') && can('insurance.claim.update');
        return <tr key={claim.id}><td>{claim.number}<div className="small muted">{claim.description}</div>{claim.status === 'rejected' && claim.rejection_reason && <div className="small">Lý do từ chối: {claim.rejection_reason}</div>}</td><td>{policy?.number || 'Hợp đồng'}</td><td>{fmtDate(claim.incident_date)}</td><td><div>Yêu cầu: {money(claim.amount)}</div>{claim.status === 'submitted' && canApprove ? <label className="field"><span className="small muted">Số tiền duyệt</span><input className="input num" aria-label="Số tiền bồi thường được duyệt" type="number" min="0.01" max={claim.amount} step="any" value={claimApprovalAmounts[claim.id] ?? claim.amount} onChange={(event) => setClaimApprovalAmounts((current) => ({ ...current, [claim.id]: event.target.value }))} /></label> : claim.approved_amount != null && <div className="small">Duyệt: {money(claim.approved_amount)}</div>}</td><td>{statusLabel(claim.status)}</td><td className="row wrap">{claim.status === 'submitted' && canApprove && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => claimAction(claim, 'approved')}>Duyệt</button>}{claim.status === 'submitted' && canReject && <><label className="field"><span className="small muted">Lý do từ chối *</span><textarea className="textarea" rows="2" maxLength="1000" value={claimRejectionReasons[claim.id] || ''} onChange={(event) => setClaimRejectionReasons((current) => ({ ...current, [claim.id]: event.target.value }))} /></label><button className="btn btn-ghost btn-sm" disabled={busy || (claimRejectionReasons[claim.id] || '').trim().length < 5} onClick={() => claimAction(claim, 'rejected')}>Từ chối</button></>}{claim.status === 'approved' && canPay && <><select className="select" aria-label="Phương thức chi trả" value={pay.method || ''} onChange={(e) => setClaimPay((x) => ({ ...x, [claim.id]: { ...pay, method: e.target.value } }))}><option value="">Phương thức</option><option value="bank">Ngân hàng</option><option value="cash">Tiền mặt</option></select><select className="select" aria-label="Tài khoản chi phí bồi thường" value={pay.expense_account || ''} onChange={(e) => setClaimPay((x) => ({ ...x, [claim.id]: { ...pay, expense_account: e.target.value } }))}><option value="">Tài khoản chi phí</option>{accounts.filter((a) => a.kind === 'expense').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><button className="btn btn-primary btn-sm" disabled={busy || !pay.method || !pay.expense_account} onClick={() => payClaim(claim)}>Chi trả</button></>}</td></tr>;
      })}</tbody></table></div>}
      <p className="small muted">Chỉ chi trả sau phê duyệt. Khi chi trả, hệ thống yêu cầu tài khoản chi phí và phương thức tiền mặt/ngân hàng rồi tự ghi bút toán.</p>
    </section>}
  </div>;
}
