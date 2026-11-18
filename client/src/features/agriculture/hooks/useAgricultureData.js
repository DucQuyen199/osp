import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyMap = () => new Map();
const emptyResponse = () => ({ items: [] });

export function useAgricultureData() {
  const [data, setData] = useState({ farms: [], cycles: [], harvests: [], applications: [], products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), parties: emptyMap(), lots: emptyMap() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        farmResponse: can('agriculture.farm.read') ? loadAllResponse('agriculture.farm') : Promise.resolve(emptyResponse()),
        cycleResponse: can('agriculture.crop_cycle.read') ? loadAllResponse('agriculture.crop_cycle') : Promise.resolve(emptyResponse()),
        harvestResponse: can('agriculture.harvest.read') ? loadAllResponse('agriculture.harvest') : Promise.resolve(emptyResponse()),
        inputResponse: can('agriculture.input_application.read') ? loadAllResponse('agriculture.input_application') : Promise.resolve(emptyResponse()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        lots: can('inventory.lot.read') ? loadRefs('inventory.lot') : Promise.resolve(emptyMap()),
      }, {
        farmResponse: emptyResponse(), cycleResponse: emptyResponse(), harvestResponse: emptyResponse(), inputResponse: emptyResponse(),
        products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), parties: emptyMap(), lots: emptyMap(),
      });
      if (!isCurrent()) return;
      const cycles = itemsOf(reads.cycleResponse).sort((a, b) => String(a.expected_harvest || '9999').localeCompare(String(b.expected_harvest || '9999')));
      setData({
        farms: itemsOf(reads.farmResponse), cycles, harvests: itemsOf(reads.harvestResponse), applications: itemsOf(reads.inputResponse),
        products: reads.products, units: reads.units, warehouses: reads.warehouses, parties: reads.parties, lots: reads.lots,
      });
      setError(errors[0]?.message || (errors.length ? uiText('Một số dữ liệu nông nghiệp không tải được.') : ''));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || uiText('Không tải được dữ liệu mùa vụ.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, load };
}
