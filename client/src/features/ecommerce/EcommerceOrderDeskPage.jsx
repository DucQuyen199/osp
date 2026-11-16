import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtMoney, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import ecommerceEnglish from './ecommerce.en.js';
import WebOrderCard from './components/WebOrderCard.jsx';
import WebOrderCreateForm from './components/WebOrderCreateForm.jsx';
const t = (text) => uiTextWith(text, ecommerceEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
export default function EcommerceOrderDeskPage() {
  useDocumentTitle(`${t('Điều phối đơn online')} · OSP Suite`);
  const [storefronts, setStorefronts] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [currencies, setCurrencies] = useState(new Map());
  const [orders, setOrders] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [party, setParty] = useState('');
  const [storefront, setStorefront] = useState('');
  const [channel, setChannel] = useState('web');
  const [address, setAddress] = useState('');
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') && can('logistics.shipment.read');
      const [storefrontMap, partyMap, productMap, currencyMap, orderResponse, salesResponse, shipmentResponse, invoiceResponse] = await Promise.all([
        loadRefs('ecommerce.storefront'), loadRefs('master-data.party'), loadRefs('master-data.product'),
        can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(new Map()),
        loadAllResponse('ecommerce.web_order'), can('sales.sales_order.read') ? loadAllResponse('sales.sales_order') : Promise.resolve({ items: [] }),
        logisticsEnabled ? loadAllResponse('logistics.shipment') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      setStorefronts(storefrontMap); setParties(partyMap); setProducts(productMap); setCurrencies(currencyMap);
      setOrders(itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setSalesOrders(itemsOf(salesResponse)); setShipments(itemsOf(shipmentResponse)); setInvoices(itemsOf(invoiceResponse));
    } catch (reason) { setError(t(reason.message || 'Không tải được danh sách đơn online.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load();
    const timer = window.setInterval(() => load(true), 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  const cartLines = useMemo(() => Object.entries(quantities).map(([id, qty]) => ({ product: products.get(id), qty: Number(qty) })).filter((line) => line.product && line.qty > 0), [quantities, products]);
  const filteredProducts = [...products.values()].filter((item) => item.active !== false && (!query || `${item.name} ${item.sku || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const relatedSalesOrder = (webOrderId) => salesOrders.find((item) => item.source === 'ecommerce' && item.source_id === webOrderId);
  const relatedShipments = (salesOrderId) => shipments.filter((item) => item.source === 'sales_order' && item.source_id === salesOrderId);
  const relatedInvoice = (salesOrderId) => invoices.find((item) => item.source === 'sales_order' && item.source_id === salesOrderId);
  const setQty = (id, value) => setQuantities((current) => {
    const next = { ...current }; const qty = Math.max(0, Number(value) || 0);
    if (qty > 0) next[id] = qty; else delete next[id];
    return next;
  });
  const createCart = async (event) => {
    event.preventDefault(); if (!cartLines.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('ecommerce.web_order'), { method: 'POST', body: {
        party, storefront, channel, shipping_address: address.trim() || undefined,
        lines: cartLines.map(({ product, qty }) => ({ product: product.id, qty })),
      } });
      setQuantities({}); setAddress('');
      await load(true); setNotice(`${t('Đã tạo giỏ hàng')} ${String(created.id).slice(0, 8)} ${t('với giá theo gian hàng. Kiểm tra tổng tiền rồi đặt đơn.')}`);
    } catch (reason) { setError(t(reason.message || 'Không tạo được giỏ hàng online.')); }
    finally { setBusy(''); }
  };
  const transition = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('ecommerce.web_order', order.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'placed' ? t('Đơn đã được chuyển sang bán hàng. Tồn kho và hóa đơn được cập nhật theo luồng giao hàng của đơn.') : t('Đã hủy giỏ hàng.'));
    } catch (reason) { setError(t(reason.message || (action === 'placed' ? 'Không đặt được đơn. Kiểm tra giá, kho và tồn khả dụng.' : 'Không hủy được giỏ hàng.'))); await load(true); }
    finally { setBusy(''); }
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
  const renderOrder = (order) => {
    const currencyCode = currencies.get(order.currency)?.code;
    const sale = relatedSalesOrder(order.id);
    const orderShipments = sale ? relatedShipments(sale.id) : [];
    const invoice = sale && relatedInvoice(sale.id);
    return <WebOrderCard key={order.id}
      order={order}
      storefrontName={storefronts.get(order.storefront)?.name}
      partyName={recordLabel('master-data.party', parties.get(order.party))}
      products={products}
      currencyCode={currencyCode}
      sale={sale}
      shipments={orderShipments}
      invoice={invoice}
      busy={busy}
      permissions={{
        salesRead: can('sales.sales_order.read'),
        logisticsRead: can('logistics.shipment.read'),
        invoiceRead: can('accounting.invoice.read'),
        update: can('ecommerce.web_order.update'),
        place: can('ecommerce.web_order.placed'),
        cancel: can('ecommerce.web_order.cancelled'),
      }}
      onRefreshPrice={refreshCartPrice}
      onTransition={transition}
      t={t}
    />;
  };
  const draftCarts = orders.filter((order) => order.status === 'cart');
  const placedOrders = orders.filter((order) => order.status === 'placed');
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled');
  return <div className="page ecommerce-page">
    <div className="page-head"><div><h1>{t('Điều phối đơn online')}</h1><p className="sub">{t('Giá đơn được lấy từ gian hàng và bảng giá. Đơn có vận đơn ghi nhận tồn kho theo từng lần giao và lập hóa đơn sau khi giao đủ; đơn bán trực tiếp tuân theo luồng bán hàng chuẩn.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap ecommerce-summary"><span className="badge warning">{t('Giỏ chờ đặt:')} {draftCarts.length}</span><span className="badge success">{t('Đã đặt:')} {placedOrders.length}</span><span className="badge plain">{t('Đã hủy:')} {cancelledOrders.length}</span></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading && !orders.length ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('ecommerce.web_order.create') && <WebOrderCreateForm
        storefronts={storefronts}
        parties={parties}
        filteredProducts={filteredProducts}
        quantities={quantities}
        cartLines={cartLines}
        storefront={storefront}
        party={party}
        channel={channel}
        address={address}
        query={query}
        busy={busy}
        onStorefrontChange={setStorefront}
        onPartyChange={setParty}
        onChannelChange={setChannel}
        onAddressChange={setAddress}
        onQueryChange={setQuery}
        onSetQuantity={setQty}
        onSubmit={createCart}
        t={t}
      />}
      <section className="ecommerce-order-section"><header><h2>{t('Giỏ chờ xác nhận')}</h2><span className="badge plain">{draftCarts.length}</span></header><div className="ecommerce-orders">{draftCarts.map(renderOrder)}{!draftCarts.length && <div className="empty">{t('Không có giỏ hàng chờ xử lý.')}</div>}</div></section>
      <section className="ecommerce-order-section"><header><h2>{t('Đơn đã đặt')}</h2><span className="badge plain">{placedOrders.length}</span></header><div className="ecommerce-orders">{placedOrders.map(renderOrder)}{!placedOrders.length && <div className="empty">{t('Chưa có đơn online được đặt.')}</div>}</div></section>
    </>}
  </div>;
}
