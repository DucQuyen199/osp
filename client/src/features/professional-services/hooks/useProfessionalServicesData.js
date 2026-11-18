import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import servicesEnglish from '../professional-services.en.js';

const t = (text) => uiTextWith(text, servicesEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ cases: [], notes: [], timeEntries: [], invoices: [], parties: new Map() });

export function useProfessionalServicesData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        cases: can('case-management.case.read') ? loadAllResponse('case-management.case') : Promise.resolve(emptyResponse()),
        notes: can('case-management.case_note.read') ? loadAllResponse('case-management.case_note') : Promise.resolve(emptyResponse()),
        timeEntries: can('case-management.time_entry.read') ? loadAllResponse('case-management.time_entry') : Promise.resolve(emptyResponse()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      }, { cases: emptyResponse(), notes: emptyResponse(), timeEntries: emptyResponse(), invoices: emptyResponse(), parties: emptyMap() });
      if (!isCurrent()) return;
      setData({
        cases: itemsOf(reads.cases).sort((a, b) => String(b.opened_on || '').localeCompare(String(a.opened_on || ''))),
        notes: itemsOf(reads.notes),
        timeEntries: itemsOf(reads.timeEntries),
        invoices: itemsOf(reads.invoices),
        parties: reads.parties,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được hồ sơ vụ việc.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(t(reason.message || 'Không tải được hồ sơ vụ việc.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
