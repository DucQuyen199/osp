import { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { can, loadRefs, loadAllResponse, loadIndependentData } from '../../../lib/state.js';
import { uiTextWith } from '../../../lib/i18n.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import manufacturingEnglish from '../manufacturing.en.js';

const t = (text) => uiTextWith(text, manufacturingEnglish);

export function useManufacturingWipData(asOf) {
  const [report, setReport] = useState(null);
  const [accounts, setAccounts] = useState(new Map());
  const [boms, setBoms] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [reworkOrders, setReworkOrders] = useState([]);
  const [productionDispositions, setProductionDispositions] = useState([]);
  const [conditionalAcceptances, setConditionalAcceptances] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [workCenters, setWorkCenters] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (asOf) params.set('asOf', asOf);
      const { data, errors } = await loadIndependentData({
        report: api(`${tenantPath('/reports/manufacturing/wip')}?${params}`),
        boms: can('manufacturing.bom.read') ? loadAllResponse('manufacturing.bom') : Promise.resolve({ items: [] }),
        productionOrders: can('manufacturing.production_order.read') ? loadAllResponse('manufacturing.production_order') : Promise.resolve({ items: [] }),
        reworkOrders: can('manufacturing.rework_order.read') ? loadAllResponse('manufacturing.rework_order') : Promise.resolve({ items: [] }),
        inspections: can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        dispositions: can('manufacturing.production_disposition.read') ? loadAllResponse('manufacturing.production_disposition') : Promise.resolve({ items: [] }),
        acceptances: can('manufacturing.conditional_acceptance.read') ? loadAllResponse('manufacturing.conditional_acceptance') : Promise.resolve({ items: [] }),
        workCenters: can('manufacturing.work_center.read') ? loadRefs('manufacturing.work_center') : Promise.resolve(new Map()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        accounts: can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
      }, {
        report: null, boms: { items: [] }, productionOrders: { items: [] }, reworkOrders: { items: [] },
        inspections: { items: [] }, dispositions: { items: [] }, acceptances: { items: [] },
        workCenters: new Map(), products: new Map(), warehouses: new Map(), units: new Map(), accounts: new Map(),
      });
      if (!isCurrent()) return;
      setReport(data.report);
      setBoms(Array.isArray(data.boms.items) ? data.boms.items : []);
      setProductionOrders(Array.isArray(data.productionOrders.items) ? data.productionOrders.items : []);
      setReworkOrders(Array.isArray(data.reworkOrders.items) ? data.reworkOrders.items : []);
      setProductionDispositions(Array.isArray(data.dispositions.items) ? data.dispositions.items : []);
      setConditionalAcceptances(Array.isArray(data.acceptances.items) ? data.acceptances.items : []);
      setInspections(Array.isArray(data.inspections.items) ? data.inspections.items : []);
      setWorkCenters(data.workCenters); setProducts(data.products); setWarehouses(data.warehouses); setUnits(data.units); setAccounts(data.accounts);
      if (errors.length) setLoadError(errors.map((reason) => reason?.message || t('Không tải được báo cáo WIP.')).join(' · '));
    } catch (reason) {
      if (!isCurrent()) return;
      setReport(null);
      setLoadError(reason.message || t('Không tải được báo cáo WIP.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [asOf, beginRequest]);

  useEffect(() => { load(); }, [load]);

  return {
    report, accounts, boms, productionOrders, reworkOrders, productionDispositions,
    conditionalAcceptances, inspections, workCenters, products, warehouses, units,
    loading, loadError, load,
  };
}
