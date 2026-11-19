import { useEffect, useMemo, useState } from 'react';
import { localDate } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

const today = localDate;
const action = async (entity, row, next) => api(dataPath(entity, row.id, next), { method: 'POST' });

export function useInsuranceWorkflow({ parties, accounts, policies, claims, run }) {
  const [claimPay, setClaimPay] = useState({});
  const [policyCancellationReasons, setPolicyCancellationReasons] = useState({});
  const [claimApprovalAmounts, setClaimApprovalAmounts] = useState({});
  const [claimRejectionReasons, setClaimRejectionReasons] = useState({});
  const [policyForm, setPolicyForm] = useState({ number: '', party: '', product: '', premium: '', coverage_limit: '', start_date: today(), end_date: '' });
  const [claimForm, setClaimForm] = useState({ number: '', policy: '', amount: '', incident_date: today(), description: '' });

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
    setPolicyForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
    setClaimForm((current) => ({ ...current, policy: eligiblePolicies.some((policy) => policy.id === current.policy) ? current.policy : eligiblePolicies[0]?.id || '' }));
    setClaimPay((current) => {
      const next = { ...current };
      for (const claim of claims) if (!next[claim.id]) next[claim.id] = { method: 'bank', expense_account: accounts.find((account) => account.kind === 'expense')?.id || '' };
      return next;
    });
  }, [accounts, claims, eligiblePolicies, parties]);

  async function createPolicy(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('insurance.policy'), { method: 'POST', body: {
        ...policyForm, premium: String(policyForm.premium), coverage_limit: String(policyForm.coverage_limit), status: 'quoted',
      } });
      setPolicyForm((current) => ({ ...current, number: '', product: '', premium: '', coverage_limit: '' }));
      return uiText('Đã tạo báo giá bảo hiểm.');
    }, uiText('Không thể tạo hợp đồng bảo hiểm.'));
  }

  async function createClaim(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('insurance.claim'), { method: 'POST', body: { ...claimForm, amount: String(claimForm.amount), status: 'submitted' } });
      setClaimForm((current) => ({ ...current, number: '', amount: '', description: '' }));
      return uiText('Đã tiếp nhận hồ sơ bồi thường để thẩm định.');
    }, uiText('Không thể tiếp nhận hồ sơ bồi thường.'));
  }

  async function payClaim(claim) {
    const values = claimPay[claim.id] || {};
    await run(async () => {
      await api(dataPath('insurance.claim', claim.id, 'paid'), { method: 'POST', body: { method: values.method, expense_account: values.expense_account } });
      return uiText('Đã chi trả bồi thường và ghi bút toán kế toán.');
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
      return uiText(next === 'approved' ? 'Đã duyệt hồ sơ bồi thường.' : 'Đã từ chối hồ sơ bồi thường.');
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
      return uiText(next === 'activated' ? 'Đã kích hoạt hợp đồng và tạo hóa đơn phí phải thu.' : next === 'cancelled' ? 'Đã hủy hợp đồng và lưu lý do.' : 'Đã cập nhật trạng thái hợp đồng.');
    }, uiText('Không thể cập nhật hợp đồng.'));
  }

  return {
    today, claimPay, setClaimPay, policyCancellationReasons, setPolicyCancellationReasons,
    claimApprovalAmounts, setClaimApprovalAmounts, claimRejectionReasons, setClaimRejectionReasons,
    policyForm, setPolicyForm, claimForm, setClaimForm, eligiblePolicies,
    createPolicy, createClaim, payClaim, claimAction, policyAction,
  };
}
