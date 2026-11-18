import { useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';

const blankRecipeIngredient = () => ({ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' });
const reservationStart = () => businessDateTime(new Date(Date.now() + 60 * 60 * 1000));

export function useRestaurantServiceWorkflow({ load, setSelectedId, t }) {
  const [quantities, setQuantities] = useState({});
  const [lineNotes, setLineNotes] = useState({});
  const [tableId, setTableId] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [warehouseId, setWarehouseId] = useState('');
  const [method, setMethod] = useState('cash');
  const [cancellationReasons, setCancellationReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingRecipe, setEditingRecipe] = useState('');
  const [recipeProduct, setRecipeProduct] = useState('');
  const [recipeOutputQty, setRecipeOutputQty] = useState('1');
  const [recipeIngredients, setRecipeIngredients] = useState(() => [blankRecipeIngredient()]);
  const [reservationForm, setReservationForm] = useState({ guest_name: '', phone: '', table: '', guest_count: '2', starts_at: reservationStart(), ends_at: businessDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000)), note: '' });

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
  const resetRecipe = () => { setEditingRecipe(''); setRecipeProduct(''); setRecipeOutputQty('1'); setRecipeIngredients([blankRecipeIngredient()]); };
  const editRecipe = (recipe) => {
    setEditingRecipe(recipe.id); setRecipeProduct(recipe.product || ''); setRecipeOutputQty(String(recipe.output_qty || 1));
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    setRecipeIngredients(ingredients.length ? ingredients.map((item) => ({ ...blankRecipeIngredient(), product: item.product || '', qty: String(item.qty || ''), uom: item.uom || '' })) : [blankRecipeIngredient()]);
  };

  async function saveRecipe(event) {
    event.preventDefault(); setBusy('recipe'); setError(''); setNotice('');
    try {
      const body = { product: recipeProduct, output_qty: String(recipeOutputQty), ingredients: recipeIngredients.map((item) => ({ product: item.product, qty: String(item.qty), ...(item.uom ? { uom: item.uom } : {}) })) };
      await api(dataPath('restaurant.recipe', ...(editingRecipe ? [editingRecipe] : [])), { method: editingRecipe ? 'PATCH' : 'POST', body });
      resetRecipe(); await load(true); setNotice(t('Đã lưu công thức món ăn.'));
    } catch (reason) { setError(reason.message || t('Không lưu được công thức.')); }
    finally { setBusy(''); }
  }

  async function createOrder(event, cart) {
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
  }

  async function createReservation(event) {
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
  }

  async function transitionReservation(reservation, action) {
    setBusy(`${reservation.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('restaurant.reservation', reservation.id, action), { method: 'POST' });
      await load(true); setNotice(t({ confirmed: 'Đã xác nhận đặt bàn.', arrived: 'Đã ghi nhận khách đến.', cancelled: 'Đã hủy đặt bàn.', no_show: 'Đã ghi nhận khách vắng mặt.', completed: 'Đã hoàn tất lượt đặt bàn.' }[action]));
    } catch (reason) { setError(reason.message || t('Không cập nhật được trạng thái đặt bàn.')); await load(true); }
    finally { setBusy(''); }
  }

  async function assignReservationTable(reservation, table) {
    if (!table) return;
    setBusy(`${reservation.id}:table`); setError(''); setNotice('');
    try {
      await api(dataPath('restaurant.reservation', reservation.id), { method: 'PATCH', body: { table } });
      await load(true); setNotice(t('Đã gán bàn cho yêu cầu đặt trước.'));
    } catch (reason) { setError(reason.message || t('Không gán được bàn. Kiểm tra sức chứa và lịch đặt trùng.')); await load(true); }
    finally { setBusy(''); }
  }

  async function transition(order, action) {
    if (action === 'cancelled' && order.status === 'sent') {
      const reason = cancellationReasons[order.id]?.trim() || '';
      if (!reason || reason.length > 500) { setError(t('Nhập lý do từ 1 đến 500 ký tự trước khi hủy order đã gửi bếp.')); return; }
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
  }

  return {
    quantities, setQuantities, lineNotes, setLineNotes, tableId, setTableId, guestCount, setGuestCount,
    method, setMethod, warehouseId, setWarehouseId, cancellationReasons, setCancellationReasons, busy, error, notice,
    editingRecipe, recipeProduct, setRecipeProduct, recipeOutputQty, setRecipeOutputQty, recipeIngredients, setRecipeIngredients,
    reservationForm, setReservationForm, setQuantity, resetRecipe, editRecipe, saveRecipe, createOrder,
    createReservation, transitionReservation, assignReservationTable, transition,
  };
}
