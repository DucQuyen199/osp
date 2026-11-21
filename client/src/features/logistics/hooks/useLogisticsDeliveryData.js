import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const PAGE_SIZE = 100;
const EMPTY_COUNTS = { created: 0, dispatched: 0, failed: 0, partial: 0 };

/** Owns the logistics board's paged report, refresh lifecycle, and request state. */
export function useLogisticsDeliveryData() {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await api(tenantPath(`/reports/logistics/delivery-board?limit=${PAGE_SIZE}&offset=${offset}`));
      if (isCurrent()) {
        setItems(result.items || []);
        setCounts(result.counts || EMPTY_COUNTS);
        setTotal(Number(result.itemCount || 0));
        setHasMore(Boolean(result.hasMore));
        setLastUpdated(new Date().toISOString());
      }
    } catch (reason) {
      if (isCurrent()) setError(reason.message || 'Không tải được bảng điều phối giao hàng.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [offset, beginRequest]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  return {
    items, counts, total, offset, setOffset, hasMore, error, setError,
    loading, lastUpdated, load,
  };
}
