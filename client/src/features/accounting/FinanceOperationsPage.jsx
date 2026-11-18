import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDate, statusLabel, fmtNumber, uiText } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { useFinanceOperationsData } from './hooks/useFinanceOperationsData.js';
import { useFinanceOperationsWorkflow } from './hooks/useFinanceOperationsWorkflow.js';
import LoanRepaymentPanel from './workbenches/LoanRepaymentPanel.jsx';
import InsurancePolicyPanel from './workbenches/InsurancePolicyPanel.jsx';
import InsuranceClaimsPanel from './workbenches/InsuranceClaimsPanel.jsx';
const money = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 2 });
export default function FinanceOperationsPage() {
  useDocumentTitle(`${uiText('Điều hành cho vay và bảo hiểm')} · OSP Suite`);
  const { parties, accounts, loans, repayments, policies, claims, invoices, loading, loadError, load } = useFinanceOperationsData();
  const workflow = useFinanceOperationsWorkflow({ parties, accounts, policies, claims, load });
  const {
    today, busy, error, notice, refresh, claimPay, setClaimPay,
    policyCancellationReasons, setPolicyCancellationReasons,
    claimApprovalAmounts, setClaimApprovalAmounts, claimRejectionReasons, setClaimRejectionReasons,
    repaymentMethods, setRepaymentMethods, loanForm, setLoanForm,
    policyForm, setPolicyForm, claimForm, setClaimForm, eligiblePolicies,
    createLoan, loanAction, repaymentAction, createPolicy, createClaim, payClaim, claimAction, policyAction,
  } = workflow;
  const invoiceByPolicy = useMemo(() => new Map(invoices.filter((item) => item.source === 'policy').map((item) => [item.source_id, item])), [invoices]);
  const repaymentsByLoan = useMemo(() => {
    const map = new Map();
    for (const repayment of repayments) map.set(repayment.loan, [...(map.get(repayment.loan) || []), repayment]);
    for (const rows of map.values()) rows.sort((a, b) => Number(a.installment_no) - Number(b.installment_no));
    return map;
  }, [repayments]);
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Điều hành cho vay và bảo hiểm")}</h1><p className="sub">{uiText("Theo dõi hồ sơ qua các bước tiếp nhận, thẩm định, giải ngân hoặc chi trả và thu nợ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={refresh}>{uiText("Làm mới")}</button></div>
    {(error || loadError) && <div className="alert danger" role="alert">{uiText(error || loadError)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <LoanRepaymentPanel {...{ can, loans, loading, uiText, loanForm, setLoanForm, parties, recordLabel, createLoan, busy, repaymentsByLoan, statusLabel, today, loanAction, repaymentMethods, setRepaymentMethods, repaymentAction, money }} />
    <InsurancePolicyPanel {...{ can, policies, loading, uiText, policyForm, setPolicyForm, parties, createPolicy, busy, recordLabel, invoiceByPolicy, fmtDate, statusLabel, policyCancellationReasons, setPolicyCancellationReasons, policyAction }} />
    <InsuranceClaimsPanel {...{ can, claims, loading, uiText, claimForm, setClaimForm, eligiblePolicies, today, createClaim, policies, parties, money, claimPay, claimApprovalAmounts, setClaimApprovalAmounts, claimAction, claimRejectionReasons, setClaimRejectionReasons, busy, payClaim, accounts, fmtDate }} />
  </div>;
}
