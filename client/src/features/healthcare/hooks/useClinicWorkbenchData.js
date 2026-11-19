import { useCallback, useEffect, useState } from 'react';
import { can, loadAll, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useClinicWorkbenchData({ t }) {
  const [patients, setPatients] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [encounters, setEncounters] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [labOrders, setLabOrders] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true); setError('');
    try {
      const { data, errors } = await loadIndependentData({
        patients: can('clinic.patient.read') ? loadAll('clinic.patient') : Promise.resolve([]),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        encounters: can('clinic.encounter.read') ? loadAll('clinic.encounter') : Promise.resolve([]),
        prescriptions: can('clinic.prescription.read') ? loadAll('clinic.prescription') : Promise.resolve([]),
        labOrders: can('clinic.lab_order.read') ? loadAll('clinic.lab_order') : Promise.resolve([]),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
      }, {
        patients: [], parties: new Map(), encounters: [], prescriptions: [], labOrders: [],
        products: new Map(), units: new Map(), warehouses: new Map(),
      });
      if (!isCurrent()) return;
      const encounterItems = data.encounters.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPatients(data.patients); setParties(data.parties); setEncounters(encounterItems);
      setPrescriptions(data.prescriptions); setLabOrders(data.labOrders);
      setProducts(data.products); setUnits(data.units); setWarehouses(data.warehouses);
      setSelectedId((current) => encounterItems.some((item) => item.id === current)
        ? current : encounterItems.find((item) => item.status === 'open')?.id || encounterItems[0]?.id || '');
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được một phần dữ liệu phòng khám.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được dữ liệu phòng khám.'));
    } finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest, t]);

  useEffect(() => { load(); }, [load]);

  return {
    patients, parties, encounters, prescriptions, labOrders, products, units, warehouses,
    selectedId, setSelectedId, loading, error, load,
  };
}
