import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];

export default function EcommerceOrderDeskPage() {
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
    } catch (reason) { setError(reason.message || 'Không tải được danh sách đơn online.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    document.title = 'Điều phối đơn online · OSP Suite';
    load();
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
      await load(true); setNotice(`Đã tạo giỏ hàng ${String(created.id).slice(0, 8)} với giá theo gian hàng. Kiểm tra tổng tiền rồi đặt đơn.`);
    } catch (reason) { setError(reason.message || 'Không tạo được giỏ hàng online.'); }
    finally { setBusy(''); }
  };

  const transition = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('ecommerce.web_order', order.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'placed' ? 'Đơn đã được chuyển sang bán hàng. Tồn kho và hóa đơn được cập nhật theo luồng giao hàng của đơn.' : 'Đã hủy giỏ hàng.');
    } catch (reason) { setError(reason.message || (action === 'placed' ? 'Không đặt được đơn. Kiểm tra giá, kho và tồn khả dụng.' : 'Không hủy được giỏ hàng.')); await load(true); }
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
      setNotice(`Đã cập nhật giá giỏ hàng: ${fmtMoney(order.total || 0, currencyCode)} → ${fmtMoney(refreshed.total || 0, currencyCode)}. Hãy kiểm tra lại trước khi đặt đơn.`);
    } catch (reason) { setError(reason.message || 'Không cập nhật được giá giỏ hàng.'); await load(true); }
    finally { setBusy(''); }
  };

  const renderOrder = (order) => {
    const currencyCode = currencies.get(order.currency)?.code;
    const sale = relatedSalesOrder(order.id);
    const orderShipments = sale ? relatedShipments(sale.id) : [];
    const invoice = sale && relatedInvoice(sale.id);
    return <article className="card ecommerce-order" key={order.id}>
      <header className="card-head"><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">{storefronts.get(order.storefront)?.name || 'Gian hàng'} · {order.channel || 'web'} · {fmtDateTime(order.created_at)}</div></div><span className={`badge ${order.status === 'placed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></header>
      <ul className="ecommerce-order-lines">{(order.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || 'Sản phẩm'} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? (Number(line.price || 0) * Number(line.qty || 0)), currencyCode)}</strong></li>)}</ul>
      <div className="ecommerce-order-total"><span>Tổng đơn{currencyCode ? ` (${currencyCode})` : ''}</span><strong className="num">{fmtMoney(order.total || 0, currencyCode)}</strong></div>
      {order.shipping_address && <div className="small muted ecommerce-address">Giao đến: {order.shipping_address}</div>}
      <footer className="row wrap ecommerce-order-footer">
        {sale && can('sales.sales_order.read') && <a className="small" href={recordHref('sales.sales_order', sale.id)}>Đơn bán {sale.number || String(sale.id).slice(0, 8)} · {statusLabel(sale.status)}</a>}
        {orderShipments.map((shipment) => can('logistics.shipment.read') && <a className="small" key={shipment.id} href={recordHref('logistics.shipment', shipment.id)}>Vận đơn {shipment.tracking_number || String(shipment.id).slice(0, 8)} · {statusLabel(shipment.status)}</a>)}
        {invoice && can('accounting.invoice.read') && <a className="small" href={recordHref('accounting.invoice', invoice.id)}>Hóa đơn · {statusLabel(invoice.status)}</a>}
        <span className="grow" />
        {order.status === 'cart' && can('ecommerce.web_order.update') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => refreshCartPrice(order)}>{busy === `${order.id}:reprice` ? 'Đang cập nhật…' : 'Cập nhật giá'}</button>}
        {order.status === 'cart' && can('ecommerce.web_order.placed') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => transition(order, 'placed')}>{busy === `${order.id}:placed` ? 'Đang đặt…' : 'Xác nhận đặt đơn'}</button>}
        {order.status === 'cart' && can('ecommerce.web_order.cancelled') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => transition(order, 'cancelled')}>{busy === `${order.id}:cancelled` ? 'Đang hủy…' : 'Hủy giỏ'}</button>}
        {order.status === 'placed' && sale?.status === 'confirmed' && can('ecommerce.web_order.cancelled') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => transition(order, 'cancelled')}>{busy === `${order.id}:cancelled` ? 'Đang hủy…' : 'Hủy đơn chưa giao'}</button>}
        {sale && !can('sales.sales_order.read') && <span className="small muted">Đã chuyển thành đơn bán</span>}
      </footer>
    </article>;
  };

  const draftCarts = orders.filter((order) => order.status === 'cart');
  const placedOrders = orders.filter((order) => order.status === 'placed');
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled');

  return <div className="page ecommerce-page">
    <div className="page-head"><div><h1>Điều phối đơn online</h1><p className="sub">Giá đơn được lấy từ gian hàng và bảng giá. Đơn có vận đơn ghi nhận tồn kho theo từng lần giao và lập hóa đơn sau khi giao đủ; đơn bán trực tiếp tuân theo luồng bán hàng chuẩn.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
    <div className="row wrap ecommerce-summary"><span className="badge warning">Giỏ chờ đặt: {draftCarts.length}</span><span className="badge success">Đã đặt: {placedOrders.length}</span><span className="badge plain">Đã hủy: {cancelledOrders.length}</span></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading && !orders.length ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('ecommerce.web_order.create') && <section className="card ecommerce-create"><header><h2>Tạo giỏ hàng / nhận đơn</h2><p className="small muted">Tạo giỏ để máy chủ áp dụng đúng giá và thuế; sau đó kiểm tra tổng tiền trước khi xác nhận đặt.</p></header><form className="ecommerce-create-form" onSubmit={createCart}>
        <label className="field"><span className="label">Gian hàng *</span><select className="select" required value={storefront} onChange={(event) => setStorefront(event.target.value)}><option value="">Chọn gian hàng</option>{[...storefronts.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span className="label">Khách hàng *</span><select className="select" required value={party} onChange={(event) => setParty(event.target.value)}><option value="">Chọn khách hàng</option>{[...parties.values()].filter((item) => item.active !== false && item.is_customer !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
        <label className="field"><span className="label">Kênh</span><select className="select" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="web">Website</option><option value="app">Ứng dụng</option><option value="marketplace">Sàn thương mại</option></select></label>
        <label className="field"><span className="label">Địa chỉ giao hàng</span><input className="input" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <div className="ecommerce-product-picker"><div className="row wrap"><h3>Sản phẩm</h3><span className="grow" /><input className="input" type="search" placeholder="Tìm sản phẩm" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="ecommerce-products">{filteredProducts.map((product) => <button key={product.id} type="button" className={`card ecommerce-product${quantities[product.id] ? ' selected' : ''}`} onClick={() => setQty(product.id, (Number(quantities[product.id]) || 0) + 1)}><strong>{product.name}</strong><span className="small muted">{product.sku || ''}</span><span>{quantities[product.id] ? `Đã chọn · ${quantities[product.id]}` : 'Thêm vào giỏ'}</span></button>)}</div></div>
        {cartLines.length > 0 && <div className="ecommerce-cart-lines">{cartLines.map(({ product, qty }) => <div className="ecommerce-cart-line" key={product.id}><span>{product.name}</span><input className="input num" type="number" min="0.001" step="any" aria-label={`Số lượng ${product.name}`} value={qty} onChange={(event) => setQty(product.id, event.target.value)} /><button className="btn btn-ghost btn-sm" type="button" onClick={() => setQty(product.id, 0)}>Xóa</button></div>)}</div>}
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !cartLines.length}>{busy === 'create' ? 'Đang tạo…' : 'Tạo giỏ và tính giá'}</button>
      </form></section>}
      <section className="ecommerce-order-section"><header><h2>Giỏ chờ xác nhận</h2><span className="badge plain">{draftCarts.length}</span></header><div className="ecommerce-orders">{draftCarts.map(renderOrder)}{!draftCarts.length && <div className="empty">Không có giỏ hàng chờ xử lý.</div>}</div></section>
      <section className="ecommerce-order-section"><header><h2>Đơn đã đặt</h2><span className="badge plain">{placedOrders.length}</span></header><div className="ecommerce-orders">{placedOrders.map(renderOrder)}{!placedOrders.length && <div className="empty">Chưa có đơn online được đặt.</div>}</div></section>
    </>}
  </div>;
}
