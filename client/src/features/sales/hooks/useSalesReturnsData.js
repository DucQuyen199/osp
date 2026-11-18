import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({
  orders: [], returns: [], products: new Map(), units: new Map(), parties: new Map(), warehouses: new Map(),
  shipments: [], invoices: [], creditNotes: [], approvalRequests: [],
});

export function useSalesReturnsData(logisticsEnabled, workflowApproval) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        orderRes: can('sales.sales_order.read') ? loadAllResponse('sales.sales_order') : Promise.resolve(emptyResponse()),
        returnRes: can('sales.sales_return.read') ? loadAllResponse('sales.sales_return') : Promise.resolve(emptyResponse()),
        productMap: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        unitMap: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        partyMap: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        warehouseMap: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        shipmentRes: logisticsEnabled && can('logistics.shipment.read') ? loadAllResponse('logistics.shipment') : Promise.resolve(emptyResponse()),
        invoiceRes: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        creditRes: can('accounting.credit_note.read') ? loadAllResponse('accounting.credit_note') : Promise.resolve(emptyResponse()),
        approvalRes: workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
      }, {
        orderRes: emptyResponse(), returnRes: emptyResponse(), productMap: emptyMap(), unitMap: emptyMap(),
        partyMap: emptyMap(), warehouseMap: emptyMap(), shipmentRes: emptyResponse(), invoiceRes: emptyResponse(),
        creditRes: emptyResponse(), approvalRes: emptyResponse(),
      });
      if (!isCurrent()) return;
      const { orderRes, returnRes, productMap, unitMap, partyMap, warehouseMap, shipmentRes, invoiceRes, creditRes, approvalRes } = reads;
      setData({
        orders: itemsOf(orderRes).sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || ''))),
        returns: itemsOf(returnRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        products: productMap,
        units: unitMap,
        parties: partyMap,
        warehouses: warehouseMap,
        shipments: itemsOf(shipmentRes),
        invoices: itemsOf(invoiceRes),
        creditNotes: itemsOf(creditRes),
        approvalRequests: itemsOf(approvalRes),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || uiText('Không tải được đơn bán và phiếu trả hàng.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || uiText('Không tải được đơn bán và phiếu trả hàng.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [logisticsEnabled, workflowApproval, beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
