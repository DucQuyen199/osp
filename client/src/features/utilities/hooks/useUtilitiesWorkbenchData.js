import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import utilitiesEnglish from '../utilities.en.js';

const t = (text) => uiTextWith(text, utilitiesEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyData = () => ({ meters: [], readings: [], parties: new Map(), bills: [], invoices: [] });

/** Owns permission-gated utility meter, reading, billing, and reference reads. */
export function useUtilitiesWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true); setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        meters: can('utilities.meter.read') ? loadAllResponse('utilities.meter') : Promise.resolve(emptyResponse()),
        readings: can('utilities.meter_reading.read') ? loadAllResponse('utilities.meter_reading') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        bills: can('utilities.utility_bill.read') ? loadAllResponse('utilities.utility_bill') : Promise.resolve(emptyResponse()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, { meters: emptyResponse(), readings: emptyResponse(), parties: new Map(), bills: emptyResponse(), invoices: emptyResponse() });
      if (!isCurrent()) return;
      setData({
        meters: itemsOf(reads.meters), readings: itemsOf(reads.readings), parties: reads.parties,
        bills: itemsOf(reads.bills), invoices: itemsOf(reads.invoices),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu công tơ.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được dữ liệu công tơ.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);

  return { ...data, loading, error, setError, load };
}
