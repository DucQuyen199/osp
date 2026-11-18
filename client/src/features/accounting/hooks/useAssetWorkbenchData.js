import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyResponse = () => ({ items: [] });
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyData = () => ({ assets: [], depreciations: [] });

export function useAssetWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        assets: can('asset.asset.read') ? loadAllResponse('asset.asset') : Promise.resolve(emptyResponse()),
        depreciations: can('asset.depreciation.read') ? loadAllResponse('asset.depreciation') : Promise.resolve(emptyResponse()),
      }, { assets: emptyResponse(), depreciations: emptyResponse() });
      if (!isCurrent()) return;
      const assets = itemsOf(reads.assets).sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      const depreciations = itemsOf(reads.depreciations).sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')));
      setData({ assets, depreciations });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được sổ tài sản.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || uiText('Không tải được sổ tài sản.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
