import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import realEstateEnglish from '../real-estate.en.js';

const t = (text) => uiTextWith(text, realEstateEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyData = () => ({
  properties: [], reservations: [], viewings: [], leases: [], rentCycles: [], invoices: [], parties: new Map(),
});

/** Owns property, rental, and accounting reads with independent fallbacks. */
export function useRealEstateWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        properties: can('real-estate.property.read') ? loadAllResponse('real-estate.property') : Promise.resolve(emptyResponse()),
        reservations: can('real-estate.reservation.read') ? loadAllResponse('real-estate.reservation') : Promise.resolve(emptyResponse()),
        viewings: can('real-estate.viewing.read') ? loadAllResponse('real-estate.viewing') : Promise.resolve(emptyResponse()),
        leases: can('real-estate.lease.read') ? loadAllResponse('real-estate.lease') : Promise.resolve(emptyResponse()),
        rentCycles: can('real-estate.rent_cycle.read') ? loadAllResponse('real-estate.rent_cycle') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, {
        properties: emptyResponse(), reservations: emptyResponse(), viewings: emptyResponse(), leases: emptyResponse(),
        rentCycles: emptyResponse(), parties: new Map(), invoices: emptyResponse(),
      });
      if (!isCurrent()) return;
      setData({
        properties: itemsOf(reads.properties), reservations: itemsOf(reads.reservations), viewings: itemsOf(reads.viewings),
        leases: itemsOf(reads.leases), rentCycles: itemsOf(reads.rentCycles), invoices: itemsOf(reads.invoices), parties: reads.parties,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu bất động sản.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được dữ liệu bất động sản.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);

  return { ...data, loading, error, setError, load };
}
