import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ transactions: [], refunds: [], parties: new Map(), invoices: new Map(), bills: new Map() });

export function usePaymentsWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        transactions: can('payments.payment_txn.read') ? loadAllResponse('payments.payment_txn') : Promise.resolve(emptyResponse()),
        refunds: can('payments.payment_refund.read') ? loadAllResponse('payments.payment_refund') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        invoices: can('accounting.invoice.read') ? loadRefs('accounting.invoice') : Promise.resolve(emptyMap()),
        bills: can('accounting.bill.read') ? loadRefs('accounting.bill') : Promise.resolve(emptyMap()),
      }, {
        transactions: emptyResponse(), refunds: emptyResponse(), parties: emptyMap(), invoices: emptyMap(), bills: emptyMap(),
      });
      setData({
        transactions: rows(reads.transactions).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
        refunds: rows(reads.refunds).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
        parties: reads.parties,
        invoices: reads.invoices,
        bills: reads.bills,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được giao dịch thanh toán.')).join(' · '));
    } catch (reason) {
      setError(reason.message || uiText('Không tải được giao dịch thanh toán.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
