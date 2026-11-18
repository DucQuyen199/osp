import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { addCalendarMonths, localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, statusLabel, fmtNumber, uiText } from '../../lib/i18n.js';
import { compareDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import { useFinanceOperationsData } from './hooks/useFinanceOperationsData.js';
import LoanRepaymentPanel from './workbenches/LoanRepaymentPanel.jsx';
import InsurancePolicyPanel from './workbenches/InsurancePolicyPanel.jsx';
import InsuranceClaimsPanel from './workbenches/InsuranceClaimsPanel.jsx';
const today = localDate;
const defaultFirstDueDate = () => addCalendarMonths(today(), 1);
const money = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 2 });
const actions = async (qname, row, action) => api(dataPath(qname, row.id, action), { method: 'POST' });
export default function FinanceOperationsPage() {
  useDocumentTitle(`${uiText('Điều hành cho vay và bảo hiểm')} · OSP Suite`);
  const { parties, accounts, loans, repayments, policies, claims, invoices, loading, loadError, load } = useFinanceOperationsData();
  const [claimPay, setClaimPay] = useState({});
  const [policyCancellationReasons, setPolicyCancellationReasons] = useState({});
  const [claimApprovalAmounts, setClaimApprovalAmounts] = useState({});
  const [claimRejectionReasons, setClaimRejectionReasons] = useState({});
  const [repaymentMethods, setRepaymentMethods] = useState({});
  const [loanForm, setLoanForm] = useState({ party: '', principal: '', rate: '', term_months: '12', first_due_date: defaultFirstDueDate(), method: 'bank' });
  const [policyForm, setPolicyForm] = useState({ number: '', party: '', product: '', premium: '', coverage_limit: '', start_date: today(), end_date: '' });
  const [claimForm, setClaimForm] = useState({ number: '', policy: '', amount: '', incident_date: today(), description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const eligiblePolicies = useMemo(() => policies.filter((policy) =>
    ['active', 'lapsed'].includes(policy.status)
      && claimForm.incident_date >= (policy.start_date || '')
      && claimForm.incident_date <= (policy.end_date || '9999-12-31')),
  [claimForm.incident_date, policies]);
  useEffect(() => {
    setClaimApprovalAmounts((current) => {
      const next = { ...current };
      for (const claim of claims) next[claim.id] ??= String(claim.approved_amount ?? claim.amount ?? '');
      return next;
    });
    setLoanForm((x) => ({ ...x, party: x.party || [...parties.keys()][0] || '' }));
    setPolicyForm((x) => ({ ...x, party: x.party || [...parties.keys()][0] || '' }));
    setClaimForm((x) => ({ ...x, policy: eligiblePolicies.some((policy) => policy.id === x.policy) ? x.policy : eligiblePolicies[0]?.id || '' }));
    setClaimPay((current) => {
      const next = { ...current };
      for (const claim of claims) if (!next[claim.id]) next[claim.id] = { method: 'bank', expense_account: accounts.find((a) => a.kind === 'expense')?.id || '' };
      return next;
    });
  }, [accounts, claims, eligiblePolicies, parties]);
  const invoiceByPolicy = useMemo(() => new Map(invoices.filter((item) => item.source === 'policy').map((item) => [item.source_id, item])), [invoices]);
  const repaymentsByLoan = useMemo(() => {
    const map = new Map();
    for (const repayment of repayments) map.set(repayment.loan, [...(map.get(repayment.loan) || []), repayment]);
    for (const rows of map.values()) rows.sort((a, b) => Number(a.installment_no) - Number(b.installment_no));
    return map;
  }, [repayments]);
  const refresh = () => { setError(''); load(); };
  async function createLoan(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('lending.loan'), { method: 'POST', body: { ...loanForm, principal: String(loanForm.principal), rate: String(loanForm.rate), term_months: Number(loanForm.term_months), status: 'applied' } });
      setLoanForm((x) => ({ ...x, principal: '', rate: '' })); setNotice(uiText("Đã tiếp nhận hồ sơ vay ở trạng thái chờ thẩm định.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể tiếp nhận hồ sơ vay.")); }
    finally { setBusy(false); }
  }
  async function loanAction(loan, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await actions('lending.loan', loan, action);
      setNotice(action === 'disbursed' ? uiText("Đã giải ngân; hệ thống tạo lịch trả nợ và bút toán giải ngân.") : `${uiText('Đã cập nhật khoản vay')}: ${statusLabel(action)}.`); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể cập nhật khoản vay.")); }
    finally { setBusy(false); }
  }
  async function repaymentAction(row, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      const method = repaymentMethods[row.id] || row.method;
      if (action === 'paid' && !['cash', 'bank'].includes(method)) throw new Error(uiText("Chọn phương thức thu tiền trước khi ghi nhận thanh toán."));
      if (action === 'paid' && row.method !== method) await api(dataPath('lending.repayment', row.id), { method: 'PATCH', body: { method } });
      await actions('lending.repayment', row, action);
      setNotice(action === 'paid' ? uiText("Đã ghi nhận thu kỳ trả nợ và hạch toán.") : uiText("Đã chuyển kỳ trả nợ sang quá hạn.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể cập nhật kỳ trả nợ.")); }
    finally { setBusy(false); }
  }
  async function createPolicy(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.policy'), { method: 'POST', body: { ...policyForm, premium: String(policyForm.premium), coverage_limit: String(policyForm.coverage_limit), status: 'quoted' } });
      setPolicyForm((x) => ({ ...x, number: '', product: '', premium: '', coverage_limit: '' })); setNotice(uiText("Đã tạo báo giá bảo hiểm.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể tạo hợp đồng bảo hiểm.")); }
    finally { setBusy(false); }
  }
  async function createClaim(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.claim'), { method: 'POST', body: { ...claimForm, amount: String(claimForm.amount), status: 'submitted' } });
      setClaimForm((x) => ({ ...x, number: '', amount: '', description: '' })); setNotice(uiText("Đã tiếp nhận hồ sơ bồi thường để thẩm định.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể tiếp nhận hồ sơ bồi thường.")); }
    finally { setBusy(false); }
  }
  async function payClaim(claim) {
    const values = claimPay[claim.id] || {};
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('insurance.claim', claim.id, 'paid'), { method: 'POST', body: { method: values.method, expense_account: values.expense_account } });
      setNotice(uiText("Đã chi trả bồi thường và ghi bút toán kế toán.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể chi trả hồ sơ bồi thường.")); }
    finally { setBusy(false); }
  }
  async function claimAction(claim, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      let body;
      if (action === 'approved') {
        const approvedAmount = String(claimApprovalAmounts[claim.id] ?? claim.amount ?? '').trim();
        let validAmount = false;
        try { validAmount = compareDecimals(approvedAmount || 0, '0') > 0 && compareDecimals(approvedAmount, claim.amount || 0) <= 0; } catch { validAmount = false; }
        if (!validAmount) {
          throw new Error(uiText("Số tiền duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu."));
        }
        body = { approved_amount: approvedAmount };
      } else {
        const reason = (claimRejectionReasons[claim.id] || '').trim();
        if (reason.length < 5 || reason.length > 1000) throw new Error(uiText("Nhập lý do từ chối từ 5 đến 1000 ký tự."));
        body = { rejection_reason: reason };
      }
      await api(dataPath('insurance.claim', claim.id, action), { method: 'POST', body });
      setNotice(action === 'approved' ? uiText("Đã duyệt hồ sơ bồi thường.") : uiText("Đã từ chối hồ sơ bồi thường.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể cập nhật hồ sơ bồi thường.")); }
    finally { setBusy(false); }
  }
  async function policyAction(policy, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'cancelled') {
        const cancellationReason = (policyCancellationReasons[policy.id] || '').trim();
        if (cancellationReason.length < 5 || cancellationReason.length > 500) throw new Error(uiText("Nhập lý do hủy hợp đồng từ 5 đến 500 ký tự."));
        await api(dataPath('insurance.policy', policy.id, action), { method: 'POST', body: { cancellation_reason: cancellationReason } });
        setPolicyCancellationReasons((current) => { const next = { ...current }; delete next[policy.id]; return next; });
      } else {
        await actions('insurance.policy', policy, action);
      }
      setNotice(action === 'activated' ? uiText("Đã kích hoạt hợp đồng và tạo hóa đơn phí phải thu.") : action === 'cancelled' ? uiText("Đã hủy hợp đồng và lưu lý do.") : uiText("Đã cập nhật trạng thái hợp đồng.")); await load();
    } catch (reason) { setError(reason.message || uiText("Không thể cập nhật hợp đồng.")); }
    finally { setBusy(false); }
  }
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Điều hành cho vay và bảo hiểm")}</h1><p className="sub">{uiText("Theo dõi hồ sơ qua các bước tiếp nhận, thẩm định, giải ngân hoặc chi trả và thu nợ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={refresh}>{uiText("Làm mới")}</button></div>
    {(error || loadError) && <div className="alert danger" role="alert">{uiText(error || loadError)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <LoanRepaymentPanel {...{ can, loans, loading, uiText, loanForm, setLoanForm, parties, recordLabel, createLoan, busy, repaymentsByLoan, statusLabel, today, loanAction, repaymentMethods, setRepaymentMethods, repaymentAction, money }} />
    <InsurancePolicyPanel {...{ can, policies, loading, uiText, policyForm, setPolicyForm, parties, createPolicy, busy, recordLabel, invoiceByPolicy, fmtDate, statusLabel, policyCancellationReasons, setPolicyCancellationReasons, policyAction }} />
    <InsuranceClaimsPanel {...{ can, claims, loading, uiText, claimForm, setClaimForm, eligiblePolicies, today, createClaim, policies, parties, money, claimPay, claimApprovalAmounts, setClaimApprovalAmounts, claimAction, claimRejectionReasons, setClaimRejectionReasons, busy, payClaim, accounts, fmtDate }} />
  </div>;
}
