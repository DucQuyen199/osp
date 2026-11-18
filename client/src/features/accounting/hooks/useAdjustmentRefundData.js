import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ notes: { credit: [], debit: [] }, invoices: [], bills: [], payments: [], parties: new Map() });

export function useAdjustmentRefundData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        credits: can('accounting.credit_note.read') ? loadAllResponse('accounting.credit_note') : Promise.resolve(emptyResponse()),
        debits: can('accounting.debit_note.read') ? loadAllResponse('accounting.debit_note') : Promise.resolve(emptyResponse()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        bills: can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve(emptyResponse()),
        payments: can('accounting.payment.read') ? loadAllResponse('accounting.payment') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      }, {
        credits: emptyResponse(), debits: emptyResponse(), invoices: emptyResponse(), bills: emptyResponse(),
        payments: emptyResponse(), parties: emptyMap(),
      });
      setData({
        notes: {
          credit: itemsOf(reads.credits).filter((row) => row.status === 'posted'),
          debit: itemsOf(reads.debits).filter((row) => row.status === 'posted'),
        },
        invoices: itemsOf(reads.invoices),
        bills: itemsOf(reads.bills),
        payments: itemsOf(reads.payments),
        parties: reads.parties,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được danh sách phiếu điều chỉnh.')).join(' · '));
    } catch (reason) {
      setError(reason.message || uiText('Không tải được danh sách phiếu điều chỉnh.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
