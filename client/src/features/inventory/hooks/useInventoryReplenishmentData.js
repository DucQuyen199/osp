import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useInventoryReplenishmentData() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latestRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true); setError('');
    try {
      const nextReport = await api(tenantPath('/reports/inventory/replenishment'));
      if (isLatest()) setReport(nextReport);
    } catch (reason) {
      if (isLatest()) {
        setReport(null);
        setError(reason.message || uiText('Không tải được đề xuất bổ sung tồn kho.'));
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [latestRequest]);

  useEffect(() => { load(); }, [load]);
  return { report, error, setError, loading, load };
}
