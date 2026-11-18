import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ records: [], inspections: new Map(), products: new Map() });

export function useQualityWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        records: can('quality.nonconformance.read') ? loadAllResponse('quality.nonconformance') : Promise.resolve(emptyResponse()),
        inspections: can('quality.inspection.read') ? loadRefs('quality.inspection') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
      }, { records: emptyResponse(), inspections: emptyMap(), products: emptyMap() });
      if (!isCurrent()) return;
      setData({
        records: itemsOf(reads.records).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
        inspections: reads.inspections,
        products: reads.products,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được sổ sự không phù hợp.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || uiText('Không tải được sổ sự không phù hợp.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
