import { useCallback, useEffect, useState } from 'react';
import { app, can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyData = () => ({
  warehouses: new Map(), branches: new Map(), products: new Map(), units: new Map(), taxes: new Map(), parties: new Map(),
  accounts: new Map(), sessions: [], orders: [], returns: [], prescriptions: [], cashMovements: [],
});

export function usePosWorkbenchData(translate) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const pharmacyEnabled = app.meta?.modules?.some((module) => module.id === 'pharmacy');
      const emptyMap = () => new Map();
      const emptyResponse = () => ({ items: [] });
      const { data: reads, errors } = await loadIndependentData({
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        branches: can('master-data.branch.read') ? loadRefs('master-data.branch') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        taxes: can('master-data.tax.read') ? loadRefs('master-data.tax') : Promise.resolve(emptyMap()),
        accounts: can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(emptyMap()),
        sessionResponse: can('pos.pos_session.read') ? loadAllResponse('pos.pos_session') : Promise.resolve(emptyResponse()),
        orderResponse: can('pos.pos_order.read') ? loadAllResponse('pos.pos_order') : Promise.resolve(emptyResponse()),
        movementResponse: can('pos.cash_movement.read') ? loadAllResponse('pos.cash_movement') : Promise.resolve(emptyResponse()),
        prescriptionResponse: pharmacyEnabled && can('pharmacy.prescription.read') ? loadAllResponse('pharmacy.prescription') : Promise.resolve(emptyResponse()),
        returnResponse: can('pos.pos_return.read') ? loadAllResponse('pos.pos_return') : Promise.resolve(emptyResponse()),
      }, {
        warehouses: emptyMap(), branches: emptyMap(), products: emptyMap(), units: emptyMap(), parties: emptyMap(), taxes: emptyMap(), accounts: emptyMap(),
        sessionResponse: emptyResponse(), orderResponse: emptyResponse(), movementResponse: emptyResponse(), prescriptionResponse: emptyResponse(), returnResponse: emptyResponse(),
      });
      const { warehouses, branches, products, units, parties, taxes, accounts, sessionResponse, orderResponse, movementResponse, prescriptionResponse, returnResponse } = reads;
      setError(errors[0]?.message || (errors.length ? translate('Một số dữ liệu POS không tải được.') : ''));
      setData({
        warehouses, branches, products, units, parties, taxes, accounts,
        sessions: itemsOf(sessionResponse).filter((row) => row.status === 'open').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        orders: itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        returns: itemsOf(returnResponse),
        cashMovements: itemsOf(movementResponse).filter((row) => row.status === 'draft').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        prescriptions: itemsOf(prescriptionResponse).filter((row) => ['verified', 'partially_dispensed'].includes(row.status)).sort((a, b) => String(a.valid_until || '').localeCompare(String(b.valid_until || ''))),
      });
    } catch (reason) {
      setError(translate(reason.message || 'Không tải được dữ liệu quầy POS.'));
    } finally {
      setLoading(false);
    }
  }, [translate]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, load };
}
