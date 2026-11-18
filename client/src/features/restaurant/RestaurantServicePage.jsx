import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse, loadIndependentData } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { compareDecimals } from '../../lib/decimal.js';
import restaurantEnglish from './restaurant.en.js';
import RestaurantRecipesPanel from './components/RestaurantRecipesPanel.jsx';
import RestaurantReservationsPanel from './components/RestaurantReservationsPanel.jsx';
import { estimateRestaurantSubtotal, restaurantLineTotal } from './domain/restaurantTotals.js';
const t = (text) => uiTextWith(text, restaurantEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const blankRecipeIngredient = () => ({ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' });
const isPositiveQuantity = (value) => { try { return compareDecimals(value || 0, '0') > 0; } catch { return false; } };
const METHODS = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử']];
const reservationStart = () => businessDateTime(new Date(Date.now() + 60 * 60 * 1000));
export default function RestaurantServicePage() {
  useDocumentTitle(`${t('Phục vụ nhà hàng')} · OSP Suite`);
  const [tables, setTables] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [quantities, setQuantities] = useState({});
  const [lineNotes, setLineNotes] = useState({});
  const [tableId, setTableId] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [warehouseId, setWarehouseId] = useState('');
  const [method, setMethod] = useState('cash');
  const [cancellationReasons, setCancellationReasons] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingRecipe, setEditingRecipe] = useState('');
  const [recipeProduct, setRecipeProduct] = useState('');
  const [recipeOutputQty, setRecipeOutputQty] = useState('1');
  const [recipeIngredients, setRecipeIngredients] = useState(() => [blankRecipeIngredient()]);
  const [reservationForm, setReservationForm] = useState({ guest_name: '', phone: '', table: '', guest_count: '2', starts_at: reservationStart(), ends_at: businessDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000)), note: '' });
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const canReadTickets = can('restaurant.kitchen_ticket.read');
      const canReadInvoices = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.payment.read');
      const canReadReservations = can('restaurant.reservation.read');
      const { data, errors } = await loadIndependentData({
        tables: can('restaurant.table.read') ? loadAllResponse('restaurant.table') : Promise.resolve({ items: [] }),
        menu: can('restaurant.menu_item.read') ? loadAllResponse('restaurant.menu_item') : Promise.resolve({ items: [] }),
        recipes: can('restaurant.recipe.read') ? loadAllResponse('restaurant.recipe') : Promise.resolve({ items: [] }),
        orders: can('restaurant.table_order.read') ? loadAllResponse('restaurant.table_order') : Promise.resolve({ items: [] }),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        tickets: canReadTickets ? loadAllResponse('restaurant.kitchen_ticket') : Promise.resolve({ items: [] }),
        payments: canReadInvoices ? loadAllResponse('accounting.payment') : Promise.resolve({ items: [] }),
        reservations: canReadReservations ? loadAllResponse('restaurant.reservation') : Promise.resolve({ items: [] }),
      }, {
        tables: { items: [] }, menu: { items: [] }, recipes: { items: [] }, orders: { items: [] },
        products: new Map(), units: new Map(), warehouses: new Map(), tickets: { items: [] },
        payments: { items: [] }, reservations: { items: [] },
      });
      const { tables: tableResponse, menu: menuResponse, recipes: recipeResponse, orders: orderResponse,
        products: productMap, units: unitMap, warehouses: warehouseMap, tickets: ticketResponse,
        payments: invoiceResponse, reservations: reservationResponse } = data;
      const nextOrders = itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      if (isLatest()) {
        setTables(itemsOf(tableResponse)); setMenuItems(itemsOf(menuResponse)); setRecipes(itemsOf(recipeResponse)); setOrders(nextOrders); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap); setTickets(itemsOf(ticketResponse)); setInvoices(itemsOf(invoiceResponse)); setReservations(itemsOf(reservationResponse).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || ''))));
        setSelectedId((current) => nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id || '');
        if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu nhà hàng.')).join(' · '));
      }
    } catch (reason) { if (isLatest()) setError(reason.message || t('Không tải được dữ liệu nhà hàng.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [latestRequest]);
  useEffect(() => { load(); const timer = window.setInterval(() => load(true), 15000); return () => window.clearInterval(timer); }, [load]);
  const occupiedTableIds = useMemo(() => new Set(orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).map((order) => order.table).filter(Boolean)), [orders]);
  const availableTables = tables.filter((table) => !occupiedTableIds.has(table.id));
  const selectedTable = tables.find((table) => table.id === tableId);
  const exceedsTableCapacity = Boolean(tableId && selectedTable?.seats && Number(guestCount) > Number(selectedTable.seats));
  const availableMenu = menuItems.filter((item) => item.available !== false).map((item) => ({ item, product: products.get(item.product) })).filter(({ product }) => product && product.active !== false).sort((a, b) => String(a.product.name).localeCompare(String(b.product.name), 'vi'));
  const selected = orders.find((order) => order.id === selectedId) || null;
  const selectedPayment = selected && invoices.find((payment) => payment.source === 'table_order' && payment.source_id === selected.id);
  const selectedNeedsWarehouse = Boolean(selected?.consumptions?.length);
  const selectedTickets = tickets.filter((ticket) => ticket.order === selectedId);
  const ticketsReady = selectedTickets.length > 0 && selectedTickets.every((ticket) => ticket.status === 'ready');
  const cart = Object.entries(quantities).map(([id, qty]) => ({ ...availableMenu.find(({ item }) => item.id === id), menuItemId: id, qty: String(qty ?? ''), note: String(lineNotes[id] || '').trim() })).filter((line) => line.product && isPositiveQuantity(line.qty));
  const indicativeTotal = estimateRestaurantSubtotal(cart);
  const setQuantity = (id, value) => {
    if (value === '' || value == null) {
      setQuantities((current) => ({ ...current, [id]: '' }));
      return;
    }
    let positive;
    try { positive = compareDecimals(value, '0') > 0; } catch { positive = false; }
    setQuantities((current) => {
      const next = { ...current };
      if (positive) next[id] = String(value); else delete next[id];
      return next;
    });
    if (!positive) setLineNotes((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const recipeProducts = menuItems.map((item) => products.get(item.product)).filter((product) => product && product.active !== false);
  const ingredientProducts = [...products.values()].filter((product) => product.active !== false && product.kind !== 'service');
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const resetRecipe = () => { setEditingRecipe(''); setRecipeProduct(''); setRecipeOutputQty('1'); setRecipeIngredients([blankRecipeIngredient()]); };
  const editRecipe = (recipe) => {
    setEditingRecipe(recipe.id); setRecipeProduct(recipe.product || ''); setRecipeOutputQty(String(recipe.output_qty || 1));
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    setRecipeIngredients(ingredients.length ? ingredients.map((item) => ({ ...blankRecipeIngredient(), product: item.product || '', qty: String(item.qty || ''), uom: item.uom || '' })) : [blankRecipeIngredient()]);
  };
  const saveRecipe = async (event) => {
    event.preventDefault(); setBusy('recipe'); setError(''); setNotice('');
    try {
      const body = { product: recipeProduct, output_qty: String(recipeOutputQty), ingredients: recipeIngredients.map((item) => ({ product: item.product, qty: String(item.qty), ...(item.uom ? { uom: item.uom } : {}) })) };
      await api(editingRecipe ? dataPath('restaurant.recipe', editingRecipe) : dataPath('restaurant.recipe'), { method: editingRecipe ? 'PATCH' : 'POST', body });
      resetRecipe(); await load(true); setNotice(t('Đã lưu công thức món ăn.'));
    } catch (reason) { setError(reason.message || t('Không lưu được công thức.')); }
    finally { setBusy(''); }
  };
  const createOrder = async (event) => {
    event.preventDefault(); if (!cart.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('restaurant.table_order'), { method: 'POST', body: {
        table: tableId || undefined, warehouse: warehouseId || undefined,
        ...(tableId ? { guest_count: Number(guestCount) } : {}),
        lines: cart.map(({ product, qty, note }) => ({ product: product.id, qty, ...(note ? { note } : {}) })),
      } });
      setQuantities({}); setLineNotes({}); setTableId(''); setGuestCount('1'); await load(true); setSelectedId(created.id);
      setNotice(`${t('Đã tạo order')} ${String(created.id).slice(0, 8)}${t('. Giá món do server lấy từ danh mục.')}`);
    } catch (reason) { setError(reason.message || t('Không tạo được order. Kiểm tra món, thực đơn và giá bán.')); }
    finally { setBusy(''); }
  };
  const createReservation = async (event) => {
    event.preventDefault(); setBusy('reservation:create'); setError(''); setNotice('');
    try {
      await api(dataPath('restaurant.reservation'), { method: 'POST', body: {
        guest_name: reservationForm.guest_name.trim(), phone: reservationForm.phone.trim() || undefined,
        table: reservationForm.table || undefined, guest_count: Number(reservationForm.guest_count),
        starts_at: localDateTimeToIso(reservationForm.starts_at), ends_at: localDateTimeToIso(reservationForm.ends_at),
        note: reservationForm.note.trim() || undefined,
      } });
      setReservationForm({ guest_name: '', phone: '', table: '', guest_count: '2', starts_at: reservationStart(), ends_at: businessDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000)), note: '' });
      await load(true); setNotice(t('Đã ghi nhận yêu cầu đặt bàn. Xác nhận để giữ bàn trong khung giờ đã chọn.'));
    } catch (reason) { setError(reason.message || t('Không tạo được yêu cầu đặt bàn. Kiểm tra sức chứa và thời gian.')); }
    finally { setBusy(''); }
  };
  const transitionReservation = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('restaurant.reservation', reservation.id, action), { method: 'POST' });
      await load(true); setNotice(t({ confirmed: 'Đã xác nhận đặt bàn.', arrived: 'Đã ghi nhận khách đến.', cancelled: 'Đã hủy đặt bàn.', no_show: 'Đã ghi nhận khách vắng mặt.', completed: 'Đã hoàn tất lượt đặt bàn.' }[action]));
    } catch (reason) { setError(reason.message || t('Không cập nhật được trạng thái đặt bàn.')); await load(true); }
    finally { setBusy(''); }
  };
  const assignReservationTable = async (reservation, table) => {
    if (!table) return;
    setBusy(`${reservation.id}:table`); setError(''); setNotice('');
    try {
      await api(dataPath('restaurant.reservation', reservation.id), { method: 'PATCH', body: { table } });
      await load(true); setNotice(t('Đã gán bàn cho yêu cầu đặt trước.'));
    } catch (reason) { setError(reason.message || t('Không gán được bàn. Kiểm tra sức chứa và lịch đặt trùng.')); await load(true); }
    finally { setBusy(''); }
  };
  const transition = async (order, action) => {
    if (action === 'cancelled' && order.status === 'sent') {
      const reason = cancellationReasons[order.id]?.trim() || '';
      if (!reason || reason.length > 500) {
        setError(t('Nhập lý do từ 1 đến 500 ký tự trước khi hủy order đã gửi bếp.'));
        return;
      }
    }
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      const body = {};
      if (action === 'completed') body.method = method;
      if (action === 'cancelled' && order.status === 'sent') body.cancellation_reason = cancellationReasons[order.id].trim();
      await api(dataPath('restaurant.table_order', order.id, action), { method: 'POST', ...(Object.keys(body).length ? { body } : {}) });
      if (action === 'cancelled') setCancellationReasons((current) => { const next = { ...current }; delete next[order.id]; return next; });
      await load(true);
      const messages = { sent: 'Đã gửi món đến bếp và quầy pha chế.', served: 'Tất cả phiếu đã sẵn sàng; order đã chuyển sang phục vụ.', completed: 'Đã thanh toán; hệ thống ghi nhận xuất kho nguyên liệu và doanh thu.', cancelled: order.status === 'sent' ? 'Đã hủy order và các phiếu còn chờ bếp; lý do được lưu vào lịch sử.' : 'Đã hủy order trước khi gửi bếp.' };
      setNotice(t(messages[action]));
    } catch (reason) { setError(reason.message || t('Không chuyển được trạng thái. Kiểm tra phiếu bếp, kho và phương thức thanh toán.')); await load(true); }
    finally { setBusy(''); }
  };
  return <div className="page restaurant-service-page">
    <header className="page-head"><div><h1>{t('Phục vụ nhà hàng')}</h1><p className="muted">{t('Mở bàn, ghi món, gửi bếp, theo dõi món sẵn sàng và thanh toán.')}</p></div><button className="btn" onClick={() => load()} disabled={loading}>{t('Làm mới')}</button></header>
    {error && <div className="alert error" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <RestaurantRecipesPanel
      recipes={recipes} products={products} units={units} productOptions={recipeProducts}
      ingredientProducts={ingredientProducts} unitsFor={unitsFor}
      editingId={editingRecipe} productId={recipeProduct} outputQty={recipeOutputQty}
      ingredients={recipeIngredients} busy={busy}
      canRead={can('restaurant.recipe.read')} canCreate={can('restaurant.recipe.create')} canUpdate={can('restaurant.recipe.update')}
      onSubmit={saveRecipe} onReset={resetRecipe} onProductChange={setRecipeProduct}
      onOutputQtyChange={setRecipeOutputQty}
      onIngredientChange={(index, field, value) => setRecipeIngredients((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : item))}
      onAddIngredient={() => setRecipeIngredients((current) => [...current, blankRecipeIngredient()])}
      onRemoveIngredient={(index) => setRecipeIngredients((current) => current.filter((_, rowIndex) => rowIndex !== index))}
      onEdit={editRecipe} t={t}
    />
    <RestaurantReservationsPanel
      reservations={reservations} tables={tables} form={reservationForm} busy={busy}
      permissions={{
        read: can('restaurant.reservation.read'), create: can('restaurant.reservation.create'),
        update: can('restaurant.reservation.update'), confirm: can('restaurant.reservation.confirmed'),
        arrived: can('restaurant.reservation.arrived'), cancel: can('restaurant.reservation.cancelled'),
        noShow: can('restaurant.reservation.no_show'), complete: can('restaurant.reservation.completed'),
      }}
      onFormChange={(field, value) => setReservationForm((current) => ({ ...current, [field]: value }))}
      onCreate={createReservation} onAssignTable={assignReservationTable} onTransition={transitionReservation}
      formatDateTime={fmtDateTime} statusLabel={statusLabel} t={t}
    />
    <div className="restaurant-service-layout">
      <section className="restaurant-order-create card"><h2>{t('Tạo order')}</h2><form onSubmit={createOrder}>
        <div className="restaurant-order-tools">
          <label className="field"><span>{t('Bàn')}</span><select className="select" value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">{t('Mang đi / không chọn bàn')}</option>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name}{table.seats ? ` · ${table.seats} ${t('chỗ')}` : ''}</option>)}</select></label>
          {tableId && <label className="field"><span>{t('Số khách')}</span><input className="input num" type="number" min="1" step="1" required value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /><span className="small muted">{selectedTable?.seats ? `${t('Tối đa')} ${selectedTable.seats} ${t('chỗ')}` : t('Bàn chưa đặt sức chứa')}</span></label>}
          <label className="field"><span>{t('Kho nguyên liệu')}</span><select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{t('Chọn kho khi order có hàng tồn')}</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        </div>
        <div className="restaurant-menu-grid">{availableMenu.map(({ item, product }) => <article className="restaurant-menu-item card" key={item.id}>
          <div><strong>{recordLabel('master-data.product', product)}</strong><span className="small muted">{t(item.station === 'bar' ? 'Quầy pha chế' : 'Bếp')}</span></div>
          <strong className="num">{fmtMoney(product.price || 0)}</strong>
          <label className="field"><span>{t('Số lượng')}</span><input className="input" type="number" min="0" step="1" value={quantities[item.id] || ''} onChange={(event) => setQuantity(item.id, event.target.value)} /></label>
          {isPositiveQuantity(quantities[item.id]) && <label className="field"><span>{t('Ghi chú cho bếp/quầy')}</span><textarea className="textarea" rows="2" maxLength="500" placeholder={t('Ví dụ: không hành, ít đá')} value={lineNotes[item.id] || ''} onChange={(event) => setLineNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}
        </article>)}</div>
        <div className="restaurant-cart-total"><span>{t('Tạm tính chưa gồm thuế')}</span><strong className="num">{fmtMoney(indicativeTotal)}</strong></div>
        {exceedsTableCapacity && <div className="alert warning" role="status">{t('Bàn chỉ có')} {selectedTable.seats} {t('chỗ; chọn bàn lớn hơn hoặc giảm số khách.')}</div>}
        <button className="btn btn-primary" disabled={busy === 'create' || !cart.length || exceedsTableCapacity}>{busy === 'create' ? t('Đang tạo…') : t('Mở order')}</button>
      </form></section>
      <section className="restaurant-order-list"><header><h2>{t('Orders')}</h2><span className="badge warning">{orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).length} {t('đang mở')}</span></header>
        {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="restaurant-orders">{orders.map((order) => {
          const table = tables.find((item) => item.id === order.table);
          return <button className={`card restaurant-order-card${selectedId === order.id ? ' selected' : ''}`} key={order.id} onClick={() => setSelectedId(order.id)}>
            <span className="restaurant-order-card-head"><strong>{table?.name || t('Mang đi')}</strong><span className={`badge ${order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></span>
            <span className="small muted">{fmtDateTime(order.created_at)}{order.table ? ` · ${order.guest_count || 1} ${t('khách')}` : ''}</span><strong className="num">{fmtMoney(order.total || 0)}</strong>
          </button>;
        })}{!orders.length && <div className="empty">{t('Chưa có order.')}</div>}</div>}
      </section>
      <section className="restaurant-order-detail card">{selected ? <>
      <header className="restaurant-order-card-head"><div><h2>{tables.find((table) => table.id === selected.table)?.name || t('Mang đi')}</h2><span className="small muted">{fmtDateTime(selected.created_at)}{selected.table ? ` · ${selected.guest_count || 1} ${t('khách')}` : ''}</span></div><span className={`badge ${selected.status === 'completed' ? 'success' : selected.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(selected.status)}</span></header>
        {selected.cancellation_reason && <div className="small muted">{t('Lý do hủy:')} {selected.cancellation_reason}</div>}
        <ul className="restaurant-detail-lines">{(selected.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{line.product_name || products.get(line.product)?.name || t('Món')} × {line.qty}{Number(line.tax_rate) > 0 && <small className="small muted"> · {t('Thuế')} {line.tax_rate}%</small>}{line.note && <small className="small muted"> · {t('Ghi chú:')} {line.note}</small>}</span><strong className="num">{fmtMoney(restaurantLineTotal(line))}</strong></li>)}</ul>
        {Number(selected.tax_total) > 0 && <div className="restaurant-tax-total"><span>{t('Thuế bán hàng')}</span><strong className="num">{fmtMoney(selected.tax_total)}</strong></div>}
        <div className="restaurant-cart-total"><span>{t('Tổng đã gồm thuế')}</span><strong className="num">{fmtMoney(selected.total || 0)}</strong></div>
        {selectedTickets.length > 0 && <div className="restaurant-ticket-status"><h3>{t('Tiến độ bếp')}</h3>{selectedTickets.map((ticket) => <div key={ticket.id}><span>{t(ticket.station === 'bar' ? 'Quầy pha chế' : 'Bếp')}</span><strong>{statusLabel(ticket.status)}</strong></div>)}</div>}
        {selected.status === 'open' && can('restaurant.table_order.sent') && <div className="restaurant-actions"><button className="btn btn-primary" disabled={!!busy} onClick={() => transition(selected, 'sent')}>{t('Gửi bếp và quầy pha chế')}</button>{can('restaurant.table_order.cancelled') && <button className="btn" disabled={!!busy} onClick={() => transition(selected, 'cancelled')}>{t('Hủy order')}</button>}</div>}
        {selected.status === 'sent' && <div className="restaurant-actions">{can('restaurant.table_order.served') && <><button className="btn btn-primary" disabled={!!busy || (tickets.length > 0 && !ticketsReady)} onClick={() => transition(selected, 'served')}>{t('Chuyển sang phục vụ')}</button>{tickets.length > 0 && !ticketsReady && <span className="small muted">{t('Chờ tất cả phiếu bếp / quầy báo món xong.')}</span>}</>}{can('restaurant.table_order.cancelled') && can('restaurant.table_order.update') && <><label className="field"><span>{t('Lý do hủy (chỉ hủy được khi các trạm chưa bắt đầu)')}</span><input className="input" maxLength="500" value={cancellationReasons[selected.id] || ''} onChange={(event) => setCancellationReasons((current) => ({ ...current, [selected.id]: event.target.value }))} /></label><button className="btn" disabled={!!busy || !cancellationReasons[selected.id]?.trim()} onClick={() => transition(selected, 'cancelled')}>{t('Hủy order đã gửi')}</button></>}</div>}
        {selected.status === 'served' && can('restaurant.table_order.completed') && can('restaurant.table_order.update') && <div className="restaurant-payment"><label className="field"><span>{t('Phương thức thanh toán')}</span><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>{METHODS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><button className="btn btn-primary" disabled={!!busy || (selectedNeedsWarehouse && !selected.warehouse)} onClick={() => transition(selected, 'completed')}>{t('Thanh toán, xuất kho và đóng order')}</button>{selectedNeedsWarehouse && !selected.warehouse && <span className="small muted">{t('Order có nguyên liệu theo dõi tồn nhưng chưa gắn kho. Cập nhật order trước khi thanh toán.')}</span>}</div>}
        {selectedPayment && <a className="btn" href={recordHref('accounting.payment', selectedPayment.id)}>{t('Mở phiếu thanh toán')} {String(selectedPayment.id).slice(0, 8)}</a>}
      </> : <div className="card-pad muted">{t('Chọn order để theo dõi và xử lý.')}</div>}</section>
    </div>
  </div>;
}
