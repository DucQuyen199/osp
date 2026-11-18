import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import eventsEnglish from '../events.en.js';

const t = (text) => uiTextWith(text, eventsEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ events: [], tickets: [], parties: new Map(), taxes: new Map() });

export function useEventsOperationsData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        events: can('events.event.read') ? loadAllResponse('events.event') : Promise.resolve(emptyResponse()),
        tickets: can('events.ticket.read') ? loadAllResponse('events.ticket') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        taxes: can('master-data.tax.read') ? loadRefs('master-data.tax') : Promise.resolve(emptyMap()),
      }, {
        events: emptyResponse(), tickets: emptyResponse(), parties: emptyMap(), taxes: emptyMap(),
      });
      if (!isCurrent()) return;
      setData({
        events: itemsOf(reads.events).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || ''))),
        tickets: itemsOf(reads.tickets).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        parties: reads.parties,
        taxes: reads.taxes,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được danh sách sự kiện và vé.')).join(' · '));
    } catch (reason) {
      if (!isCurrent()) return;
      setError(t(reason.message || 'Không tải được danh sách sự kiện và vé.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
