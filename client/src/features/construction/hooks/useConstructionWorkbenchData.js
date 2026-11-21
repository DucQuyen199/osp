import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import constructionEnglish from '../construction.en.js';

const t = (text) => uiTextWith(text, constructionEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({
  projects: [], sites: [], diaries: [], boqs: [], subcontracts: [], claims: [], bills: [],
  parties: new Map(), products: new Map(), units: new Map(), warehouses: new Map(),
  materialRequests: [], purchaseRequisitions: [],
});

/** Loads construction operations and cross-module references independently. */
export function useConstructionWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        projects: can('project.project.read') ? loadAllResponse('project.project') : Promise.resolve(emptyResponse()),
        sites: can('construction.site.read') ? loadAllResponse('construction.site') : Promise.resolve(emptyResponse()),
        diaries: can('construction.site_diary.read') ? loadAllResponse('construction.site_diary') : Promise.resolve(emptyResponse()),
        boqs: can('construction.boq.read') ? loadAllResponse('construction.boq') : Promise.resolve(emptyResponse()),
        subcontracts: can('construction.subcontract.read') ? loadAllResponse('construction.subcontract') : Promise.resolve(emptyResponse()),
        claims: can('construction.progress_claim.read') ? loadAllResponse('construction.progress_claim') : Promise.resolve(emptyResponse()),
        bills: can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        materialRequests: can('construction.material_request.read') ? loadAllResponse('construction.material_request') : Promise.resolve(emptyResponse()),
        purchaseRequisitions: can('purchasing.purchase_requisition.read') ? loadAllResponse('purchasing.purchase_requisition') : Promise.resolve(emptyResponse()),
      }, {
        projects: emptyResponse(), sites: emptyResponse(), diaries: emptyResponse(), boqs: emptyResponse(),
        subcontracts: emptyResponse(), claims: emptyResponse(), bills: emptyResponse(), parties: emptyMap(),
        products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), materialRequests: emptyResponse(),
        purchaseRequisitions: emptyResponse(),
      });
      if (!isCurrent()) return;
      setData({
        projects: itemsOf(reads.projects), sites: itemsOf(reads.sites), diaries: itemsOf(reads.diaries),
        boqs: itemsOf(reads.boqs), subcontracts: itemsOf(reads.subcontracts), claims: itemsOf(reads.claims),
        bills: itemsOf(reads.bills), parties: reads.parties, products: reads.products, units: reads.units,
        warehouses: reads.warehouses, materialRequests: itemsOf(reads.materialRequests),
        purchaseRequisitions: itemsOf(reads.purchaseRequisitions),
      });
      if (errors.length) setError(errors[0]?.message || t('Một số dữ liệu công trường không tải được.'));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được dữ liệu công trường.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);

  return { ...data, loading, error, setError, load };
}
