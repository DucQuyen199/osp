import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import hotelEnglish from '../hotel.en.js';

const t = (text) => uiTextWith(text, hotelEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ reservations: [], parties: new Map(), rooms: new Map(), roomTypes: new Map(), charges: [], invoices: [] });

export function useHotelFrontDeskData(accountingEnabled) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        reservations: can('hotel.reservation.read') ? loadAllResponse('hotel.reservation') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        rooms: can('hotel.room.read') ? loadRefs('hotel.room') : Promise.resolve(emptyMap()),
        roomTypes: can('hotel.room_type.read') ? loadRefs('hotel.room_type') : Promise.resolve(emptyMap()),
        charges: can('hotel.folio_charge.read') ? loadAllResponse('hotel.folio_charge') : Promise.resolve(emptyResponse()),
        invoices: accountingEnabled && can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, {
        reservations: emptyResponse(), parties: emptyMap(), rooms: emptyMap(), roomTypes: emptyMap(),
        charges: emptyResponse(), invoices: emptyResponse(),
      });
      setData({
        reservations: itemsOf(reads.reservations).sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''))),
        parties: reads.parties,
        rooms: reads.rooms,
        roomTypes: reads.roomTypes,
        charges: itemsOf(reads.charges),
        invoices: itemsOf(reads.invoices),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu lễ tân.')).join(' · '));
    } catch (reason) {
      setError(t(reason.message || 'Không tải được dữ liệu lễ tân.'));
    } finally {
      setLoading(false);
    }
  }, [accountingEnabled]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
