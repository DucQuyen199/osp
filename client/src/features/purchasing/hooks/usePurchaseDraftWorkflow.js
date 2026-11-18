import { useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { compareDecimals, addDecimals } from '../../../lib/decimal.js';
import { can } from '../../../lib/state.js';
import { calculateUnreceivedPurchaseLines, lineValue } from '../domain/purchasingSelectors.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const createOrderDraftLine = (line = {}) => ({
  rowId: crypto.randomUUID(), product: line.product || '', uom: line.uom || '',
  qty: String(line.qty ?? '1'), price: String(line.price ?? ''), tax: line.tax || '',
});
const createRequisitionDraftLine = (line = {}) => ({
  rowId: crypto.randomUUID(), product: line.product || '', uom: line.uom || '', qty: String(line.qty ?? '1'),
});

export function usePurchaseDraftWorkflow({ orders, receipts, suppliers, warehouses, products, taxById, run, setError }) {
  const [selectedId, setSelectedId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [orderForm, setOrderForm] = useState({ supplier: '', warehouse: '', expected_date: '' });
  const [lines, setLines] = useState(() => [createOrderDraftLine()]);
  const [requisitionForm, setRequisitionForm] = useState({ supplier: '', sourcing_method: 'direct', warehouse: '', requested_by: '', reason: '' });
  const [requisitionLines, setRequisitionLines] = useState(() => [createRequisitionDraftLine()]);
  const [editingRequisitionId, setEditingRequisitionId] = useState('');
  const [receiptOrderId, setReceiptOrderId] = useState('');
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptNote, setReceiptNote] = useState('');

  useEffect(() => {
    setSelectedId((current) => orders.some((row) => row.id === current) ? current : orders[0]?.id || '');
    setOrderForm((current) => ({ ...current, supplier: current.supplier || [...suppliers.keys()][0] || '', warehouse: current.warehouse || [...warehouses.keys()][0] || '' }));
    setLines((current) => current.map((line) => ({ ...line, product: line.product || [...products.keys()][0] || '' })));
  }, [orders, suppliers, warehouses, products]);

  const selected = orders.find((row) => row.id === selectedId);
  const orderLinesTotal = useMemo(() => addDecimals(lines.map((line) => lineValue(line, taxById))), [lines, taxById]);
  const canReceive = (row) => ['approved', 'partially_received'].includes(row.status) && can('purchasing.purchase_receipt.create');

  async function saveOrder(event) {
    event.preventDefault();
    const payload = {
      supplier: orderForm.supplier, warehouse: orderForm.warehouse,
      expected_date: orderForm.expected_date || undefined,
      lines: lines.map((line) => ({ product: line.product, qty: String(line.qty), price: String(line.price || 0), uom: line.uom || undefined, tax: line.tax || undefined })),
    };
    const existing = editingId;
    await run(existing ? `${existing}:save` : 'order:create', () => api(existing ? dataPath('purchasing.purchase_order', existing) : dataPath('purchasing.purchase_order'), { method: existing ? 'PATCH' : 'POST', body: payload }), uiText(existing ? 'Đã cập nhật đơn mua nháp.' : 'Đã tạo đơn mua nháp; tổng tiền và thuế được tính lại trên máy chủ.'));
    setEditingId(''); setLines([createOrderDraftLine({ product: [...products.keys()][0] || '' })]);
    if (!existing) setOrderForm((current) => ({ ...current, expected_date: '' }));
  }

  async function saveRequisition(event) {
    event.preventDefault();
    const firstProduct = [...products.keys()][0];
    const payload = {
      supplier: requisitionForm.sourcing_method === 'direct' ? requisitionForm.supplier || undefined : undefined,
      sourcing_method: requisitionForm.sourcing_method,
      warehouse: requisitionForm.warehouse,
      requested_by: requisitionForm.requested_by.trim() || undefined,
      reason: requisitionForm.reason.trim() || undefined,
      lines: requisitionLines.map((line) => ({ product: line.product, uom: line.uom || undefined, qty: String(line.qty) })),
    };
    const existing = editingRequisitionId;
    await run(existing ? `${existing}:requisition-save` : 'requisition:create', () => api(existing ? dataPath('purchasing.purchase_requisition', existing) : dataPath('purchasing.purchase_requisition'), { method: existing ? 'PATCH' : 'POST', body: payload }), uiText(existing ? 'Đã cập nhật đề nghị mua nháp.' : 'Đã tạo đề nghị mua nháp.'));
    setEditingRequisitionId(''); setRequisitionLines([createRequisitionDraftLine({ product: firstProduct || '', uom: products.get(firstProduct)?.uom || '' })]);
    setRequisitionForm((current) => ({ ...current, requested_by: '', reason: '' }));
  }

  function editRequisition(row) {
    setEditingRequisitionId(row.id);
    setRequisitionForm({ supplier: row.supplier || '', sourcing_method: row.sourcing_method || 'direct', warehouse: row.warehouse || '', requested_by: row.requested_by || '', reason: row.reason || '' });
    setRequisitionLines((row.lines || []).map((line) => createRequisitionDraftLine({ product: line.product || '', uom: line.uom || products.get(line.product)?.uom || '', qty: String(line.qty || 1) })));
  }

  async function requisitionAction(row, verb) {
    const messages = { submitted: uiText('Đã gửi đề nghị mua đi duyệt.'), approved: uiText('Đã duyệt đề nghị; hệ thống tạo đơn mua nháp để bổ sung báo giá và trình duyệt riêng.'), rejected: uiText('Đề nghị mua đã bị từ chối.') };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_requisition', row, verb), messages[verb]);
  }

  function editOrder(row) {
    setEditingId(row.id); setSelectedId(row.id);
    setOrderForm({ supplier: row.supplier || '', warehouse: row.warehouse || '', expected_date: row.expected_date || '' });
    setLines((row.lines || []).map((line) => createOrderDraftLine({ product: line.product || '', uom: line.uom || products.get(line.product)?.uom || '', qty: String(line.qty || 1), price: String(line.price ?? ''), tax: line.tax || '' })));
  }

  async function submitOrder(row) {
    await run(`${row.id}:submitted`, () => action('purchasing.purchase_order', row, 'submitted'), uiText('Đã gửi đơn mua đi phê duyệt.'));
  }
  async function approveOrder(row) {
    await run(`${row.id}:approved`, () => action('purchasing.purchase_order', row, 'approved'), uiText('Đã duyệt đơn mua; kho có thể nhận hàng.'));
  }
  async function orderAction(row, verb) {
    const messages = { cancelled: uiText('Đã hủy đơn mua.'), rejected: uiText('Đơn mua đã bị từ chối.') };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_order', row, verb), messages[verb]);
  }

  function prepareReceipt(row) {
    const remaining = calculateUnreceivedPurchaseLines(row, receipts);
    setReceiptOrderId(row.id); setReceiptLines(remaining.map((line) => ({ ...line, qty: String(line.qty), received: String(line.qty), lot_code: '', expiry: '' }))); setReceiptNote('');
  }
  async function receiveGoods(event) {
    event.preventDefault();
    const order = orders.find((row) => row.id === receiptOrderId);
    if (!order) return;
    const receiptItems = receiptLines.filter((line) => compareDecimals(line.received ?? line.qty, 0) > 0).map((line) => ({ product: line.product, uom: line.uom || undefined, qty: String(line.received ?? line.qty), price: String(line.price || 0), ...(line.lot_code?.trim() ? { lot_code: line.lot_code.trim() } : {}), ...(line.expiry ? { expiry: line.expiry } : {}) }));
    if (!receiptItems.length) { setError(uiText('Nhập số lượng nhận lớn hơn 0 cho ít nhất một dòng.')); return; }
    await run(`${order.id}:receipt`, async () => {
      const receipt = await api(dataPath('purchasing.purchase_receipt'), { method: 'POST', body: { purchase_order: order.id, warehouse: order.warehouse, lines: receiptItems, note: receiptNote.trim() || undefined } });
      await action('purchasing.purchase_receipt', receipt, 'received');
    }, uiText('Đã ghi nhận hàng vào kho. Số lượng đã được đối chiếu với đơn mua; đơn tự cập nhật tiến độ nhận.'));
    setReceiptOrderId(''); setReceiptLines([]); setReceiptNote('');
  }

  const addLine = () => { const product = [...products.values()].find((row) => row.active !== false); setLines((current) => [...current, createOrderDraftLine({ product: product?.id || '', uom: product?.uom || '' })]); };
  const exitEditOrder = () => { setEditingId(''); setLines([createOrderDraftLine({ product: [...products.keys()][0] || '' })]); };
  const addRequisitionLine = () => {
    const product = [...products.keys()][0] || '';
    setRequisitionLines((current) => [...current, createRequisitionDraftLine({ product, uom: products.get(product)?.uom || '' })]);
  };
  const exitEditRequisition = () => {
    const product = [...products.keys()][0] || '';
    setEditingRequisitionId('');
    setRequisitionLines([createRequisitionDraftLine({ product, uom: products.get(product)?.uom || '' })]);
  };
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: products.get(value)?.uom || '' } : {}) } : line));
  const updateRequisitionProduct = (index, product) => setRequisitionLines((current) => current.map((line, i) => i === index ? { ...line, product, uom: products.get(product)?.uom || '' } : line));
  const updateRequisitionLine = (index, field, value) => setRequisitionLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const removeRequisitionLine = (index) => setRequisitionLines((current) => current.filter((_, i) => i !== index));

  return {
    selectedId, setSelectedId, selected, editingId, setEditingId, orderForm, setOrderForm, lines, setLines,
    requisitionForm, setRequisitionForm, requisitionLines, setRequisitionLines, editingRequisitionId, setEditingRequisitionId,
    receiptOrderId, setReceiptOrderId, receiptLines, setReceiptLines, receiptNote, setReceiptNote,
    orderLinesTotal, canReceive, saveOrder, saveRequisition, editRequisition, requisitionAction, editOrder,
    submitOrder, approveOrder, orderAction, prepareReceipt, receiveGoods, addLine, exitEditOrder, updateLine,
    addRequisitionLine, exitEditRequisition,
    updateRequisitionProduct, updateRequisitionLine, removeRequisitionLine,
  };
}
