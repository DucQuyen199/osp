import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const METHODS = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử']];

export default function RestaurantServicePage() {
  const [tables, setTables] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [quantities, setQuantities] = useState({});
  const [tableId, setTableId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [method, setMethod] = useState('cash');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const canReadTickets = can('restaurant.kitchen_ticket.read');
      const canReadInvoices = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.payment.read');
      const [tableResponse, menuResponse, orderResponse, productMap, warehouseMap, ticketResponse, invoiceResponse] = await Promise.all([
        api(`${dataPath('restaurant.table')}?limit=1000`), api(`${dataPath('restaurant.menu_item')}?limit=1000`),
        api(`${dataPath('restaurant.table_order')}?limit=1000`), loadRefs('master-data.product'), loadRefs('inventory.warehouse'),
        canReadTickets ? api(`${dataPath('restaurant.kitchen_ticket')}?limit=1000`) : Promise.resolve({ items: [] }),
        canReadInvoices ? api(`${dataPath('accounting.payment')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      const nextOrders = itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setTables(itemsOf(tableResponse)); setMenuItems(itemsOf(menuResponse)); setOrders(nextOrders); setProducts(productMap); setWarehouses(warehouseMap); setTickets(itemsOf(ticketResponse)); setInvoices(itemsOf(invoiceResponse));
      setSelectedId((current) => nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu nhà hàng.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Phục vụ nhà hàng · OSP Suite'; load(); const timer = window.setInterval(() => load(true), 15000); return () => window.clearInterval(timer); }, [load]);

  const occupiedTableIds = useMemo(() => new Set(orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).map((order) => order.table).filter(Boolean)), [orders]);
  const availableTables = tables.filter((table) => !occupiedTableIds.has(table.id));
  const availableMenu = menuItems.filter((item) => item.available !== false).map((item) => ({ item, product: products.get(item.product) })).filter(({ product }) => product && product.active !== false).sort((a, b) => String(a.product.name).localeCompare(String(b.product.name), 'vi'));
  const selected = orders.find((order) => order.id === selectedId) || null;
  const selectedPayment = selected && invoices.find((payment) => payment.source === 'table_order' && payment.source_id === selected.id);
  const selectedNeedsWarehouse = Boolean(selected?.consumptions?.length);
  const selectedTickets = tickets.filter((ticket) => ticket.order === selectedId);
  const ticketsReady = selectedTickets.length > 0 && selectedTickets.every((ticket) => ticket.status === 'ready');
  const cart = Object.entries(quantities).map(([id, qty]) => ({ ...availableMenu.find(({ item }) => item.id === id), menuItemId: id, qty: Number(qty) })).filter((line) => line.product && line.qty > 0);
  const indicativeTotal = cart.reduce((total, line) => total + (Number(line.product.price) || 0) * line.qty, 0);
  const setQuantity = (id, value) => setQuantities((current) => { const next = { ...current }; const qty = Math.max(0, Number(value) || 0); if (qty) next[id] = qty; else delete next[id]; return next; });

  const createOrder = async (event) => {
    event.preventDefault(); if (!cart.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('restaurant.table_order'), { method: 'POST', body: {
        table: tableId || undefined, warehouse: warehouseId || undefined,
        lines: cart.map(({ product, qty }) => ({ product: product.id, qty })),
      } });
      setQuantities({}); setTableId(''); await load(true); setSelectedId(created.id);
      setNotice(`Đã tạo order ${String(created.id).slice(0, 8)}. Giá món do server lấy từ danh mục.`);
    } catch (reason) { setError(reason.message || 'Không tạo được order. Kiểm tra món, thực đơn và giá bán.'); }
    finally { setBusy(''); }
  };

  const transition = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      if (action === 'completed') await api(dataPath('restaurant.table_order', order.id), { method: 'PATCH', body: { method } });
      await api(dataPath('restaurant.table_order', order.id, action), { method: 'POST' });
      await load(true);
      const messages = { sent: 'Đã gửi món đến bếp và quầy pha chế.', served: 'Tất cả phiếu đã sẵn sàng; order đã chuyển sang phục vụ.', completed: 'Đã thanh toán; hệ thống ghi nhận xuất kho nguyên liệu và doanh thu.', cancelled: 'Đã hủy order trước khi gửi bếp.' };
      setNotice(messages[action]);
    } catch (reason) { setError(reason.message || 'Không chuyển được trạng thái. Kiểm tra phiếu bếp, kho và phương thức thanh toán.'); await load(true); }
    finally { setBusy(''); }
  };

  return <div className="page-content restaurant-service-page">
    <header className="page-header"><div><h1>Phục vụ nhà hàng</h1><p className="muted">Mở bàn, ghi món, gửi bếp, theo dõi món sẵn sàng và thanh toán.</p></div><button className="button" onClick={() => load()} disabled={loading}>Làm mới</button></header>
    {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="restaurant-service-layout">
      <section className="restaurant-order-create card"><h2>Tạo order</h2><form onSubmit={createOrder}>
        <div className="restaurant-order-tools">
          <label className="field"><span>Bàn</span><select className="select" value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Mang đi / không chọn bàn</option>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name}{table.seats ? ` · ${table.seats} chỗ` : ''}</option>)}</select></label>
          <label className="field"><span>Kho nguyên liệu</span><select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho khi order có hàng tồn</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        </div>
        <div className="restaurant-menu-grid">{availableMenu.map(({ item, product }) => <article className="restaurant-menu-item card" key={item.id}>
          <div><strong>{recordLabel('master-data.product', product)}</strong><span className="small muted">{item.station === 'bar' ? 'Quầy pha chế' : 'Bếp'}</span></div>
          <strong className="num">{fmtMoney(product.price || 0)}</strong>
          <label className="field"><span>Số lượng</span><input className="input" type="number" min="0" step="1" value={quantities[item.id] || ''} onChange={(event) => setQuantity(item.id, event.target.value)} /></label>
        </article>)}</div>
        <div className="restaurant-cart-total"><span>Tạm tính chưa gồm thuế</span><strong className="num">{fmtMoney(indicativeTotal)}</strong></div>
        <button className="button primary" disabled={busy === 'create' || !cart.length}>{busy === 'create' ? 'Đang tạo…' : 'Mở order'}</button>
      </form></section>

      <section className="restaurant-order-list"><header><h2>Orders</h2><span className="badge warning">{orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).length} đang mở</span></header>
        {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="restaurant-orders">{orders.map((order) => {
          const table = tables.find((item) => item.id === order.table);
          return <button className={`card restaurant-order-card${selectedId === order.id ? ' selected' : ''}`} key={order.id} onClick={() => setSelectedId(order.id)}>
            <span className="restaurant-order-card-head"><strong>{table?.name || 'Mang đi'}</strong><span className={`badge ${order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></span>
            <span className="small muted">{fmtDateTime(order.created_at)}</span><strong className="num">{fmtMoney(order.total || 0)}</strong>
          </button>;
        })}{!orders.length && <div className="empty">Chưa có order.</div>}</div>}
      </section>

      <section className="restaurant-order-detail card">{selected ? <>
        <header className="restaurant-order-card-head"><div><h2>{tables.find((table) => table.id === selected.table)?.name || 'Mang đi'}</h2><span className="small muted">{fmtDateTime(selected.created_at)}</span></div><span className="badge warning">{statusLabel(selected.status)}</span></header>
        <ul className="restaurant-detail-lines">{(selected.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{line.product_name || products.get(line.product)?.name || 'Món'} × {line.qty}{Number(line.tax_rate) > 0 && <small className="small muted"> · Thuế {line.tax_rate}%</small>}</span><strong className="num">{fmtMoney(line.line_total ?? (Number(line.price || 0) * Number(line.qty || 0)))}</strong></li>)}</ul>
        {Number(selected.tax_total) > 0 && <div className="restaurant-tax-total"><span>Thuế bán hàng</span><strong className="num">{fmtMoney(selected.tax_total)}</strong></div>}
        <div className="restaurant-cart-total"><span>Tổng đã gồm thuế</span><strong className="num">{fmtMoney(selected.total || 0)}</strong></div>
        {selectedTickets.length > 0 && <div className="restaurant-ticket-status"><h3>Tiến độ bếp</h3>{selectedTickets.map((ticket) => <div key={ticket.id}><span>{ticket.station === 'bar' ? 'Quầy pha chế' : 'Bếp'}</span><strong>{statusLabel(ticket.status)}</strong></div>)}</div>}
        {selected.status === 'open' && can('restaurant.table_order.sent') && <div className="restaurant-actions"><button className="button primary" disabled={!!busy} onClick={() => transition(selected, 'sent')}>Gửi bếp và quầy pha chế</button>{can('restaurant.table_order.cancelled') && <button className="button" disabled={!!busy} onClick={() => transition(selected, 'cancelled')}>Hủy order</button>}</div>}
        {selected.status === 'sent' && can('restaurant.table_order.served') && <div className="restaurant-actions"><button className="button primary" disabled={!!busy || (tickets.length > 0 && !ticketsReady)} onClick={() => transition(selected, 'served')}>Chuyển sang phục vụ</button>{tickets.length > 0 && !ticketsReady && <span className="small muted">Chờ tất cả phiếu bếp / quầy báo món xong.</span>}</div>}
        {selected.status === 'served' && can('restaurant.table_order.completed') && <div className="restaurant-payment"><label className="field"><span>Phương thức thanh toán</span><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button primary" disabled={!!busy || (selectedNeedsWarehouse && !selected.warehouse)} onClick={() => transition(selected, 'completed')}>Thanh toán, xuất kho và đóng order</button>{selectedNeedsWarehouse && !selected.warehouse && <span className="small muted">Order có nguyên liệu theo dõi tồn nhưng chưa gắn kho. Cập nhật order trước khi thanh toán.</span>}</div>}
        {selectedPayment && <a className="button" href={recordHref('accounting.payment', selectedPayment.id)}>Mở phiếu thanh toán {String(selectedPayment.id).slice(0, 8)}</a>}
      </> : <div className="card-pad muted">Chọn order để theo dõi và xử lý.</div>}</section>
    </div>
  </div>;
}
