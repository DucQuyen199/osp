import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { app, can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import autoServiceEnglish from '../auto-service.en.js';

const t = (text) => uiTextWith(text, autoServiceEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ vehicles: [], orders: [], parties: new Map(), products: new Map(), units: new Map(), warehouses: new Map(), invoices: [] });

/** Owns permission-gated workshop reads and their refresh/error lifecycle. */
export function useAutoServiceWorkshopData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const showInvoices = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.invoice.read');
      const { data: reads, errors } = await loadIndependentData({
        vehicles: can('auto-service.vehicle.read') ? loadAllResponse('auto-service.vehicle') : Promise.resolve(emptyResponse()),
        orders: can('auto-service.repair_order.read') ? loadAllResponse('auto-service.repair_order') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        invoices: showInvoices ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, {
        vehicles: emptyResponse(), orders: emptyResponse(), parties: emptyMap(), products: emptyMap(),
        units: emptyMap(), warehouses: emptyMap(), invoices: emptyResponse(),
      });
      if (isCurrent()) {
        const vehicles = itemsOf(reads.vehicles).sort((a, b) => String(a.plate || '').localeCompare(String(b.plate || '')));
        const orders = itemsOf(reads.orders).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        setData({ vehicles, orders, parties: reads.parties, products: reads.products, units: reads.units, warehouses: reads.warehouses, invoices: itemsOf(reads.invoices) });
        if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu xưởng sửa chữa.')).join(' · '));
      }
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được dữ liệu xưởng sửa chữa.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
