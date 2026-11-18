import { useEffect, useMemo, useState } from 'react';
import { addCalendarMonths, localDate } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { statusLabel, uiText } from '../../../lib/i18n.js';

const today = localDate;
const defaultFirstDueDate = () => addCalendarMonths(today(), 1);
const action = async (entity, row, next) => api(dataPath(entity, row.id, next), { method: 'POST' });

export function useFinanceOperationsWorkflow({ parties, accounts, policies, claims, load }) {
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
    setLoanForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
    setPolicyForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
    setClaimForm((current) => ({ ...current, policy: eligiblePolicies.some((policy) => policy.id === current.policy) ? current.policy : eligiblePolicies[0]?.id || '' }));
    setClaimPay((current) => {
      const next = { ...current };
      for (const claim of claims) if (!next[claim.id]) next[claim.id] = { method: 'bank', expense_account: accounts.find((account) => account.kind === 'expense')?.id || '' };
      return next;
    });
  }, [accounts, claims, eligiblePolicies, parties]);

  async function run(operation, fallback) {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      await load();
    } catch (reason) {
      setError(reason.message || fallback);
    } finally {
      setBusy(false);
    }
  }
  async function createLoan(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('lending.loan'), { method: 'POST', body: { ...loanForm, principal: String(loanForm.principal), rate: String(loanForm.rate), term_months: Number(loanForm.term_months), status: 'applied' } });
      setLoanForm((current) => ({ ...current, principal: '', rate: '' }));
      setNotice(uiText('Đã tiếp nhận hồ sơ vay ở trạng thái chờ thẩm định.'));
    }, uiText('Không thể tiếp nhận hồ sơ vay.'));
  }
  async function loanAction(loan, next) {
    await run(async () => {
      await action('lending.loan', loan, next);
      setNotice(next === 'disbursed' ? uiText('Đã giải ngân; hệ thống tạo lịch trả nợ và bút toán giải ngân.') : `${uiText('Đã cập nhật khoản vay')}: ${statusLabel(next)}.`);
    }, uiText('Không thể cập nhật khoản vay.'));
  }
  async function repaymentAction(row, next) {
    await run(async () => {
      const method = repaymentMethods[row.id] || row.method;
      if (next === 'paid' && !['cash', 'bank'].includes(method)) throw new Error(uiText('Chọn phương thức thu tiền trước khi ghi nhận thanh toán.'));
      if (next === 'paid' && row.method !== method) await api(dataPath('lending.repayment', row.id), { method: 'PATCH', body: { method } });
      await action('lending.repayment', row, next);
      setNotice(next === 'paid' ? uiText('Đã ghi nhận thu kỳ trả nợ và hạch toán.') : uiText('Đã chuyển kỳ trả nợ sang quá hạn.'));
    }, uiText('Không thể cập nhật kỳ trả nợ.'));
  }
  async function createPolicy(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('insurance.policy'), { method: 'POST', body: { ...policyForm, premium: String(policyForm.premium), coverage_limit: String(policyForm.coverage_limit), status: 'quoted' } });
      setPolicyForm((current) => ({ ...current, number: '', product: '', premium: '', coverage_limit: '' }));
      setNotice(uiText('Đã tạo báo giá bảo hiểm.'));
    }, uiText('Không thể tạo hợp đồng bảo hiểm.'));
  }
  async function createClaim(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('insurance.claim'), { method: 'POST', body: { ...claimForm, amount: String(claimForm.amount), status: 'submitted' } });
      setClaimForm((current) => ({ ...current, number: '', amount: '', description: '' }));
      setNotice(uiText('Đã tiếp nhận hồ sơ bồi thường để thẩm định.'));
    }, uiText('Không thể tiếp nhận hồ sơ bồi thường.'));
  }
  async function payClaim(claim) {
    const values = claimPay[claim.id] || {};
    await run(async () => {
      await api(dataPath('insurance.claim', claim.id, 'paid'), { method: 'POST', body: { method: values.method, expense_account: values.expense_account } });
      setNotice(uiText('Đã chi trả bồi thường và ghi bút toán kế toán.'));
    }, uiText('Không thể chi trả hồ sơ bồi thường.'));
  }
  async function claimAction(claim, next) {
    await run(async () => {
      let body;
      if (next === 'approved') {
        const approvedAmount = String(claimApprovalAmounts[claim.id] ?? claim.amount ?? '').trim();
        let validAmount = false;
        try { validAmount = compareDecimals(approvedAmount || 0, '0') > 0 && compareDecimals(approvedAmount, claim.amount || 0) <= 0; } catch { validAmount = false; }
        if (!validAmount) throw new Error(uiText('Số tiền duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu.'));
        body = { approved_amount: approvedAmount };
      } else {
        const reason = (claimRejectionReasons[claim.id] || '').trim();
        if (reason.length < 5 || reason.length > 1000) throw new Error(uiText('Nhập lý do từ chối từ 5 đến 1000 ký tự.'));
        body = { rejection_reason: reason };
      }
      await api(dataPath('insurance.claim', claim.id, next), { method: 'POST', body });
      setNotice(next === 'approved' ? uiText('Đã duyệt hồ sơ bồi thường.') : uiText('Đã từ chối hồ sơ bồi thường.'));
    }, uiText('Không thể cập nhật hồ sơ bồi thường.'));
  }
  async function policyAction(policy, next) {
    await run(async () => {
      if (next === 'cancelled') {
        const cancellationReason = (policyCancellationReasons[policy.id] || '').trim();
        if (cancellationReason.length < 5 || cancellationReason.length > 500) throw new Error(uiText('Nhập lý do hủy hợp đồng từ 5 đến 500 ký tự.'));
        await api(dataPath('insurance.policy', policy.id, next), { method: 'POST', body: { cancellation_reason: cancellationReason } });
        setPolicyCancellationReasons((current) => { const updated = { ...current }; delete updated[policy.id]; return updated; });
      } else {
        await action('insurance.policy', policy, next);
      }
      setNotice(next === 'activated' ? uiText('Đã kích hoạt hợp đồng và tạo hóa đơn phí phải thu.') : next === 'cancelled' ? uiText('Đã hủy hợp đồng và lưu lý do.') : uiText('Đã cập nhật trạng thái hợp đồng.'));
    }, uiText('Không thể cập nhật hợp đồng.'));
  }
  const refresh = () => { setError(''); load(); };

  return {
    today, busy, error, notice, refresh,
    claimPay, setClaimPay, policyCancellationReasons, setPolicyCancellationReasons,
    claimApprovalAmounts, setClaimApprovalAmounts, claimRejectionReasons, setClaimRejectionReasons,
    repaymentMethods, setRepaymentMethods, loanForm, setLoanForm, policyForm, setPolicyForm,
    claimForm, setClaimForm, eligiblePolicies, createLoan, loanAction, repaymentAction,
    createPolicy, createClaim, payClaim, claimAction, policyAction,
  };
}
