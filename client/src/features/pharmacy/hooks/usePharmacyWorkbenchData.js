import { useCallback, useEffect, useState } from 'react';
import { addDecimals } from '../../../lib/decimal.js';
import { can, loadRefs, loadAllResponse, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyResponse = (sourceLoaded = false) => ({ items: [], sourceLoaded });
const emptyMap = () => new Map();

/** Owns pharmacy reference, prescription, dispense, and returned-medicine reads. */
export function usePharmacyWorkbenchData({ t }) {
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [prescriptions, setPrescriptions] = useState([]);
  const [returnInspections, setReturnInspections] = useState([]);
  const [returnDispositions, setReturnDispositions] = useState([]);
  const [dispensedByPrescription, setDispensedByPrescription] = useState(new Map());
  const [dispensedDataAvailable, setDispensedDataAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true); setError('');
    try {
      const { data, errors } = await loadIndependentData({
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        prescriptions: can('pharmacy.prescription.read') ? loadAllResponse('pharmacy.prescription') : Promise.resolve(emptyResponse()),
        orders: can('pos.pos_order.read')
          ? loadAllResponse('pos.pos_order').then((response) => ({ ...response, sourceLoaded: true }))
          : Promise.resolve(emptyResponse()),
        inspections: can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve(emptyResponse()),
        dispositions: can('pharmacy.return_disposition.read') ? loadAllResponse('pharmacy.return_disposition') : Promise.resolve(emptyResponse()),
      }, {
        products: emptyMap(), parties: emptyMap(), units: emptyMap(), prescriptions: emptyResponse(),
        orders: emptyResponse(), inspections: emptyResponse(), dispositions: emptyResponse(),
      });
      if (!isCurrent()) return;
      const {
        products: productMap, parties: partyMap, units: unitMap, prescriptions: rxResponse,
        orders: orderResponse, inspections: inspectionResponse, dispositions: dispositionResponse,
      } = data;
      setProducts([...productMap.values()]
        .filter((product) => product.active !== false && (product.kind || 'goods') === 'goods'
          && product.tracked !== false && product.requires_prescription === true)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')));
      setUnits(unitMap);
      setParties(partyMap);
      setPrescriptions((rxResponse.items || [])
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setReturnInspections((inspectionResponse.items || [])
        .filter((item) => item.source === 'pharmacy_return')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setReturnDispositions(dispositionResponse.items || []);
      setDispensedDataAvailable(orderResponse.sourceLoaded === true);
      const dispensed = new Map();
      for (const order of orderResponse.items || []) {
        if (order.status !== 'completed' || !order.prescription) continue;
        const quantities = dispensed.get(order.prescription) || new Map();
        for (const line of Array.isArray(order.lines) ? order.lines : []) {
          if (!line.product) continue;
          quantities.set(line.product, addDecimals([quantities.get(line.product) || '0', line.base_qty ?? line.qty ?? 0]));
        }
        dispensed.set(order.prescription, quantities);
      }
      setDispensedByPrescription(dispensed);
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được một phần dữ liệu nhà thuốc.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được danh sách đơn thuốc.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest, t]);

  useEffect(() => { load(); }, [load]);

  return {
    products, units, parties, prescriptions, returnInspections, returnDispositions,
    setReturnDispositions, dispensedByPrescription, dispensedDataAvailable,
    loading, error, setError, load,
  };
}
