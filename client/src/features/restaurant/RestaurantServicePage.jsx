import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const METHODS = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử']];

export default function RestaurantServicePage() {
  const [tables, setTables] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [invoices, setInvoices] = useState([]);
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
  const [recipeIngredients, setRecipeIngredients] = useState([{ product: '', qty: '1', uom: '' }]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const canReadTickets = can('restaurant.kitchen_ticket.read');
      const canReadInvoices = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.payment.read');
      const [tableResponse, menuResponse, recipeResponse, orderResponse, productMap, unitMap, warehouseMap, ticketResponse, invoiceResponse] = await Promise.all([
        loadAllResponse('restaurant.table'), loadAllResponse('restaurant.menu_item'),
        can('restaurant.recipe.read') ? loadAllResponse('restaurant.recipe') : Promise.resolve({ items: [] }),
        loadAllResponse('restaurant.table_order'), loadRefs('master-data.product'),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()), loadRefs('inventory.warehouse'),
        canReadTickets ? loadAllResponse('restaurant.kitchen_ticket') : Promise.resolve({ items: [] }),
        canReadInvoices ? loadAllResponse('accounting.payment') : Promise.resolve({ items: [] }),
      ]);
      const nextOrders = itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setTables(itemsOf(tableResponse)); setMenuItems(itemsOf(menuResponse)); setRecipes(itemsOf(recipeResponse)); setOrders(nextOrders); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap); setTickets(itemsOf(ticketResponse)); setInvoices(itemsOf(invoiceResponse));
      setSelectedId((current) => nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu nhà hàng.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Phục vụ nhà hàng · OSP Suite'; load(); const timer = window.setInterval(() => load(true), 15000); return () => window.clearInterval(timer); }, [load]);

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
  const cart = Object.entries(quantities).map(([id, qty]) => ({ ...availableMenu.find(({ item }) => item.id === id), menuItemId: id, qty: Number(qty), note: String(lineNotes[id] || '').trim() })).filter((line) => line.product && line.qty > 0);
  const indicativeTotal = cart.reduce((total, line) => total + (Number(line.product.price) || 0) * line.qty, 0);
  const setQuantity = (id, value) => {
    const qty = Math.max(0, Number(value) || 0);
    setQuantities((current) => { const next = { ...current }; if (qty) next[id] = qty; else delete next[id]; return next; });
    if (!qty) setLineNotes((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const recipeProducts = menuItems.map((item) => products.get(item.product)).filter((product) => product && product.active !== false);
  const ingredientProducts = [...products.values()].filter((product) => product.active !== false && product.kind !== 'service');
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const resetRecipe = () => { setEditingRecipe(''); setRecipeProduct(''); setRecipeOutputQty('1'); setRecipeIngredients([{ product: '', qty: '1', uom: '' }]); };
  const editRecipe = (recipe) => {
    setEditingRecipe(recipe.id); setRecipeProduct(recipe.product || ''); setRecipeOutputQty(String(recipe.output_qty || 1));
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    setRecipeIngredients(ingredients.length ? ingredients.map((item) => ({ product: item.product || '', qty: String(item.qty || ''), uom: item.uom || '' })) : [{ product: '', qty: '1', uom: '' }]);
  };
  const saveRecipe = async (event) => {
    event.preventDefault(); setBusy('recipe'); setError(''); setNotice('');
    try {
      const body = { product: recipeProduct, output_qty: Number(recipeOutputQty), ingredients: recipeIngredients.map((item) => ({ product: item.product, qty: Number(item.qty), ...(item.uom ? { uom: item.uom } : {}) })) };
      await api(editingRecipe ? dataPath('restaurant.recipe', editingRecipe) : dataPath('restaurant.recipe'), { method: editingRecipe ? 'PATCH' : 'POST', body });
      resetRecipe(); await load(true); setNotice('Đã lưu công thức món ăn.');
    } catch (reason) { setError(reason.message || 'Không lưu được công thức.'); }
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
      setNotice(`Đã tạo order ${String(created.id).slice(0, 8)}. Giá món do server lấy từ danh mục.`);
    } catch (reason) { setError(reason.message || 'Không tạo được order. Kiểm tra món, thực đơn và giá bán.'); }
    finally { setBusy(''); }
  };

  const transition = async (order, action) => {
    if (action === 'cancelled' && order.status === 'sent') {
      const reason = cancellationReasons[order.id]?.trim() || '';
      if (!reason || reason.length > 500) {
        setError('Nhập lý do từ 1 đến 500 ký tự trước khi hủy order đã gửi bếp.');
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
      setNotice(messages[action]);
    } catch (reason) { setError(reason.message || 'Không chuyển được trạng thái. Kiểm tra phiếu bếp, kho và phương thức thanh toán.'); await load(true); }
    finally { setBusy(''); }
  };

  return <div className="page-content restaurant-service-page">
    <header className="page-header"><div><h1>Phục vụ nhà hàng</h1><p className="muted">Mở bàn, ghi món, gửi bếp, theo dõi món sẵn sàng và thanh toán.</p></div><button className="button" onClick={() => load()} disabled={loading}>Làm mới</button></header>
    {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('restaurant.recipe.read') && <section className="card restaurant-recipes"><header className="restaurant-order-card-head"><div><h2>Công thức món</h2><p className="small muted">Định lượng nguyên liệu trên một lần nấu; kho trừ theo đơn vị gốc.</p></div>{can('restaurant.recipe.create') && <button className="button" type="button" onClick={resetRecipe}>Công thức mới</button>}</header>
      {(can('restaurant.recipe.create') || can('restaurant.recipe.update')) && <form onSubmit={saveRecipe} className="restaurant-recipe-form">
        <label className="field"><span>Món trong thực đơn *</span><select className="select" required value={recipeProduct} disabled={Boolean(editingRecipe)} onChange={(event) => setRecipeProduct(event.target.value)}><option value="">Chọn món</option>{recipeProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label className="field"><span>Khẩu phần đầu ra *</span><input className="input num" type="number" min="0.000001" step="any" required value={recipeOutputQty} onChange={(event) => setRecipeOutputQty(event.target.value)} /></label>
        <div className="restaurant-recipe-lines"><h3>Nguyên liệu</h3>{recipeIngredients.map((line, index) => { const lineUnits = unitsFor(line.product); return <div className="row wrap" key={index}><select className="select" required aria-label={`Nguyên liệu ${index + 1}`} value={line.product} onChange={(event) => setRecipeIngredients((current) => current.map((item, i) => i === index ? { ...item, product: event.target.value, uom: '' } : item))}><option value="">Chọn nguyên liệu</option>{ingredientProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input className="input num" type="number" min="0.000001" step="any" required aria-label={`Lượng nguyên liệu ${index + 1}`} value={line.qty} onChange={(event) => setRecipeIngredients((current) => current.map((item, i) => i === index ? { ...item, qty: event.target.value } : item))} />{lineUnits.length > 1 && <select className="select" aria-label={`Đơn vị nguyên liệu ${index + 1}`} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => setRecipeIngredients((current) => current.map((item, i) => i === index ? { ...item, uom: event.target.value } : item))}>{lineUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × đơn vị gốc` : ' · đơn vị gốc'}</option>)}</select>}{recipeIngredients.length > 1 && <button className="button" type="button" aria-label={`Xóa nguyên liệu ${index + 1}`} onClick={() => setRecipeIngredients((current) => current.filter((_, i) => i !== index))}>Bỏ</button>}</div>; })}<button className="button" type="button" onClick={() => setRecipeIngredients((current) => [...current, { product: '', qty: '1', uom: '' }])}>Thêm nguyên liệu</button></div>
        <div className="restaurant-actions"><button className="button primary" type="submit" disabled={busy === 'recipe' || !can(editingRecipe ? 'restaurant.recipe.update' : 'restaurant.recipe.create')}>{busy === 'recipe' ? 'Đang lưu…' : editingRecipe ? 'Lưu công thức' : 'Tạo công thức'}</button>{editingRecipe && <button className="button" type="button" onClick={resetRecipe}>Hủy sửa</button>}</div>
      </form>}
      <div className="restaurant-recipe-list">{recipes.map((recipe) => <article className="restaurant-recipe-card" key={recipe.id}><div><strong>{products.get(recipe.product)?.name || recipe.product}</strong><span className="small muted"> {recipe.output_qty || 1} đơn vị đầu ra · {(recipe.ingredients || []).length} nguyên liệu</span><div className="small muted">{(recipe.ingredients || []).map((ingredient) => `${products.get(ingredient.product)?.name || 'Nguyên liệu'} ${ingredient.qty} ${units.get(ingredient.uom)?.name || ''}`).join(' · ')}</div></div>{can('restaurant.recipe.update') && <button className="button" type="button" onClick={() => editRecipe(recipe)}>Sửa</button>}</article>)}{!recipes.length && <p className="small muted">Chưa có công thức nào.</p>}</div>
    </section>}
    <div className="restaurant-service-layout">
      <section className="restaurant-order-create card"><h2>Tạo order</h2><form onSubmit={createOrder}>
        <div className="restaurant-order-tools">
          <label className="field"><span>Bàn</span><select className="select" value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Mang đi / không chọn bàn</option>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name}{table.seats ? ` · ${table.seats} chỗ` : ''}</option>)}</select></label>
          {tableId && <label className="field"><span>Số khách</span><input className="input num" type="number" min="1" step="1" required value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /><span className="small muted">{selectedTable?.seats ? `Tối đa ${selectedTable.seats} chỗ` : 'Bàn chưa đặt sức chứa'}</span></label>}
          <label className="field"><span>Kho nguyên liệu</span><select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho khi order có hàng tồn</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        </div>
        <div className="restaurant-menu-grid">{availableMenu.map(({ item, product }) => <article className="restaurant-menu-item card" key={item.id}>
          <div><strong>{recordLabel('master-data.product', product)}</strong><span className="small muted">{item.station === 'bar' ? 'Quầy pha chế' : 'Bếp'}</span></div>
          <strong className="num">{fmtMoney(product.price || 0)}</strong>
          <label className="field"><span>Số lượng</span><input className="input" type="number" min="0" step="1" value={quantities[item.id] || ''} onChange={(event) => setQuantity(item.id, event.target.value)} /></label>
          {Number(quantities[item.id] || 0) > 0 && <label className="field"><span>Ghi chú cho bếp/quầy</span><textarea className="textarea" rows="2" maxLength="500" placeholder="Ví dụ: không hành, ít đá" value={lineNotes[item.id] || ''} onChange={(event) => setLineNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}
        </article>)}</div>
        <div className="restaurant-cart-total"><span>Tạm tính chưa gồm thuế</span><strong className="num">{fmtMoney(indicativeTotal)}</strong></div>
        {exceedsTableCapacity && <div className="alert warning" role="status">Bàn chỉ có {selectedTable.seats} chỗ; chọn bàn lớn hơn hoặc giảm số khách.</div>}
        <button className="button primary" disabled={busy === 'create' || !cart.length || exceedsTableCapacity}>{busy === 'create' ? 'Đang tạo…' : 'Mở order'}</button>
      </form></section>

      <section className="restaurant-order-list"><header><h2>Orders</h2><span className="badge warning">{orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).length} đang mở</span></header>
        {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="restaurant-orders">{orders.map((order) => {
          const table = tables.find((item) => item.id === order.table);
          return <button className={`card restaurant-order-card${selectedId === order.id ? ' selected' : ''}`} key={order.id} onClick={() => setSelectedId(order.id)}>
            <span className="restaurant-order-card-head"><strong>{table?.name || 'Mang đi'}</strong><span className={`badge ${order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></span>
            <span className="small muted">{fmtDateTime(order.created_at)}{order.table ? ` · ${order.guest_count || 1} khách` : ''}</span><strong className="num">{fmtMoney(order.total || 0)}</strong>
          </button>;
        })}{!orders.length && <div className="empty">Chưa có order.</div>}</div>}
      </section>

      <section className="restaurant-order-detail card">{selected ? <>
      <header className="restaurant-order-card-head"><div><h2>{tables.find((table) => table.id === selected.table)?.name || 'Mang đi'}</h2><span className="small muted">{fmtDateTime(selected.created_at)}{selected.table ? ` · ${selected.guest_count || 1} khách` : ''}</span></div><span className={`badge ${selected.status === 'completed' ? 'success' : selected.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(selected.status)}</span></header>
        {selected.cancellation_reason && <div className="small muted">Lý do hủy: {selected.cancellation_reason}</div>}
        <ul className="restaurant-detail-lines">{(selected.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{line.product_name || products.get(line.product)?.name || 'Món'} × {line.qty}{Number(line.tax_rate) > 0 && <small className="small muted"> · Thuế {line.tax_rate}%</small>}{line.note && <small className="small muted"> · Ghi chú: {line.note}</small>}</span><strong className="num">{fmtMoney(line.line_total ?? (Number(line.price || 0) * Number(line.qty || 0)))}</strong></li>)}</ul>
        {Number(selected.tax_total) > 0 && <div className="restaurant-tax-total"><span>Thuế bán hàng</span><strong className="num">{fmtMoney(selected.tax_total)}</strong></div>}
        <div className="restaurant-cart-total"><span>Tổng đã gồm thuế</span><strong className="num">{fmtMoney(selected.total || 0)}</strong></div>
        {selectedTickets.length > 0 && <div className="restaurant-ticket-status"><h3>Tiến độ bếp</h3>{selectedTickets.map((ticket) => <div key={ticket.id}><span>{ticket.station === 'bar' ? 'Quầy pha chế' : 'Bếp'}</span><strong>{statusLabel(ticket.status)}</strong></div>)}</div>}
        {selected.status === 'open' && can('restaurant.table_order.sent') && <div className="restaurant-actions"><button className="button primary" disabled={!!busy} onClick={() => transition(selected, 'sent')}>Gửi bếp và quầy pha chế</button>{can('restaurant.table_order.cancelled') && <button className="button" disabled={!!busy} onClick={() => transition(selected, 'cancelled')}>Hủy order</button>}</div>}
        {selected.status === 'sent' && <div className="restaurant-actions">{can('restaurant.table_order.served') && <><button className="button primary" disabled={!!busy || (tickets.length > 0 && !ticketsReady)} onClick={() => transition(selected, 'served')}>Chuyển sang phục vụ</button>{tickets.length > 0 && !ticketsReady && <span className="small muted">Chờ tất cả phiếu bếp / quầy báo món xong.</span>}</>}{can('restaurant.table_order.cancelled') && can('restaurant.table_order.update') && <><label className="field"><span>Lý do hủy (chỉ hủy được khi các trạm chưa bắt đầu)</span><input className="input" maxLength="500" value={cancellationReasons[selected.id] || ''} onChange={(event) => setCancellationReasons((current) => ({ ...current, [selected.id]: event.target.value }))} /></label><button className="button" disabled={!!busy || !cancellationReasons[selected.id]?.trim()} onClick={() => transition(selected, 'cancelled')}>Hủy order đã gửi</button></>}</div>}
        {selected.status === 'served' && can('restaurant.table_order.completed') && can('restaurant.table_order.update') && <div className="restaurant-payment"><label className="field"><span>Phương thức thanh toán</span><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button primary" disabled={!!busy || (selectedNeedsWarehouse && !selected.warehouse)} onClick={() => transition(selected, 'completed')}>Thanh toán, xuất kho và đóng order</button>{selectedNeedsWarehouse && !selected.warehouse && <span className="small muted">Order có nguyên liệu theo dõi tồn nhưng chưa gắn kho. Cập nhật order trước khi thanh toán.</span>}</div>}
        {selectedPayment && <a className="button" href={recordHref('accounting.payment', selectedPayment.id)}>Mở phiếu thanh toán {String(selectedPayment.id).slice(0, 8)}</a>}
      </> : <div className="card-pad muted">Chọn order để theo dõi và xử lý.</div>}</section>
    </div>
  </div>;
}
