import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAll, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyArray = () => [];
const emptyMap = () => new Map();
const timestamp = (row) => row.updatedAt || row.updated_at || row.createdAt || row.created_at || '';
const emptyData = () => ({ rows: [], invoices: new Map() });

export function useEInvoiceWorkbenchData() {
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
        rows: can('einvoice.einvoice.read') ? loadAll('einvoice.einvoice') : Promise.resolve(emptyArray()),
        invoices: can('accounting.invoice.read') ? loadAll('accounting.invoice') : Promise.resolve(emptyArray()),
      }, { rows: emptyArray(), invoices: emptyArray() });
      if (!isCurrent()) return;
      const rows = reads.rows.sort((a, b) => String(timestamp(b)).localeCompare(String(timestamp(a))));
      setData({ rows, invoices: new Map(reads.invoices.map((invoice) => [invoice.id, invoice])) });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được danh sách hóa đơn điện tử.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || uiText('Không tải được danh sách hóa đơn điện tử.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
