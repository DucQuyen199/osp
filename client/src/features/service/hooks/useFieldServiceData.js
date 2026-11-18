import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import fieldServiceEnglish from '../field-service.en.js';

const t = (text) => uiTextWith(text, fieldServiceEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ orders: [], parties: new Map(), products: new Map(), units: new Map(), warehouses: new Map(), employees: new Map(), invoices: [], tickets: new Map() });

export function useFieldServiceData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        orders: can('field-service.work_order.read') ? loadAllResponse('field-service.work_order') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        tickets: can('helpdesk.ticket.read') ? loadAllResponse('helpdesk.ticket') : Promise.resolve(emptyResponse()),
        employees: can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(emptyMap()),
      }, {
        orders: emptyResponse(), parties: emptyMap(), products: emptyMap(), units: emptyMap(), warehouses: emptyMap(),
        invoices: emptyResponse(), tickets: emptyResponse(), employees: emptyMap(),
      });
      if (!isCurrent()) return;
      setData({
        orders: itemsOf(reads.orders).sort((a, b) => String(b.scheduled_at || b.created_at || '').localeCompare(String(a.scheduled_at || a.created_at || ''))),
        parties: reads.parties,
        products: reads.products,
        units: reads.units,
        warehouses: reads.warehouses,
        employees: reads.employees,
        invoices: itemsOf(reads.invoices),
        tickets: new Map(itemsOf(reads.tickets).map((item) => [item.id, item])),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được lệnh công việc.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được lệnh công việc.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
