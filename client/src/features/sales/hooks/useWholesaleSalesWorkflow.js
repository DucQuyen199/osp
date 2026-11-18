import { useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { addDecimals, compareDecimals } from '../../../lib/decimal.js';
import { eligibleWholesaleReturnLines, estimateWholesaleSubtotal, remainingWholesaleShipmentLines, wholesalePrice } from '../domain/wholesaleSelectors.js';

export function useWholesaleSalesWorkflow({
  load, emailQueueEnabled, logisticsEnabled, products, units, priceLists, orders, shipments, returns, setError, t,
}) {
  const [selectedUnits, setSelectedUnits] = useState({});
  const [party, setParty] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [priceList, setPriceList] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState({});
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnReasons, setReturnReasons] = useState({});
  const [shipmentQuantities, setShipmentQuantities] = useState({});
  const [orderVoucherCodes, setOrderVoucherCodes] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const selectedList = priceLists.find((item) => item.id === priceList);
  const cart = useMemo(() => Object.entries(quantities)
    .map(([id, qty]) => ({ product: products.get(id), qty: String(qty), uom: selectedUnits[id] || products.get(id)?.uom }))
    .filter((line) => line.product && compareDecimals(line.qty, 0) > 0), [products, quantities, selectedUnits]);
  const estimate = estimateWholesaleSubtotal(cart, selectedList, units);
  const setQuantity = (id, value) => setQuantities((current) => {
    const next = { ...current };
    try { if (compareDecimals(value || 0, 0) > 0) next[id] = String(value); else delete next[id]; }
    catch { delete next[id]; }
    return next;
  });

  async function createQuote(event) {
    event.preventDefault(); if (!party || !warehouse || !cart.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.quotation'), { method: 'POST', body: {
        party, warehouse, price_list: priceList || undefined, shipping_address: shippingAddress.trim() || undefined,
        valid_until: validUntil || undefined, note: note.trim() || undefined,
        lines: cart.map(({ product, qty, uom }) => ({ product: product.id, qty, uom })),
      } });
      setQuantities({}); setSelectedUnits({}); setNote(''); await load(true);
      setNotice(`${t('Đã tạo báo giá')} ${String(created.id).slice(0, 8)}. ${t('Máy chủ áp dụng bảng giá hoặc giá danh mục và tính thuế.')}`);
    } catch (reason) { setError(reason.message || t('Không tạo được báo giá. Kiểm tra khách hàng, giá và ngày hiệu lực.')); }
    finally { setBusy(''); }
  }

  async function transition(entity, record, action) {
    setBusy(`${record.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath(entity, record.id, action), { method: 'POST' });
      await load(true);
      const message = t(action === 'confirmed'
        ? 'Đơn đã xác nhận. Hạn mức tín dụng và tồn khả dụng đã được kiểm tra; hệ thống tạo hóa đơn và chuyến giao nếu có địa chỉ.'
        : action === 'accepted' ? 'Báo giá đã duyệt; hệ thống tạo đơn bán nháp.'
          : action === 'sent' ? (emailQueueEnabled
            ? 'Báo giá đã gửi và email chi tiết đã xếp vào hàng đợi gửi.'
            : 'Đã ghi nhận báo giá đã gửi cho khách hàng.')
            : action === 'expired' ? 'Đã đánh dấu báo giá hết hạn.' : 'Đã cập nhật trạng thái chứng từ.');
      setNotice(message);
    } catch (reason) { setError(reason.message || t('Không cập nhật được chứng từ. Kiểm tra giá, tín dụng và tồn kho.')); await load(true); }
    finally { setBusy(''); }
  }

  async function applyVoucher(order) {
    const code = (orderVoucherCodes[order.id] ?? order.voucher_code ?? '').trim().toUpperCase();
    setBusy(`${order.id}:voucher`); setError(''); setNotice('');
    try {
      await api(dataPath('sales.sales_order', order.id), { method: 'PATCH', body: { voucher_code: code } });
      await load(true);
      setNotice(t(code ? 'Đã áp dụng voucher; số tiền và thuế đã được máy chủ tính lại.' : 'Đã gỡ voucher khỏi đơn nháp.'));
    } catch (reason) { setError(reason.message || t('Không áp dụng được voucher. Kiểm tra ngày hiệu lực, thành viên và mã.')); }
    finally { setBusy(''); }
  }

  const eligibleReturnLines = (order) => eligibleWholesaleReturnLines(order, shipments, returns, products,
    logisticsEnabled && Boolean(order.shipping_address?.trim()));
  const remainingShipmentLines = (order) => remainingWholesaleShipmentLines(order, shipments, products);

  async function createShipment(order) {
    const openLines = remainingShipmentLines(order);
    const lines = openLines.map((line) => ({
      product: line.product, price: line.price, uom: line.uom,
      qty: shipmentQuantities[order.id]?.[line.key] || '0', remaining: line.remaining,
    })).filter((line) => compareDecimals(line.qty, 0) > 0);
    if (!lines.length || lines.some((line) => compareDecimals(line.qty, addDecimals([line.remaining, '0.000001'])) > 0)) return;
    setBusy(`${order.id}:shipment`); setError(''); setNotice('');
    try {
      const created = await api(dataPath('logistics.shipment'), { method: 'POST', body: {
        source: 'sales_order', source_id: order.id, party: order.party,
        warehouse: order.warehouse, destination: order.shipping_address,
        lines: lines.map(({ product, price, qty, uom }) => ({ product, price, qty, uom })),
      } });
      setShipmentQuantities((current) => { const next = { ...current }; delete next[order.id]; return next; });
      await load(true);
      setNotice(`${t('Đã tạo vận đơn')} ${String(created.id).slice(0, 8)} ${t('cho số lượng được chọn.')}`);
    } catch (reason) {
      setError(reason.message || t('Không tạo được vận đơn. Hệ thống kiểm tra lại lượng còn giao trên đơn.'));
      await load(true);
    } finally { setBusy(''); }
  }

  async function createReturn(order) {
    const lines = eligibleReturnLines(order)
      .map((line) => ({ ...line, qty: returnQuantities[`${order.id}:${line.key}`] || '0' }))
      .filter((line) => compareDecimals(line.qty, 0) > 0)
      .map(({ product, price, qty, uom, discount_pct, tax, tax_rate }) => ({ product, price, qty, uom, discount_pct, tax, tax_rate }));
    if (!lines.length || !returnReasons[order.id]?.trim()) return;
    setBusy(`${order.id}:return`); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.sales_return'), { method: 'POST', body: {
        sales_order: order.id, warehouse: order.warehouse, lines, reason: returnReasons[order.id].trim(),
      } });
      setReturnReasons((current) => ({ ...current, [order.id]: '' }));
      setReturnQuantities((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${order.id}:`))));
      await load(true); setNotice(`${t('Đã lập phiếu trả')} ${String(created.id).slice(0, 8)}. ${t('Gửi duyệt để nhận hàng và lập chứng từ giảm công nợ.')}`);
    } catch (reason) { setError(reason.message || t('Không lập được phiếu trả. Kiểm tra số lượng đã giao và các phiếu trả trước.')); }
    finally { setBusy(''); }
  }

  async function decideApproval(request, action) {
    setBusy(`${request.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('workflow-approval.approval_request', request.id, action), { method: 'POST' });
      await load(true); setNotice(t(action === 'approved' ? 'Đã duyệt phiếu trả; hàng có thể được nhận về kho.' : 'Đã từ chối yêu cầu trả hàng.'));
    } catch (reason) { setError(reason.message || t('Không cập nhật được quyết định phê duyệt.')); await load(true); }
    finally { setBusy(''); }
  }

  return {
    selectedUnits, setSelectedUnits, party, setParty, warehouse, setWarehouse, priceList, setPriceList,
    shippingAddress, setShippingAddress, validUntil, setValidUntil, note, setNote, quantities, setQuantities,
    returnQuantities, setReturnQuantities, returnReasons, setReturnReasons, shipmentQuantities, setShipmentQuantities,
    orderVoucherCodes, setOrderVoucherCodes, busy, notice, cart, selectedList, estimate, setQuantity,
    createQuote, transition, applyVoucher, eligibleReturnLines, remainingShipmentLines, createShipment,
    createReturn, decideApproval,
  };
}
