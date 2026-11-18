import { useCallback, useEffect, useState } from 'react';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { uiText } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useFinanceOperationsData() {
  const [parties, setParties] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setLoadError('');
    const { data, errors } = await loadIndependentData({
      parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      accounts: can('accounting.account.read') ? loadAllResponse('accounting.account') : Promise.resolve({ items: [] }),
      loans: can('lending.loan.read') ? loadAllResponse('lending.loan') : Promise.resolve({ items: [] }),
      repayments: can('lending.repayment.read') ? loadAllResponse('lending.repayment') : Promise.resolve({ items: [] }),
      policies: can('insurance.policy.read') ? loadAllResponse('insurance.policy') : Promise.resolve({ items: [] }),
      claims: can('insurance.claim.read') ? loadAllResponse('insurance.claim') : Promise.resolve({ items: [] }),
      invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
    }, {
      parties: new Map(), accounts: { items: [] }, loans: { items: [] }, repayments: { items: [] },
      policies: { items: [] }, claims: { items: [] }, invoices: { items: [] },
    });
    if (!isCurrent()) return;

    setParties(data.parties);
    setAccounts(data.accounts.items || []);
    setLoans((data.loans.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
    setRepayments(data.repayments.items || []);
    setPolicies(data.policies.items || []);
    setClaims(data.claims.items || []);
    setInvoices(data.invoices.items || []);
    setLoadError(errors.map((reason) => uiText(reason?.message || 'Không tải được dữ liệu hồ sơ tài chính.')).join(' · '));
    setLoading(false);
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);

  return { parties, accounts, loans, repayments, policies, claims, invoices, loading, loadError, load };
}
