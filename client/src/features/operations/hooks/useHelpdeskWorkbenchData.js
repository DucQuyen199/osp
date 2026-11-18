import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import helpdeskEnglish from '../helpdesk.en.js';

const t = (text) => uiTextWith(text, helpdeskEnglish);
const itemsOf = (value) => Array.isArray(value?.items) ? value.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ tickets: [], messages: [], parties: new Map(), policies: new Map(), employees: new Map() });

export function useHelpdeskWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        tickets: can('helpdesk.ticket.read') ? loadAllResponse('helpdesk.ticket') : Promise.resolve(emptyResponse()),
        messages: can('helpdesk.message.read') ? loadAllResponse('helpdesk.message') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        policies: can('helpdesk.sla_policy.read') ? loadRefs('helpdesk.sla_policy') : Promise.resolve(emptyMap()),
        employees: can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(emptyMap()),
      }, { tickets: emptyResponse(), messages: emptyResponse(), parties: emptyMap(), policies: emptyMap(), employees: emptyMap() });
      const tickets = itemsOf(reads.tickets).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setData({ tickets, messages: itemsOf(reads.messages), parties: reads.parties, policies: reads.policies, employees: reads.employees });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không thể tải hộp thư hỗ trợ.')).join(' · '));
    } catch (reason) { setError(t(reason.message || 'Không thể tải hộp thư hỗ trợ.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
