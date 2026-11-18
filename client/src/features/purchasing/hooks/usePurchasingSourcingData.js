import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAll, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyArray = () => [];
const emptyMap = () => new Map();
const emptyData = () => ({ requisitions: [], rfqs: [], orders: [], suppliers: new Map(), products: new Map(), units: new Map(), taxes: new Map() });

export function usePurchasingSourcingData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        requisitions: can('purchasing.purchase_requisition.read') ? loadAll('purchasing.purchase_requisition') : Promise.resolve(emptyArray()),
        rfqs: can('purchasing.rfq.read') ? loadAll('purchasing.rfq') : Promise.resolve(emptyArray()),
        orders: can('purchasing.purchase_order.read') ? loadAll('purchasing.purchase_order') : Promise.resolve(emptyArray()),
        suppliers: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        taxes: can('master-data.tax.read') ? loadAll('master-data.tax') : Promise.resolve(emptyArray()),
      }, {
        requisitions: emptyArray(), rfqs: emptyArray(), orders: emptyArray(), suppliers: emptyMap(), products: emptyMap(), units: emptyMap(), taxes: emptyArray(),
      });
      if (!isCurrent()) return;
      const requisitions = reads.requisitions.filter((row) => row.sourcing_method === 'competitive' && ['approved', 'sourced'].includes(row.status))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setData({
        requisitions, rfqs: reads.rfqs, orders: reads.orders,
        suppliers: new Map([...reads.suppliers].filter(([, row]) => row.is_supplier !== false)),
        products: reads.products, units: reads.units,
        taxes: new Map(reads.taxes.map((row) => [row.id, row])),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được hồ sơ RFQ và đề nghị mua cạnh tranh.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || uiText('Không tải được hồ sơ RFQ và đề nghị mua cạnh tranh.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
