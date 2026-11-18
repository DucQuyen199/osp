import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import restaurantEnglish from '../restaurant.en.js';

const t = (text) => uiTextWith(text, restaurantEnglish);
export const RESTAURANT_KITCHEN_PAGE_SIZE = 50;
const emptyReport = () => ({ items: [], counts: { queued: 0, preparing: 0, ready: 0 }, itemCount: 0, hasMore: false });

export function useRestaurantKitchenBoardData(station, offset) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ queued: 0, preparing: 0, ready: 0 });
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [products, setProducts] = useState(new Map());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setError(''); setLoading(true); }
    try {
      const params = new URLSearchParams({ station, limit: String(RESTAURANT_KITCHEN_PAGE_SIZE), offset: String(offset) });
      const { data: reads, errors } = await loadIndependentData({
        report: api(`${tenantPath('/reports/restaurant/kitchen-board')}?${params}`),
        products: products.size || !can('master-data.product.read') ? Promise.resolve(products) : loadRefs('master-data.product'),
      }, { report: emptyReport(), products: new Map() });
      if (!isCurrent()) return;
      setItems(reads.report.items || []);
      setCounts(reads.report.counts || { queued: 0, preparing: 0, ready: 0 });
      setTotal(Number(reads.report.itemCount || 0));
      setHasMore(Boolean(reads.report.hasMore));
      setProducts((current) => current.size === 0 && reads.products.size === 0 ? current : reads.products);
      setLastUpdated(new Date().toISOString());
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được phiếu bếp.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được phiếu bếp.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [station, products, offset, beginRequest]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  return { items, counts, total, hasMore, products, error, loading, lastUpdated, setError, load };
}
