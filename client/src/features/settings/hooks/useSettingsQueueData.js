import { useCallback, useEffect, useRef, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useSettingsQueueData({ path, status, page, pageSize, errorMessage, setPage }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();
  const currentQuery = useRef({ status, page });
  currentQuery.current = { status, page };

  const reload = useCallback(async (nextStatus = status, nextPage = page) => {
    const isCurrent = beginRequest();
    setError('');
    try {
      const query = new URLSearchParams({
        status: nextStatus,
        limit: String(pageSize),
        offset: String(nextPage * pageSize),
      });
      const response = await api(tenantPath(`${path}?${query}`));
      if (!isCurrent()) return;

      const nextEntries = Array.isArray(response?.items) ? response.items : [];
      const nextTotal = Number(response?.total || 0);
      setEntries(nextEntries);
      setTotal(nextTotal);
      const lastPage = Math.max(0, Math.ceil(nextTotal / pageSize) - 1);
      if (nextPage > lastPage) setPage(lastPage);
    } catch (reason) {
      if (isCurrent()) setError(reason.message || uiText(errorMessage));
      return null;
    }
  }, [beginRequest, errorMessage, page, pageSize, path, setPage, status]);

  const reloadCurrent = useCallback(() => reload(currentQuery.current.status, currentQuery.current.page), [reload]);

  useEffect(() => { reload(); }, [reload]);

  return { entries, total, error, setError, reloadCurrent };
}
