import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import maintenanceEnglish from '../maintenance.en.js';

const t = (text) => uiTextWith(text, maintenanceEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ plans: [], requests: [], assets: new Map(), products: new Map(), units: new Map(), warehouses: new Map(), technicians: new Map() });

export function useMaintenanceWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        plans: can('maintenance.maintenance_plan.read') ? loadAllResponse('maintenance.maintenance_plan') : Promise.resolve(emptyResponse()),
        requests: can('maintenance.maintenance_request.read') ? loadAllResponse('maintenance.maintenance_request') : Promise.resolve(emptyResponse()),
        assets: can('asset.asset.read') ? loadRefs('asset.asset') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        technicians: can('maintenance.maintenance_technician.read') ? loadRefs('maintenance.maintenance_technician') : Promise.resolve(emptyMap()),
      }, {
        plans: emptyResponse(), requests: emptyResponse(), assets: emptyMap(), products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), technicians: emptyMap(),
      });
      const plans = itemsOf(reads.plans).sort((a, b) => String(a.next_due || '9999').localeCompare(String(b.next_due || '9999')));
      const requests = itemsOf(reads.requests).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setData({ plans, requests, assets: reads.assets, products: reads.products, units: reads.units, warehouses: reads.warehouses, technicians: reads.technicians });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được lịch bảo trì và lệnh công việc.')).join(' · '));
    } catch (reason) { setError(t(reason.message || 'Không tải được lịch bảo trì và lệnh công việc.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
