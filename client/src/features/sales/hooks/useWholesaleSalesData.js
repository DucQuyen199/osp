import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import wholesaleEnglish from '../wholesale.en.js';

const t = (text) => uiTextWith(text, wholesaleEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({
  parties: new Map(), products: new Map(), units: new Map(), warehouses: new Map(), priceLists: [], quotations: [],
  orders: [], shipments: [], invoices: [], returns: [], approvalRequests: [], creditNotes: [],
});

export function useWholesaleSalesData(logisticsEnabled, accountingEnabled, approvalEnabled) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        priceLists: can('sales.price_list.read') ? loadAllResponse('sales.price_list') : Promise.resolve(emptyResponse()),
        quotations: can('sales.quotation.read') ? loadAllResponse('sales.quotation') : Promise.resolve(emptyResponse()),
        orders: can('sales.sales_order.read') ? loadAllResponse('sales.sales_order') : Promise.resolve(emptyResponse()),
        shipments: logisticsEnabled && can('logistics.shipment.read') ? loadAllResponse('logistics.shipment') : Promise.resolve(emptyResponse()),
        invoices: accountingEnabled && can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
        returns: can('sales.sales_return.read') ? loadAllResponse('sales.sales_return') : Promise.resolve(emptyResponse()),
        approvals: approvalEnabled && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
        creditNotes: can('accounting.credit_note.read') ? loadAllResponse('accounting.credit_note') : Promise.resolve(emptyResponse()),
      }, {
        parties: emptyMap(), products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), priceLists: emptyResponse(),
        quotations: emptyResponse(), orders: emptyResponse(), shipments: emptyResponse(), invoices: emptyResponse(),
        returns: emptyResponse(), approvals: emptyResponse(), creditNotes: emptyResponse(),
      });
      if (!isCurrent()) return;
      setData({
        parties: reads.parties,
        products: reads.products,
        units: reads.units,
        warehouses: reads.warehouses,
        priceLists: itemsOf(reads.priceLists),
        quotations: itemsOf(reads.quotations).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        orders: itemsOf(reads.orders).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        shipments: itemsOf(reads.shipments),
        invoices: itemsOf(reads.invoices),
        returns: itemsOf(reads.returns).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        approvalRequests: itemsOf(reads.approvals),
        creditNotes: itemsOf(reads.creditNotes),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được báo giá và đơn bán hàng.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được báo giá và đơn bán hàng.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [accountingEnabled, approvalEnabled, logisticsEnabled, beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
