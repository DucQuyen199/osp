import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import ecommerceEnglish from '../ecommerce.en.js';

const t = (text) => uiTextWith(text, ecommerceEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({
  storefronts: new Map(), parties: new Map(), products: new Map(), currencies: new Map(),
  orders: [], salesOrders: [], shipments: [], invoices: [],
});

export function useEcommerceOrderData(logisticsEnabled) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        storefronts: can('ecommerce.storefront.read') ? loadRefs('ecommerce.storefront') : Promise.resolve(emptyMap()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        currencies: can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(emptyMap()),
        orders: can('ecommerce.web_order.read') ? loadAllResponse('ecommerce.web_order') : Promise.resolve(emptyResponse()),
        salesOrders: can('sales.sales_order.read') ? loadAllResponse('sales.sales_order') : Promise.resolve(emptyResponse()),
        shipments: logisticsEnabled && can('logistics.shipment.read') ? loadAllResponse('logistics.shipment') : Promise.resolve(emptyResponse()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, {
        storefronts: emptyMap(), parties: emptyMap(), products: emptyMap(), currencies: emptyMap(),
        orders: emptyResponse(), salesOrders: emptyResponse(), shipments: emptyResponse(), invoices: emptyResponse(),
      });
      if (!isCurrent()) return;
      setData({
        storefronts: reads.storefronts,
        parties: reads.parties,
        products: reads.products,
        currencies: reads.currencies,
        orders: itemsOf(reads.orders).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        salesOrders: itemsOf(reads.salesOrders),
        shipments: itemsOf(reads.shipments),
        invoices: itemsOf(reads.invoices),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được danh sách đơn online.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được danh sách đơn online.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [logisticsEnabled, beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
