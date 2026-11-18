import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAll, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const emptyMap = () => new Map();
const emptyRows = () => [];
const asMap = (rows) => new Map(rows.map((row) => [row.id, row]));
const emptyData = () => ({ counts: [], warehouses: new Map(), products: new Map(), units: new Map(), lots: new Map(), locations: new Map(), approvalRequests: [] });

export function useStockCountData(workflowApproval) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true);
    setError('');
    try {
      const { data: reads, errors } = await loadIndependentData({
        counts: can('inventory.stock_count.read') ? loadAll('inventory.stock_count') : Promise.resolve(emptyRows()),
        warehouses: can('inventory.warehouse.read') ? loadAll('inventory.warehouse') : Promise.resolve(emptyRows()),
        products: can('master-data.product.read') ? loadAll('master-data.product') : Promise.resolve(emptyRows()),
        units: can('master-data.uom.read') ? loadAll('master-data.uom') : Promise.resolve(emptyRows()),
        lots: can('inventory.lot.read') ? loadAll('inventory.lot') : Promise.resolve(emptyRows()),
        locations: can('inventory.warehouse_location.read') ? loadAll('inventory.warehouse_location') : Promise.resolve(emptyRows()),
        approvalRequests: workflowApproval && can('workflow-approval.approval_request.read') ? loadAll('workflow-approval.approval_request') : Promise.resolve(emptyRows()),
      }, {
        counts: emptyRows(), warehouses: emptyRows(), products: emptyRows(), units: emptyRows(), lots: emptyRows(),
        locations: emptyRows(), approvalRequests: emptyRows(),
      });
      if (!isCurrent()) return;
      setData({
        counts: reads.counts.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))),
        warehouses: asMap(reads.warehouses),
        products: asMap(reads.products),
        units: asMap(reads.units),
        lots: asMap(reads.lots),
        locations: asMap(reads.locations),
        approvalRequests: reads.approvalRequests,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được danh sách kiểm kê.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || uiText('Không tải được danh sách kiểm kê.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [workflowApproval, beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
