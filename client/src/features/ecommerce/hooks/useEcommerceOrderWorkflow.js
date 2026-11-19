import { useEffect, useMemo, useState } from 'react';
import { api, dataPath, session } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';
import { fmtMoney } from '../../../lib/i18n.js';

export function useEcommerceOrderWorkflow({
  storefronts, products, orders, salesOrders, shipments, invoices, currencies,
  load, setError, t,
}) {
  const [party, setParty] = useState('');
  const [storefront, setStorefront] = useState('');
  const [channel, setChannel] = useState('web');
  const [address, setAddress] = useState('');
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const activeStorefronts = useMemo(() => new Map([...storefronts].filter(([, item]) => item.paused !== true)), [storefronts]);
  useEffect(() => {
    setStorefront((current) => current && activeStorefronts.has(current) ? current : activeStorefronts.keys().next().value || '');
  }, [activeStorefronts]);

  const cartDrafts = useMemo(() => Object.entries(quantities)
    .map(([id, qty]) => ({ product: products.get(id), qty: String(qty ?? '') }))
    .filter((line) => line.product), [quantities, products]);
  const cartLines = useMemo(() => cartDrafts.filter((line) => {
    try { return compareDecimals(line.qty || 0, 0) > 0; } catch { return false; }
  }), [cartDrafts]);
  const filteredProducts = useMemo(() => [...products.values()]
    .filter((item) => item.active !== false && (!query || `${item.name} ${item.sku || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')), [products, query]);

  const relatedSalesOrder = (webOrderId) => salesOrders.find((item) => item.source === 'ecommerce' && item.source_id === webOrderId);
  const relatedShipments = (salesOrderId) => shipments.filter((item) => item.source === 'sales_order' && item.source_id === salesOrderId);
  const relatedInvoice = (salesOrderId) => invoices.find((item) => item.source === 'sales_order' && item.source_id === salesOrderId);

  const setQty = (id, value) => setQuantities((current) => {
    const next = { ...current };
    if (value === '' || value == null) next[id] = '';
    else {
      try { if (compareDecimals(value, 0) > 0) next[id] = String(value); else delete next[id]; }
      catch { next[id] = String(value); }
    }
    return next;
  });

  const createCart = async (event) => {
    event.preventDefault();
    if (!cartLines.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const payload = {
        party, storefront, channel, shipping_address: address.trim() || undefined,
        lines: cartLines.map(({ product, qty }) => ({ product: product.id, qty })),
      };
      const scope = `${session.current()?.tenantId || ''}:ecommerce.web_order:create`;
      const { key, fingerprint } = getPersistentIdempotencyRequest(scope, JSON.stringify(payload));
      const created = await api(dataPath('ecommerce.web_order'), {
        method: 'POST', body: payload,
        headers: { 'idempotency-key': key },
      });
      clearPersistentIdempotencyRequest(scope, fingerprint);
      setQuantities({}); setAddress('');
      await load(true);
      setNotice(`${t('Đã tạo giỏ hàng')} ${String(created.id).slice(0, 8)} ${t('với giá theo gian hàng. Kiểm tra tổng tiền rồi đặt đơn.')}`);
    } catch (reason) { setError(t(reason.message || 'Không tạo được giỏ hàng online.')); }
    finally { setBusy(''); }
  };

  const transition = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('ecommerce.web_order', order.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'placed' ? t('Đơn đã được chuyển sang bán hàng. Tồn kho và hóa đơn được cập nhật theo luồng giao hàng của đơn.') : t('Đã hủy giỏ hàng.'));
    } catch (reason) {
      setError(t(reason.message || (action === 'placed' ? 'Không đặt được đơn. Kiểm tra giá, kho và tồn khả dụng.' : 'Không hủy được giỏ hàng.')));
      await load(true);
    } finally { setBusy(''); }
  };

  const refreshCartPrice = async (order) => {
    setBusy(`${order.id}:reprice`); setError(''); setNotice('');
    try {
      const refreshed = await api(dataPath('ecommerce.web_order', order.id), { method: 'PATCH', body: {
        lines: (order.lines || []).map((line) => ({ product: line.product, qty: line.qty })),
      } });
      await load(true);
      const currencyCode = currencies.get(order.currency)?.code;
      setNotice(`${t('Đã cập nhật giá giỏ hàng:')} ${fmtMoney(order.total || 0, currencyCode)} → ${fmtMoney(refreshed.total || 0, currencyCode)}. ${t('Hãy kiểm tra lại trước khi đặt đơn.')}`);
    } catch (reason) { setError(t(reason.message || 'Không cập nhật được giá giỏ hàng.')); await load(true); }
    finally { setBusy(''); }
  };

  return {
    party, setParty, storefront, setStorefront, channel, setChannel, address, setAddress,
    query, setQuery, quantities, busy, notice, activeStorefronts, cartDrafts, cartLines,
    filteredProducts, setQty, createCart, transition, refreshCartPrice,
    relatedSalesOrder, relatedShipments, relatedInvoice,
  };
}
