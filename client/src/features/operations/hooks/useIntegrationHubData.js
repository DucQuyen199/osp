import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData } from '../../../lib/state.js';
import integrationEnglish from '../integration.en.js';

const t = (text) => uiTextWith(text, integrationEnglish);
const itemsOf = (value) => Array.isArray(value?.items) ? value.items : [];
const emptyResponse = () => ({ items: [] });
const emptyData = () => ({ connectors: [], webhooks: [] });

export function useIntegrationHubData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        connectors: can('integration-hub.connector.read') ? loadAllResponse('integration-hub.connector') : Promise.resolve(emptyResponse()),
        webhooks: can('integration-hub.webhook.read') ? loadAllResponse('integration-hub.webhook') : Promise.resolve(emptyResponse()),
      }, { connectors: emptyResponse(), webhooks: emptyResponse() });
      setData({
        connectors: itemsOf(reads.connectors).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi')),
        webhooks: itemsOf(reads.webhooks).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được cấu hình tích hợp.')).join(' · '));
    } catch (reason) { setError(t(reason.message || 'Không tải được cấu hình tích hợp.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
