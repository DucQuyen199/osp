import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAll, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyArray = () => [];
const emptyData = () => ({ periods: [], draftStatements: [], draftJournals: [] });

export function useAccountingPeriodCloseData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        periods: can('accounting.period.read') ? loadAll('accounting.period') : Promise.resolve(emptyArray()),
        draftStatements: can('accounting.bank_statement.read') ? loadAll('accounting.bank_statement', { status: 'draft' }) : Promise.resolve(emptyArray()),
        draftJournals: can('accounting.journal_entry.read') ? loadAll('accounting.journal_entry', { status: 'draft' }) : Promise.resolve(emptyArray()),
      }, { periods: emptyArray(), draftStatements: emptyArray(), draftJournals: emptyArray() });
      if (!isCurrent()) return;
      const periods = reads.periods.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
      setData({ periods, draftStatements: reads.draftStatements, draftJournals: reads.draftJournals });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được dữ liệu khóa sổ.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || uiText('Không tải được dữ liệu khóa sổ.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
