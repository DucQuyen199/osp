import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
import restaurantEnglish from './restaurant.en.js';
import RestaurantRecipesPanel from './components/RestaurantRecipesPanel.jsx';
import RestaurantReservationsPanel from './components/RestaurantReservationsPanel.jsx';
import RestaurantOrderDetailPanel from './components/RestaurantOrderDetailPanel.jsx';
import RestaurantOrderList from './components/RestaurantOrderList.jsx';
import { estimateRestaurantSubtotal, restaurantLineTotal } from './domain/restaurantTotals.js';
import { useRestaurantServiceData } from './hooks/useRestaurantServiceData.js';
import { useRestaurantServiceWorkflow } from './hooks/useRestaurantServiceWorkflow.js';
const t = (text) => uiTextWith(text, restaurantEnglish);
const blankRecipeIngredient = () => ({ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' });
const isPositiveQuantity = (value) => { try { return compareDecimals(value || 0, '0') > 0; } catch { return false; } };
const METHODS = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử']];
export default function RestaurantServicePage() {
  useDocumentTitle(`${t('Phục vụ nhà hàng')} · OSP Suite`);
  const [selectedId, setSelectedId] = useState('');
  const {
    tables, menuItems, recipes, orders, tickets, payments: invoices, reservations,
    products, units, warehouses, loading, error, setError, load,
  } = useRestaurantServiceData();
  useEffect(() => {
    setSelectedId((current) => orders.some((order) => order.id === current) ? current : orders[0]?.id || '');
  }, [orders]);
  const {
    quantities, setQuantities, lineNotes, setLineNotes, tableId, setTableId, guestCount, setGuestCount,
    warehouseId, setWarehouseId, method, setMethod, cancellationReasons, setCancellationReasons,
    busy, error: workflowError, notice, editingRecipe, recipeProduct, setRecipeProduct,
    recipeOutputQty, setRecipeOutputQty, recipeIngredients, setRecipeIngredients, reservationForm,
    setReservationForm, setQuantity, resetRecipe, editRecipe, saveRecipe, createOrder,
    createReservation, transitionReservation, assignReservationTable, transition,
  } = useRestaurantServiceWorkflow({ load, setSelectedId, t });
  const occupiedTableIds = useMemo(() => new Set(orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).map((order) => order.table).filter(Boolean)), [orders]);
  const now = Date.now();
  const reservedTableIds = new Set(reservations.filter((reservation) => reservation.status === 'confirmed'
    && Number.isFinite(Date.parse(reservation.starts_at)) && Date.parse(reservation.starts_at) <= now
    && Number.isFinite(Date.parse(reservation.ends_at)) && Date.parse(reservation.ends_at) > now)
    .map((reservation) => reservation.table).filter(Boolean));
  const availableTables = tables.filter((table) => !occupiedTableIds.has(table.id) && !reservedTableIds.has(table.id));
  const selectedTable = tables.find((table) => table.id === tableId);
  const exceedsTableCapacity = Boolean(tableId && selectedTable?.seats && Number(guestCount) > Number(selectedTable.seats));
  const selectedTableReserved = Boolean(tableId && reservedTableIds.has(tableId));
  const selectedTableOccupied = Boolean(tableId && occupiedTableIds.has(tableId));
  const availableMenu = menuItems.filter((item) => item.available !== false).map((item) => ({ item, product: products.get(item.product) })).filter(({ product }) => product && product.active !== false).sort((a, b) => String(a.product.name).localeCompare(String(b.product.name), 'vi'));
  const selected = orders.find((order) => order.id === selectedId) || null;
  const openOrderCount = orders.filter((order) => ['open', 'sent', 'served'].includes(order.status)).length;
  const orderListItems = orders.map((order) => ({
    id: order.id,
    tableLabel: tables.find((table) => table.id === order.table)?.name || '',
    statusLabel: statusLabel(order.status),
    statusTone: order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning',
    dateLabel: fmtDateTime(order.created_at),
    guestLabel: order.table ? `${order.guest_count || 1} ${t('khách')}` : '',
    totalLabel: fmtMoney(order.total || 0),
  }));
  const selectedPayment = selected && invoices.find((payment) => payment.source === 'table_order' && payment.source_id === selected.id);
  const selectedNeedsWarehouse = Boolean(selected?.consumptions?.length);
  const selectedTickets = tickets.filter((ticket) => ticket.order === selectedId);
  const ticketsReady = selectedTickets.length > 0 && selectedTickets.every((ticket) => ticket.status === 'ready');
  const cart = Object.entries(quantities).map(([id, qty]) => ({ ...availableMenu.find(({ item }) => item.id === id), menuItemId: id, qty: String(qty ?? ''), note: String(lineNotes[id] || '').trim() })).filter((line) => line.product && isPositiveQuantity(line.qty));
  const indicativeTotal = estimateRestaurantSubtotal(cart);
  const recipeProducts = menuItems.map((item) => products.get(item.product)).filter((product) => product && product.active !== false);
  const ingredientProducts = [...products.values()].filter((product) => product.active !== false && product.kind !== 'service');
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  return <div className="page restaurant-service-page">
    <header className="page-head"><div><h1>{t('Phục vụ nhà hàng')}</h1><p className="muted">{t('Mở bàn, ghi món, gửi bếp, theo dõi món sẵn sàng và thanh toán.')}</p></div><button className="btn" onClick={() => load()} disabled={loading}>{t('Làm mới')}</button></header>
    {(workflowError || error) && <div className="alert error" role="alert">{t(workflowError || error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
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
      <section className="restaurant-order-create card"><h2>{t('Tạo order')}</h2><form onSubmit={(event) => createOrder(event, cart)}>
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
        {selectedTableReserved && <div className="alert warning" role="status">{t('Bàn đang được giữ cho khách đặt trước; hãy ghi nhận khách đến trước khi mở order')}</div>}
        {selectedTableOccupied && <div className="alert warning" role="status">{t('Bàn đang có order chưa thanh toán; hãy đóng order trước khi mở order mới.')}</div>}
        <button className="btn btn-primary" disabled={busy === 'create' || !cart.length || exceedsTableCapacity || selectedTableReserved || selectedTableOccupied}>{busy === 'create' ? t('Đang tạo…') : t('Mở order')}</button>
      </form></section>
      <RestaurantOrderList loading={loading} orders={orderListItems} openCount={openOrderCount} selectedId={selectedId} onSelect={setSelectedId} t={t} />
      <RestaurantOrderDetailPanel
        selected={selected}
        tableName={tables.find((table) => table.id === selected?.table)?.name}
        products={products}
        selectedTickets={selectedTickets}
        selectedPayment={selectedPayment}
        selectedNeedsWarehouse={selectedNeedsWarehouse}
        hasUnreadyTickets={tickets.length > 0 && !ticketsReady}
        busy={busy}
        method={method}
        cancellationReason={cancellationReasons[selected?.id] || ''}
        canSend={can('restaurant.table_order.sent')}
        canCancel={can('restaurant.table_order.cancelled')}
        canServe={can('restaurant.table_order.served')}
        canCancelSent={can('restaurant.table_order.cancelled') && can('restaurant.table_order.update')}
        canComplete={can('restaurant.table_order.completed') && can('restaurant.table_order.update')}
        onTransition={transition}
        onMethodChange={setMethod}
        onCancellationReasonChange={(value) => setCancellationReasons((current) => ({ ...current, [selected.id]: value }))}
        methods={METHODS}
        lineTotal={restaurantLineTotal}
        t={t}
      />
    </div>
  </div>;
}
