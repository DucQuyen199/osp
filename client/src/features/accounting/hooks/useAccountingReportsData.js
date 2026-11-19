import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useAccountingReportsData({ mode, from, to, asOf }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const latestRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      let path;
      if (mode === 'balance') {
        if (asOf) params.set('asOf', asOf);
        path = '/reports/accounting/balance-sheet';
      } else if (mode === 'receivables' || mode === 'payables' || mode === 'fx') {
        if (asOf) params.set('asOf', asOf);
        path = mode === 'fx' ? '/reports/accounting/fx-revaluation-preview' : `/reports/accounting/${mode === 'receivables' ? 'receivables-aging' : 'payables-aging'}`;
      } else if (mode === 'cashflow') {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        path = '/reports/accounting/cash-flow-forecast';
      } else {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        path = mode === 'trial' ? '/reports/accounting/trial-balance' : mode === 'tax' ? '/reports/accounting/tax-register' : '/reports/accounting/income-statement';
      }
      const nextReport = await api(`${tenantPath(path)}?${params}`);
      if (isLatest()) setReport(nextReport);
    } catch (reason) {
      if (isLatest()) {
        setReport(null);
        setError(reason.message || uiText('Không tải được báo cáo.'));
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [mode, from, to, asOf, latestRequest]);

  useEffect(() => { load(); }, [load]);
  return { report, error, loading, load };
}
