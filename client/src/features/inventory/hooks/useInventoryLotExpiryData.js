import { useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useInventoryLotExpiryData({ days, offset }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latestRequest = useLatestRequest();

  useEffect(() => {
    const isLatest = latestRequest();
    setLoading(true); setError('');
    const params = new URLSearchParams({ days: String(days), limit: '100', offset: String(offset) });
    api(tenantPath(`/reports/inventory/lot-expiry?${params}`))
      .then((data) => { if (isLatest()) setReport(data); })
      .catch((reason) => { if (isLatest()) setError(reason.message || uiText('Không tải được danh sách lô cận hạn.')); })
      .finally(() => { if (isLatest()) setLoading(false); });
  }, [days, offset, latestRequest]);

  return { report, error, loading };
}
