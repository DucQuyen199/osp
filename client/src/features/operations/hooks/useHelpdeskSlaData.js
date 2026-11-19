import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export const HELPDESK_SLA_PAGE_SIZE = 50;

export function useHelpdeskSlaData({ offset, t }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true); setError('');
    try {
      const data = await api(tenantPath(`/reports/helpdesk/sla?limit=${HELPDESK_SLA_PAGE_SIZE}&offset=${offset}`));
      if (isLatest()) setReport(data);
    } catch (reason) {
      if (isLatest()) setError(t(reason.message || 'Không tải được báo cáo SLA.'));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [offset, t, latestRequest]);

  useEffect(() => { load(); }, [load]);
  return { report, loading, error };
}
