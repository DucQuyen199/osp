import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ batches: [], invoices: [], bills: [], payments: [], parties: new Map(), currencies: new Map(), approvals: [] });

export function useAccountingSettlementData(workflowApproval) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        batches: can('accounting.settlement_batch.read') ? loadAllResponse('accounting.settlement_batch') : Promise.resolve(emptyResponse()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        bills: can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve(emptyResponse()),
        payments: can('accounting.payment.read') ? loadAllResponse('accounting.payment') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        currencies: can('master-data.currency.read') ? loadAllResponse('master-data.currency') : Promise.resolve(emptyResponse()),
        approvals: workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
      }, {
        batches: emptyResponse(), invoices: emptyResponse(), bills: emptyResponse(), payments: emptyResponse(),
        parties: emptyMap(), currencies: emptyResponse(), approvals: emptyResponse(),
      });
      if (!isCurrent()) return;
      const batches = itemsOf(reads.batches).sort((a, b) => String(b.payment_date || '').localeCompare(String(a.payment_date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const currencyRows = itemsOf(reads.currencies);
      setData({
        batches,
        invoices: itemsOf(reads.invoices),
        bills: itemsOf(reads.bills),
        payments: itemsOf(reads.payments),
        parties: reads.parties,
        currencies: new Map(currencyRows.map((currency) => [currency.id, currency])),
        approvals: itemsOf(reads.approvals),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được phiếu thu/chi công nợ.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || uiText('Không tải được phiếu thu/chi công nợ.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [workflowApproval, beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
