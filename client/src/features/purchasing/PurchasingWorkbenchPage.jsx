import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, fmtNumber, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { PurchaseOrderLinesEditor, RequisitionLinesEditor } from './components/PurchaseLineEditors.jsx';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const billForSupplierInvoice = (bills, invoice) => bills.find((row) => row.supplier_invoice_id === invoice.id);
const keyOf = (line) => `${line.product}|${Number(line.price || 0)}|${line.tax || ''}|${Number(line.tax_rate ?? 0)}|${line.uom || ''}`;
const orderPriceKeyOf = (line) => `${line.product}|${Number(line.price || 0)}|${line.uom || ''}|${line.po_tax ?? line.tax ?? ''}|${Number(line.po_tax_rate ?? line.tax_rate ?? 0)}`;
const lineValue = (line, taxes) => {
  const net = (Number(line.qty) || 0) * (Number(line.price) || 0);
  const rate = Number(taxes.get(line.tax)?.rate ?? line.tax_rate) || 0;
  return net * (1 + rate / 100);
};

export default function PurchasingWorkbenchPage() {
  const [orders, setOrders] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [supplierInvoices, setSupplierInvoices] = useState([]);
  const [purchaseReturns, setPurchaseReturns] = useState([]);
  const [qualityInspections, setQualityInspections] = useState([]);
  const [suppliers, setSuppliers] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [taxes, setTaxes] = useState([]);
  const [currencies, setCurrencies] = useState(new Map());
  const [currencyRates, setCurrencyRates] = useState([]);
  const [bills, setBills] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [orderForm, setOrderForm] = useState({ supplier: '', warehouse: '', expected_date: '' });
  const [lines, setLines] = useState([{ product: '', qty: '1', price: '', tax: '' }]);
  const [requisitionForm, setRequisitionForm] = useState({ supplier: '', sourcing_method: 'direct', warehouse: '', requested_by: '', reason: '' });
  const [requisitionLines, setRequisitionLines] = useState([{ product: '', uom: '', qty: '1' }]);
  const [editingRequisitionId, setEditingRequisitionId] = useState('');
  const [receiptOrderId, setReceiptOrderId] = useState('');
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptNote, setReceiptNote] = useState('');
  const [returnForm, setReturnForm] = useState({ inspection: '', qty: '', reason: '', supplier_invoice: '' });
  const [generalReturnForm, setGeneralReturnForm] = useState({ lineKey: '', qty: '', reason: '', supplier_invoice: '' });
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState({ invoice_number: '', issue_date: localDate(), due_date: '', dispute_reason: '', currency: '' });
  const [invoiceDisputeReasons, setInvoiceDisputeReasons] = useState({});
  const [invoiceResolutionNotes, setInvoiceResolutionNotes] = useState({});
  const [invoiceQuantities, setInvoiceQuantities] = useState({});
  const [invoicePrices, setInvoicePrices] = useState({});
  const [invoiceTaxes, setInvoiceTaxes] = useState({});
  const [invoiceAdjustments, setInvoiceAdjustments] = useState([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [orderRes, receiptRes, requisitionRes, supplierInvoiceRes, returnRes, inspectionRes, supplierMap, productMap, unitMap, warehouseMap, taxRes, billRes, approvalRes, currencyMap, currencyRateRes] = await Promise.all([
        can('purchasing.purchase_order.read') ? loadAllResponse('purchasing.purchase_order') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_receipt.read') ? loadAllResponse('purchasing.purchase_receipt') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_requisition.read') ? loadAllResponse('purchasing.purchase_requisition') : Promise.resolve({ items: [] }),
        can('purchasing.supplier_invoice.read') ? loadAllResponse('purchasing.supplier_invoice') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_return.read') ? loadAllResponse('purchasing.purchase_return') : Promise.resolve({ items: [] }),
        can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.tax.read') ? loadAllResponse('master-data.tax') : Promise.resolve({ items: [] }),
        can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(new Map()),
        can('master-data.currency_rate.read') ? loadAllResponse('master-data.currency_rate') : Promise.resolve({ items: [] }),
      ]);
      const orderRows = itemsOf(orderRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const requisitionRows = itemsOf(requisitionRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const supplierRows = new Map([...supplierMap].filter(([, row]) => row.is_supplier !== false));
      setOrders(orderRows); setRequisitions(requisitionRows); setReceipts(itemsOf(receiptRes)); setSupplierInvoices(itemsOf(supplierInvoiceRes)); setPurchaseReturns(itemsOf(returnRes)); setQualityInspections(itemsOf(inspectionRes)); setSuppliers(supplierRows); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap);
      setTaxes(itemsOf(taxRes)); setBills(itemsOf(billRes)); setApprovalRequests(itemsOf(approvalRes));
      setCurrencies(currencyMap || new Map()); setCurrencyRates(itemsOf(currencyRateRes));
      setSelectedId((current) => orderRows.some((row) => row.id === current) ? current : orderRows[0]?.id || '');
      setOrderForm((current) => ({ ...current, supplier: current.supplier || [...supplierRows.keys()][0] || '', warehouse: current.warehouse || [...warehouseMap.keys()][0] || '' }));
      setLines((current) => current.map((line) => ({ ...line, product: line.product || [...productMap.keys()][0] || '' })));
      const baseCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
      const baseCurrency = [...(currencyMap || new Map()).values()].find((currency) => String(currency.code || '').toUpperCase() === baseCode);
      setSupplierInvoiceForm((current) => ({ ...current, currency: current.currency || baseCurrency?.id || '' }));
    } catch (reason) { setError(reason.message || uiText('Không tải được đơn mua và phiếu nhận hàng.')); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowApproval]);

  useEffect(() => { document.title = `${uiText('Mua hàng và nhận hàng')} · OSP Suite`; load(); }, [load]);
  const taxById = useMemo(() => new Map(taxes.map((row) => [row.id, row])), [taxes]);
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const selected = orders.find((row) => row.id === selectedId);
  const selectedReceipts = useMemo(() => receipts.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [receipts, selectedId]);
  const returnSourceLineFor = (inspection) => {
    const receipt = receipts.find((row) => row.id === inspection?.source_id);
    const receiptLine = receipt?.lines?.find((line) => line.product === inspection.product && (line.lot || null) === (inspection.lot || null));
    const matchingOrderLine = selected?.lines?.find((line) => line.product === inspection?.product
      && (!receiptLine || ((line.uom || null) === (receiptLine.uom || null)
        && Math.abs(Number(line.price || 0) - Number(receiptLine.price || 0)) <= 0.005
        && (line.tax || '') === (receiptLine.tax || '')
        && Number(line.tax_rate || 0) === Number(receiptLine.tax_rate || 0))));
    return matchingOrderLine || (!receiptLine ? selected?.lines?.find((line) => line.product === inspection?.product) : undefined);
  };
  const returnUnitRatioFor = (inspection) => {
    const unitId = returnSourceLineFor(inspection)?.uom;
    const ratio = Number(units.get(unitId)?.ratio || 1);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  };
  const billByOrder = useMemo(() => new Map(bills.filter((row) => row.source === 'purchase_order').map((row) => [row.source_id, row])), [bills]);
  const selectedSupplierInvoices = useMemo(() => supplierInvoices.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))), [supplierInvoices, selectedId]);
  const invoiceLineForReturn = (invoiceId, orderLine) => {
    const invoice = selectedSupplierInvoices.find((row) => row.id === invoiceId);
    return invoice?.lines?.find((line) => line.product === orderLine.product
      && (line.uom || null) === (orderLine.uom || null)
      && Math.abs(Number(line.po_price ?? line.order_price ?? line.price) - Number(orderLine.price)) <= 0.005
      && ((line.po_tax !== undefined && (line.po_tax || '') === (orderLine.tax || '')
        && Number(line.po_tax_rate || 0) === Number(orderLine.tax_rate || 0))
        || (line.po_tax === undefined && line.po_tax_rate === undefined))) || null;
  };
  const selectedReturns = useMemo(() => purchaseReturns.filter((row) => row.purchase_order === selectedId), [purchaseReturns, selectedId]);
  const returnableLines = useMemo(() => {
    const received = new Map();
    for (const receipt of selectedReceipts.filter((row) => row.status === 'received')) {
      for (const line of receipt.lines || []) {
        const key = orderPriceKeyOf(line); const entry = received.get(key) || { ...line, qty: 0 };
        entry.qty += Number(line.qty || 0); received.set(key, entry);
      }
    }
    for (const purchaseReturn of selectedReturns.filter((row) => ['submitted', 'approved', 'dispatched'].includes(row.status))) {
      for (const line of purchaseReturn.lines || []) {
        const key = orderPriceKeyOf({ ...line, price: line.po_price ?? line.price });
        const entry = received.get(key);
        if (entry) entry.qty = Math.max(0, entry.qty - Number(line.qty || 0));
      }
    }
    return [...received.entries()].map(([key, line]) => ({ ...line, key }))
      .filter((line) => line.qty > 0.000001);
  }, [selectedReceipts, selectedReturns]);
  const generalReturnLine = returnableLines.find((line) => line.key === generalReturnForm.lineKey) || null;
  const selectedReturnInspections = useMemo(() => qualityInspections.filter((inspection) => {
    if (inspection.status !== 'failed' || !['purchase_order', 'purchase_receipt'].includes(inspection.source)) return false;
    const belongsToOrder = inspection.source === 'purchase_order'
      ? inspection.source_id === selectedId
      : selectedReceipts.some((receipt) => receipt.id === inspection.source_id);
    if (!belongsToOrder) return false;
    const alreadyReturned = selectedReturns.filter((row) => row.inspection === inspection.id && ['submitted', 'approved', 'dispatched'].includes(row.status))
      .reduce((sum, row) => sum + (row.lines || []).reduce((lineSum, line) => lineSum + Number(line.base_qty ?? line.qty ?? 0), 0), 0);
    return Number(inspection.qty || 0) - alreadyReturned > 0.000001;
  }), [qualityInspections, selectedId, selectedReceipts, selectedReturns]);
  const approvalByInvoice = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.supplier_invoice').map((request) => [request.record_id, request])), [approvalRequests]);
  const approvalByReturn = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.purchase_return').map((request) => [request.record_id, request])), [approvalRequests]);
  const invoiceableLines = useMemo(() => {
    const received = new Map();
    for (const receipt of selectedReceipts.filter((row) => row.status === 'received')) {
      for (const line of receipt.lines || []) {
        const key = orderPriceKeyOf(line); const entry = received.get(key) || { ...line, qty: 0 };
        entry.qty += Number(line.qty || 0); received.set(key, entry);
      }
    }
    for (const purchaseReturn of purchaseReturns.filter((row) => row.purchase_order === selectedId && row.status === 'dispatched')) {
      for (const line of purchaseReturn.lines || []) {
        const key = orderPriceKeyOf(line); const entry = received.get(key);
        if (entry) entry.qty = Math.max(0, entry.qty - Number(line.qty || 0));
      }
    }
    const reserved = new Map();
    for (const invoice of selectedSupplierInvoices.filter((row) => ['draft','submitted','disputed','approved'].includes(row.status))) {
      for (const line of invoice.lines || []) {
        const key = orderPriceKeyOf({ ...line, price: line.po_price ?? line.order_price ?? line.price });
        reserved.set(key, (reserved.get(key) || 0) + Number(line.qty || 0));
      }
    }
    return [...received.entries()].map(([key, line]) => ({ ...line, qty: Math.max(0, line.qty - (reserved.get(key) || 0)) })).filter((line) => line.qty > 0.000001);
  }, [selectedReceipts, selectedSupplierInvoices, purchaseReturns, selectedId]);
  const invoiceAdjustmentTotals = invoiceAdjustments.reduce((totals, line) => {
    const amount = Number(line.amount) || 0;
    const rate = Number(taxById.get(line.tax)?.rate) || 0;
    const sign = line.kind === 'discount' ? -1 : 1;
    return { net: totals.net + amount * sign, tax: totals.tax + amount * rate / 100 * sign };
  }, { net: 0, tax: 0 });
  const invoiceAdjustmentsInvalid = invoiceAdjustments.some((line) => {
    const hasAnyValue = line.description.trim() || line.amount !== '';
    return Boolean(hasAnyValue) && (!line.description.trim() || Number(line.amount) <= 0
      || (line.allocation === 'landed_cost' && (line.kind !== 'charge' || !(line.receipt_ids || []).length)));
  });
  const baseCurrencyCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
  const baseCurrency = [...currencies.values()].find((currency) => String(currency.code || '').toUpperCase() === baseCurrencyCode);
  const supplierInvoiceCurrency = currencies.get(supplierInvoiceForm.currency);
  const supplierInvoiceIsBaseCurrency = !supplierInvoiceCurrency || String(supplierInvoiceCurrency.code || '').toUpperCase() === baseCurrencyCode;
  const supplierInvoiceRate = supplierInvoiceIsBaseCurrency ? 1 : currencyRates
    .filter((rate) => rate.from_currency === supplierInvoiceForm.currency && rate.to_currency === baseCurrency?.id && String(rate.effective_date || '') <= supplierInvoiceForm.issue_date)
    .sort((left, right) => String(right.effective_date || '').localeCompare(String(left.effective_date || '')))[0]?.rate;
  const invoiceForeignPriceMissing = !supplierInvoiceIsBaseCurrency && invoiceableLines.some((line) => Number(invoiceQuantities[keyOf(line)] ?? line.qty) > 0 && !String(invoicePrices[keyOf(line)] ?? '').trim());
  const invoiceableTotal = invoiceableLines.reduce((sum, line) => {
    const key = keyOf(line);
    const price = invoicePrices[key] ?? (supplierInvoiceIsBaseCurrency ? line.price : 0);
    return sum + lineValue({ ...line, qty: invoiceQuantities[key] ?? line.qty, price, tax: invoiceTaxes[key] ?? line.tax }, taxById);
  }, 0) + invoiceAdjustmentTotals.net + invoiceAdjustmentTotals.tax;
  const invoiceableVariance = (invoiceableLines.reduce((sum, line) => {
    const key = keyOf(line);
    const price = Number(invoicePrices[key] ?? (supplierInvoiceIsBaseCurrency ? line.price : 0));
    return sum + (price - Number(line.price)) * Number(invoiceQuantities[key] ?? line.qty);
  }, 0) + invoiceAdjustmentTotals.net) * Number(supplierInvoiceRate || 0);
  const approvalByOrder = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_order').map((row) => [row.record_id, row])), [approvalRequests]);
  const approvalByRequisition = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_requisition').map((row) => [row.record_id, row])), [approvalRequests]);
  const orderByRequisition = useMemo(() => new Map(orders.filter((row) => row.source === 'purchase_requisition').map((row) => [row.source_id, row])), [orders]);
  const totals = useMemo(() => ({
    draft: orders.filter((row) => ['draft','rejected'].includes(row.status)).length,
    awaitingApproval: orders.filter((row) => row.status === 'submitted').length,
    receiving: orders.filter((row) => ['approved','partially_received'].includes(row.status)).length,
    received: orders.filter((row) => row.status === 'received').length,
  }), [orders]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function saveOrder(event) {
    event.preventDefault();
    const payload = {
      supplier: orderForm.supplier, warehouse: orderForm.warehouse,
      expected_date: orderForm.expected_date || undefined,
      lines: lines.map((line) => ({ product: line.product, qty: Number(line.qty), price: Number(line.price), uom: line.uom || undefined, tax: line.tax || undefined })),
    };
    const existing = editingId;
    await run(existing ? `${existing}:save` : 'order:create', () => api(existing ? dataPath('purchasing.purchase_order', existing) : dataPath('purchasing.purchase_order'), { method: existing ? 'PATCH' : 'POST', body: payload }), uiText(existing ? 'Đã cập nhật đơn mua nháp.' : 'Đã tạo đơn mua nháp; tổng tiền và thuế được tính lại trên máy chủ.'));
    setEditingId(''); setLines([{ product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]);
    if (!existing) setOrderForm((current) => ({ ...current, expected_date: '' }));
  }

  async function saveRequisition(event) {
    event.preventDefault();
    const payload = {
      supplier: requisitionForm.sourcing_method === 'direct' ? requisitionForm.supplier || undefined : undefined,
      sourcing_method: requisitionForm.sourcing_method,
      warehouse: requisitionForm.warehouse,
      requested_by: requisitionForm.requested_by.trim() || undefined,
      reason: requisitionForm.reason.trim() || undefined,
      lines: requisitionLines.map((line) => ({ product: line.product, uom: line.uom || undefined, qty: Number(line.qty) })),
    };
    const existing = editingRequisitionId;
    await run(existing ? `${existing}:requisition-save` : 'requisition:create', () => api(existing ? dataPath('purchasing.purchase_requisition', existing) : dataPath('purchasing.purchase_requisition'), { method: existing ? 'PATCH' : 'POST', body: payload }), uiText(existing ? 'Đã cập nhật đề nghị mua nháp.' : 'Đã tạo đề nghị mua nháp.'));
    setEditingRequisitionId(''); setRequisitionLines([{ product: [...products.keys()][0] || '', uom: products.get([...products.keys()][0])?.uom || '', qty: '1' }]);
    setRequisitionForm((current) => ({ ...current, requested_by: '', reason: '' }));
  }

  function editRequisition(row) {
    setEditingRequisitionId(row.id);
    setRequisitionForm({ supplier: row.supplier || '', sourcing_method: row.sourcing_method || 'direct', warehouse: row.warehouse || '', requested_by: row.requested_by || '', reason: row.reason || '' });
    setRequisitionLines((row.lines || []).map((line) => ({ product: line.product || '', uom: line.uom || products.get(line.product)?.uom || '', qty: String(line.qty || 1) })));
  }

  async function requisitionAction(row, verb) {
    const messages = { submitted: uiText('Đã gửi đề nghị mua đi duyệt.'), approved: uiText('Đã duyệt đề nghị; hệ thống tạo đơn mua nháp để bổ sung báo giá và trình duyệt riêng.'), rejected: uiText('Đề nghị mua đã bị từ chối.') };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_requisition', row, verb), messages[verb]);
  }

  function editOrder(row) {
    setEditingId(row.id); setSelectedId(row.id);
    setOrderForm({ supplier: row.supplier || '', warehouse: row.warehouse || '', expected_date: row.expected_date || '' });
    setLines((row.lines || []).map((line) => ({ product: line.product || '', uom: line.uom || products.get(line.product)?.uom || '', qty: String(line.qty || 1), price: String(line.price ?? ''), tax: line.tax || '' })));
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
    const ordered = new Map();
    for (const line of row.lines || []) {
      const key = keyOf(line); const current = ordered.get(key) || { product: line.product, uom: line.uom, price: Number(line.price), qty: 0 };
      current.qty += Number(line.qty || 0); ordered.set(key, current);
    }
    const received = new Map();
    for (const receipt of receipts.filter((item) => item.purchase_order === row.id && item.status === 'received')) {
      for (const line of receipt.lines || []) received.set(keyOf(line), (received.get(keyOf(line)) || 0) + Number(line.qty || 0));
    }
    const remaining = [...ordered.entries()].map(([key, line]) => ({ ...line, qty: Math.max(0, line.qty - (received.get(key) || 0)), key })).filter((line) => line.qty > 0.000001);
    setReceiptOrderId(row.id); setReceiptLines(remaining.map((line) => ({ ...line, qty: String(line.qty) }))); setReceiptNote('');
  }

  async function receiveGoods(event) {
    event.preventDefault();
    const order = orders.find((row) => row.id === receiptOrderId);
    if (!order) return;
    const receiptItems = receiptLines.filter((line) => Number(line.received ?? line.qty) > 0).map((line) => ({ product: line.product, uom: line.uom || undefined, qty: Number(line.received ?? line.qty), price: Number(line.price) }));
    if (!receiptItems.length) { setError(uiText('Nhập số lượng nhận lớn hơn 0 cho ít nhất một dòng.')); return; }
    await run(`${order.id}:receipt`, async () => {
      const receipt = await api(dataPath('purchasing.purchase_receipt'), { method: 'POST', body: { purchase_order: order.id, warehouse: order.warehouse, lines: receiptItems, note: receiptNote.trim() || undefined } });
      await action('purchasing.purchase_receipt', receipt, 'received');
    }, uiText('Đã ghi nhận hàng vào kho. Số lượng đã được đối chiếu với đơn mua; đơn tự cập nhật tiến độ nhận.'));
    setReceiptOrderId(''); setReceiptLines([]); setReceiptNote('');
  }

  async function createSupplierInvoice(event) {
    event.preventDefault();
    if (!selected || invoiceForeignPriceMissing || !supplierInvoiceRate) return;
    await run(`${selected.id}:supplier-invoice`, () => api(dataPath('purchasing.supplier_invoice'), { method: 'POST', body: {
      purchase_order: selected.id, supplier: selected.supplier, department: selected.department || undefined,
      invoice_number: supplierInvoiceForm.invoice_number.trim(),
      issue_date: supplierInvoiceForm.issue_date, due_date: supplierInvoiceForm.due_date || undefined,
      currency: supplierInvoiceForm.currency || undefined,
      dispute_reason: supplierInvoiceForm.dispute_reason.trim() || undefined,
      lines: invoiceableLines.map((line) => ({ ...line, qty: Number(invoiceQuantities[keyOf(line)] ?? line.qty) })).filter((line) => line.qty > 0).map((line) => { const key = keyOf(line); const tax = invoiceTaxes[key]; return { product: line.product, uom: line.uom || undefined, qty: line.qty, order_price: Number(line.price), price: Number(invoicePrices[key] ?? (supplierInvoiceIsBaseCurrency ? line.price : 0)), tax: tax === '__po__' || tax === undefined ? line.tax || undefined : tax || undefined, po_tax: line.po_tax ?? line.tax ?? null, po_tax_rate: Number(line.po_tax_rate ?? line.tax_rate ?? 0) }; }),
      adjustments: invoiceAdjustments.filter((line) => Number(line.amount) > 0 && line.description.trim()).map((line) => ({ ...line, amount: Number(line.amount), tax: line.tax || undefined })),
    } }), uiText('Đã lưu nháp hóa đơn nhà cung cấp. Hãy đối chiếu số hóa đơn và duyệt để ghi nhận công nợ.'));
    setSupplierInvoiceForm((current) => ({ ...current, invoice_number: '', due_date: '', dispute_reason: '' }));
    setInvoiceQuantities({});
    setInvoicePrices({}); setInvoiceTaxes({}); setInvoiceAdjustments([]);
  }

  async function disputeSupplierInvoice(invoice) {
    const reason = String(invoiceDisputeReasons[invoice.id] ?? invoice.dispute_reason ?? '').trim();
    if (!reason || reason.length > 500) throw new Error(uiText('Lý do tranh chấp phải có từ 1 đến 500 ký tự.'));
    await api(dataPath('purchasing.supplier_invoice', invoice.id, 'disputed'), { method: 'POST', body: { dispute_reason: reason } });
  }

  async function resolveSupplierInvoiceDispute(invoice) {
    const note = String(invoiceResolutionNotes[invoice.id] ?? '').trim();
    if (!note || note.length > 1000) throw new Error(uiText('Ghi chú giải quyết phải có từ 1 đến 1.000 ký tự.'));
    await api(dataPath('purchasing.supplier_invoice', invoice.id, 'submitted'), { method: 'POST', body: { resolution_note: note } });
  }

  const returnInspection = qualityInspections.find((row) => row.id === returnForm.inspection);
  const returnAlreadyQuantity = returnInspection ? selectedReturns
    .filter((row) => row.inspection === returnInspection.id && ['submitted', 'approved', 'dispatched'].includes(row.status))
    .reduce((sum, row) => sum + (row.lines || []).reduce((lineSum, line) => lineSum + Number(line.base_qty ?? line.qty ?? 0), 0), 0) : 0;
  const returnAvailableQuantity = returnInspection ? Math.max(0, Number(returnInspection.qty || 0) - returnAlreadyQuantity) / returnUnitRatioFor(returnInspection) : 0;

  async function createQualityReturn(event) {
    event.preventDefault();
    if (!selected || !returnInspection) return;
    const sourceLine = returnSourceLineFor(returnInspection);
    if (!sourceLine) { setError(uiText('Không đối chiếu được dòng QC với dòng đơn mua tương ứng.')); return; }
    const invoiceLine = returnForm.supplier_invoice ? invoiceLineForReturn(returnForm.supplier_invoice, sourceLine) : null;
    if (returnForm.supplier_invoice && !invoiceLine) { setError(uiText('Không đối chiếu được mặt hàng QC với dòng hóa đơn nhà cung cấp.')); return; }
    const qty = Number(returnForm.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > returnAvailableQuantity + 0.000001) {
      setError(uiText('Số lượng trả không được vượt quá lượng lỗi còn lại từ phiếu kiểm tra.')); return;
    }
    const payload = {
      purchase_order: selected.id, inspection: returnInspection.id,
      warehouse: returnInspection.warehouse || selected.warehouse,
      reason: returnForm.reason.trim(),
      lines: [{ product: returnInspection.product, uom: sourceLine?.uom || undefined, qty, price: Number(invoiceLine?.price ?? sourceLine?.price ?? returnInspection.unit_cost ?? 0), tax: invoiceLine?.tax ?? sourceLine?.tax ?? null, tax_rate: Number(invoiceLine?.tax_rate ?? sourceLine?.tax_rate ?? 0), po_tax: sourceLine?.tax ?? null, po_tax_rate: Number(sourceLine?.tax_rate || 0), lot: returnInspection.lot || undefined }],
      ...(returnForm.supplier_invoice ? { supplier_invoice: returnForm.supplier_invoice } : {}),
    };
    await run('return:create', () => api(dataPath('purchasing.purchase_return'), { method: 'POST', body: payload }), uiText('Đã tạo phiếu trả nhà cung cấp từ lượng không đạt trong kiểm tra chất lượng.'));
    setReturnForm({ inspection: '', qty: '', reason: '', supplier_invoice: '' });
  }

  async function createGeneralReturn(event) {
    event.preventDefault();
    if (!selected || !generalReturnLine) return;
    const qty = Number(generalReturnForm.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > generalReturnLine.qty + 0.000001) {
      setError(uiText('Số lượng trả phải lớn hơn 0 và không vượt quá lượng thực nhận còn lại.')); return;
    }
    const invoiceLine = generalReturnForm.supplier_invoice ? invoiceLineForReturn(generalReturnForm.supplier_invoice, generalReturnLine) : null;
    if (generalReturnForm.supplier_invoice && !invoiceLine) { setError(uiText('Không đối chiếu được mặt hàng đã nhận với dòng hóa đơn nhà cung cấp.')); return; }
    const payload = {
      purchase_order: selected.id,
      warehouse: selected.warehouse,
      reason: generalReturnForm.reason.trim(),
      lines: [{ product: generalReturnLine.product, uom: generalReturnLine.uom || undefined, qty, price: Number(invoiceLine?.price ?? generalReturnLine.price), tax: invoiceLine?.tax ?? generalReturnLine.tax ?? null, tax_rate: Number(invoiceLine?.tax_rate ?? generalReturnLine.tax_rate ?? 0), po_tax: generalReturnLine.po_tax ?? generalReturnLine.tax ?? null, po_tax_rate: Number(generalReturnLine.po_tax_rate ?? generalReturnLine.tax_rate ?? 0) }],
      ...(generalReturnForm.supplier_invoice ? { supplier_invoice: generalReturnForm.supplier_invoice } : {}),
    };
    await run('return:general:create', () => api(dataPath('purchasing.purchase_return'), { method: 'POST', body: payload }), uiText('Đã tạo phiếu trả hàng từ số lượng đã nhận.'));
    setGeneralReturnForm({ lineKey: '', qty: '', reason: '', supplier_invoice: '' });
  }

  async function purchaseReturnAction(row, verb) {
    const messages = { submitted: uiText('Đã gửi phiếu trả nhà cung cấp để phê duyệt.'), approved: uiText('Đã duyệt phiếu trả nhà cung cấp.'), rejected: uiText('Đã từ chối phiếu trả.'), dispatched: uiText('Đã xuất hàng trả lại nhà cung cấp.'), cancelled: uiText('Đã hủy phiếu trả nhà cung cấp.') };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_return', row, verb), messages[verb] || uiText('Đã cập nhật phiếu trả nhà cung cấp.'));
  }

  const addLine = () => { const product = [...products.values()].find((row) => row.active !== false); setLines((current) => [...current, { product: product?.id || '', uom: product?.uom || '', qty: '1', price: '', tax: '' }]); };
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: products.get(value)?.uom || '' } : {}) } : line));
  const updateRequisitionProduct = (index, product) => setRequisitionLines((current) => current.map((line, i) => i === index ? { ...line, product, uom: products.get(product)?.uom || '' } : line));
  const updateRequisitionLine = (index, field, value) => setRequisitionLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const removeRequisitionLine = (index) => setRequisitionLines((current) => current.filter((_, i) => i !== index));
  const canReceive = (row) => ['approved','partially_received'].includes(row.status) && can('purchasing.purchase_receipt.create');
  const orderLinesTotal = lines.reduce((sum, line) => sum + lineValue(line, taxById), 0);

  return <div className="page">

    <div className="page-head"><div><h1>{uiText('Mua hàng và nhận hàng')}</h1><p className="sub">{uiText('Lập đơn mua, gửi duyệt, nhận đủ hoặc từng phần vào kho và theo dõi hóa đơn nhà cung cấp.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {can('purchasing.rfq.read') && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><a className="btn btn-secondary btn-sm" href="#/sourcing">{uiText('RFQ và so sánh báo giá')}</a></div>}
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText('Nháp / bị trả')}</span><strong className="stat-value">{totals.draft}</strong></div><div className="card stat"><span className="stat-label">{uiText('Chờ duyệt')}</span><strong className="stat-value">{totals.awaitingApproval}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đang nhận hàng')}</span><strong className="stat-value">{totals.receiving}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã nhận đủ')}</span><strong className="stat-value">{totals.received}</strong></div></div>

    {can('purchasing.purchase_requisition.read') && <section className="card card-pad" style={{ marginBottom: 16 }}><div className="row wrap"><h2>{uiText(editingRequisitionId ? 'Sửa đề nghị mua nháp' : 'Đề nghị mua nội bộ')}</h2><span className="grow"/>{editingRequisitionId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditingRequisitionId(''); setRequisitionLines([{ product: [...products.keys()][0] || '', uom: products.get([...products.keys()][0])?.uom || '', qty: '1' }]); }}>{uiText('Thoát chỉnh sửa')}</button>}</div><p className="small muted">{uiText('Ghi nhu cầu hàng hóa và kho nhận. Sau khi phê duyệt, hệ thống sinh đơn mua nháp có liên kết nguồn; đơn mua vẫn cần giá và phê duyệt riêng trước khi đặt hàng.')}</p>
      {can('purchasing.purchase_requisition.create') && <><form onSubmit={saveRequisition}><div className="form-grid">
<label className="field"><span className="label">{uiText('Phương thức mua')} *</span><select className="select" value={requisitionForm.sourcing_method} onChange={(event) => setRequisitionForm((current) => ({ ...current, sourcing_method: event.target.value, supplier: event.target.value === 'competitive' ? '' : current.supplier }))}><option value="direct">{uiText('Mua trực tiếp')}</option><option value="competitive">{uiText('So sánh báo giá nhà cung cấp')}</option></select></label>
                <label className="field"><span className="label">{uiText('Nhà cung cấp')} *</span><select className="select" required={requisitionForm.sourcing_method === 'direct'} disabled={requisitionForm.sourcing_method === 'competitive'} value={requisitionForm.supplier} onChange={(event) => setRequisitionForm((current) => ({ ...current, supplier: event.target.value }))}><option value="">{uiText('Chọn nhà cung cấp')}</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label>
        <label className="field"><span className="label">{uiText('Kho nhận')} *</span><select className="select" required value={requisitionForm.warehouse} onChange={(event) => setRequisitionForm((current) => ({ ...current, warehouse: event.target.value }))}><option value="">{uiText('Chọn kho')}</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label>
        <label className="field"><span className="label">{uiText('Người yêu cầu')}</span><input className="input" maxLength="160" value={requisitionForm.requested_by} onChange={(event) => setRequisitionForm((current) => ({ ...current, requested_by: event.target.value }))}/></label>
        <label className="field"><span className="label">{uiText('Lý do / mục đích')}</span><input className="input" maxLength="500" value={requisitionForm.reason} onChange={(event) => setRequisitionForm((current) => ({ ...current, reason: event.target.value }))}/></label>
      </div><div className="row wrap" style={{ marginTop: 12 }}><strong>{uiText('Danh sách hàng cần mua')}</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={() => setRequisitionLines((current) => [...current, { product: [...products.keys()][0] || '', uom: products.get([...products.keys()][0])?.uom || '', qty: '1' }])}>{uiText('Thêm dòng')}</button></div>
      <RequisitionLinesEditor lines={requisitionLines} products={products} unitsFor={unitsFor} onProductChange={updateRequisitionProduct} onChange={updateRequisitionLine} onRemove={removeRequisitionLine}/>
      <div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size}>{uiText(editingRequisitionId ? 'Lưu đề nghị nháp' : 'Tạo đề nghị nháp')}</button></div></form>
      </>}<div className="table-wrap" style={{ marginTop: 16 }}><table className="table"><thead><tr><th>{uiText("Đề nghị")}</th><th>{uiText("Người yêu cầu / lý do")}</th><th>{uiText("Hàng / số lượng")}</th><th>{uiText("Trạng thái / thao tác")}</th></tr></thead><tbody>{requisitions.map((row) => { const request = approvalByRequisition.get(row.id); const order = orderByRequisition.get(row.id); return <tr key={row.id}><td><strong>{suppliers.get(row.supplier)?.name || 'Đề nghị mua'}</strong><div className="small muted">Kho: {warehouses.get(row.warehouse)?.name || '—'} · {String(row.id).slice(0, 8)}</div>{order && <div className="small"><a href={`#/e/purchasing/purchase_order/${order.id}`}>{uiText("Đơn mua nháp đã sinh ·")} {String(order.id).slice(0, 8)}</a></div>}</td><td>{row.requested_by || '—'}<div className="small muted">{row.reason || 'Không có lý do'}</div></td><td>{(row.lines || []).map((line, index) => <div key={`${line.product}-${index}`} className="small">{products.get(line.product)?.name || uiText('Hàng hóa')} · {line.qty} {line.uom_name || units.get(line.uom)?.name || units.get(products.get(line.product)?.uom)?.name || ''}</div>)}</td><td><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span>{row.status === 'submitted' && workflowApproval && request && <div className="small"><a href={`#/e/workflow-approval/approval_request/${request.id}`}>{uiText("Mở yêu cầu duyệt ·")} {statusLabel(request.status)}</a></div>}<div className="row wrap">{['draft','rejected'].includes(row.status) && can('purchasing.purchase_requisition.update') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => editRequisition(row)}>{uiText("Sửa")}</button>}{['draft','rejected'].includes(row.status) && can('purchasing.purchase_requisition.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'submitted')}>{uiText("Gửi duyệt")}</button>}{row.status === 'submitted' && !workflowApproval && can('purchasing.purchase_requisition.approved') && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'approved')}>{uiText("Duyệt")}</button>{can('purchasing.purchase_requisition.rejected') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'rejected')}>{uiText("Từ chối")}</button>}</>}</div></td></tr>; })}{!requisitions.length && <tr><td colSpan="4" className="muted">{uiText("Chưa có đề nghị mua nội bộ. Bạn cũng có thể sinh đề nghị từ màn bổ sung tồn kho.")}</td></tr>}</tbody></table></div>
    </section>}

    {can('purchasing.purchase_order.create') && <section className="card card-pad"><div className="row wrap"><h2>{uiText(editingId ? 'Sửa đơn mua nháp' : 'Lập đơn mua trực tiếp')}</h2><span className="grow"/>{editingId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditingId(''); setLines([{ product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]); }}>{uiText('Thoát chỉnh sửa')}</button>}</div>
      <form onSubmit={saveOrder}><div className="form-grid"><label className="field"><span className="label">{uiText("Nhà cung cấp *")}</span><select className="select" required value={orderForm.supplier} onChange={(e) => setOrderForm({ ...orderForm, supplier: e.target.value })}><option value="">{uiText("Chọn nhà cung cấp")}</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Kho nhận *")}</span><select className="select" required value={orderForm.warehouse} onChange={(e) => setOrderForm({ ...orderForm, warehouse: e.target.value })}><option value="">{uiText("Chọn kho")}</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày giao dự kiến")}</span><input className="input" type="date" value={orderForm.expected_date} onChange={(e) => setOrderForm({ ...orderForm, expected_date: e.target.value })}/></label></div>
        <div className="row wrap" style={{ marginTop: 14 }}><strong>{uiText("Vật tư / hàng hóa")}</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={addLine}>{uiText("Thêm dòng")}</button></div>
        <PurchaseOrderLinesEditor lines={lines} products={products} unitsFor={unitsFor} taxes={taxes} taxById={taxById} onUpdate={updateLine} onRemove={(index) => setLines((current) => current.filter((_, i) => i !== index))} lineValue={lineValue}/>
        <div className="row wrap" style={{ marginTop: 12 }}><span className="grow"/><strong>{uiText("Tổng dự kiến có thuế:")} {fmtMoney(orderLinesTotal)}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size || orderLinesTotal <= 0}>{editingId ? 'Lưu đơn mua nháp' : 'Tạo đơn mua nháp'}</button></div>
      </form>
    </section>}

    {loading ? <div className="skeleton" data-h="row"/> : !orders.length ? <div className="card card-pad empty" style={{ marginTop: 16 }}>{uiText('Chưa có đơn mua. Tạo đơn mua nháp, gửi duyệt rồi nhận hàng theo số lượng thực tế.')}</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>{uiText('Đơn mua hàng')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Nhà cung cấp')}</th><th>{uiText('Giao dự kiến')}</th><th>{uiText('Tổng')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{orders.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{suppliers.has(row.supplier) ? recordLabel('master-data.party', suppliers.get(row.supplier)) : uiText('Nhà cung cấp')}</strong><div className="small muted">{row.source ? `${uiText('Nguồn')}: ${row.source}` : String(row.id).slice(0, 8)}</div></td><td>{fmtDate(row.expected_date)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{suppliers.has(selected.supplier) ? recordLabel('master-data.party', suppliers.get(selected.supplier)) : 'Đơn mua hàng'}</h2><div className="small muted">{uiText("Kho nhận:")} {warehouses.get(selected.warehouse)?.name || '—'} · Giao dự kiến: {fmtDate(selected.expected_date)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>{uiText("Hàng")}</th><th>{uiText("Đặt")}</th><th>{uiText("Đã nhận")}</th><th>{uiText("Đơn giá")}</th><th>{uiText("Thành tiền")}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => { const receivedQty = selectedReceipts.filter((receipt) => receipt.status === 'received').flatMap((receipt) => receipt.lines || []).filter((receiptLine) => keyOf(receiptLine) === keyOf(line)).reduce((sum, receiptLine) => sum + Number(receiptLine.qty || 0), 0); return <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || uiText('Hàng hóa')}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td><td>{receivedQty} {line.uom_name || units.get(line.uom)?.name || ''}</td><td>{fmtMoney(line.price)}</td><td>{fmtMoney(line.line_total || Number(line.qty || 0) * Number(line.price || 0))}</td></tr>; })}</tbody><tfoot><tr><th colSpan="4">{uiText("Tổng có thuế")}</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && approvalByOrder.get(selected.id) && <p className="small muted" style={{ marginTop: 10 }}>{uiText("Yêu cầu phê duyệt:")} <a href={`#/e/workflow-approval/approval_request/${approvalByOrder.get(selected.id).id}`}>{statusLabel(approvalByOrder.get(selected.id).status)} · {uiText('mở yêu cầu')}</a></p>}
        <div className="row wrap" style={{ marginTop: 12 }}>{['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => editOrder(selected)}>{uiText("Sửa nháp")}</button>}{['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.submitted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !(selected.lines || []).length || Number(selected.total) <= 0} onClick={() => submitOrder(selected)}>{uiText("Gửi duyệt")}</button>}{selected.status === 'submitted' && !workflowApproval && can('purchasing.purchase_order.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => approveOrder(selected)}>{uiText("Duyệt đơn")}</button>}{['draft','submitted','approved','rejected'].includes(selected.status) && !(approvalByOrder.get(selected.id)?.status === 'pending') && can('purchasing.purchase_order.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => orderAction(selected, 'cancelled')}>{uiText("Hủy đơn")}</button>}{canReceive(selected) && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => prepareReceipt(selected)}>{uiText("Nhận hàng")}</button>}{billByOrder.has(selected.id) && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/bill/${billByOrder.get(selected.id).id}`}>{uiText("Mở hóa đơn")} {statusLabel(billByOrder.get(selected.id).status)}</a>}</div>
    {['partially_received','received'].includes(selected.status) && selectedReceipts.some((receipt) => receipt.status === 'received') && can('purchasing.supplier_invoice.create') && <form className="card card-pad" style={{ marginTop: 14 }} onSubmit={createSupplierInvoice}>
      <h3>{uiText("Ghi nhận hóa đơn nhà cung cấp")}</h3>
      <p className="small muted">{uiText("Đối chiếu số lượng đã nhận; nhập giá, thuế và phí hoặc chiết khấu theo hóa đơn. Chênh lệch giá và cách hạch toán điều chỉnh được thể hiện trước khi duyệt.")}</p>
      <div className="form-grid">
        <div className="field full"><span className="label">{uiText("Dòng hàng trên hóa đơn")}</span>{invoiceableLines.length === 0 && <p className="small muted">{uiText("Đã lập hóa đơn hết số hàng đã nhận; có thể ghi nhận hóa đơn phí/chiết khấu phát sinh sau.")}</p>}{invoiceableLines.map((line) => { const key = keyOf(line); return <div className="row wrap" key={key} style={{ marginTop: 10, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}><span className="grow">{products.get(line.product)?.name || uiText('Hàng hóa')}<span className="small muted"> {uiText("· giá PO")} {fmtMoney(line.price, baseCurrencyCode)} · thuế PO {taxById.get(line.tax)?.name || uiText('Không thuế')} ({Number(line.tax_rate || 0)}%) · còn lập hóa đơn {line.qty}</span></span><label className="field"><span className="label">{uiText('SL')}</span><input className="input num" aria-label={`${uiText("Số lượng hóa đơn")} ${products.get(line.product)?.name || 'hàng hóa'}`} type="number" min="0" max={line.qty} step="any" value={invoiceQuantities[key] ?? line.qty} onChange={(e) => setInvoiceQuantities({ ...invoiceQuantities, [key]: e.target.value })} style={{ maxWidth: 110 }}/></label><label className="field"><span className="label">{uiText("Đơn giá HĐ (")}{supplierInvoiceCurrency?.code || baseCurrencyCode})</span><input className="input num" aria-label={`${uiText("Đơn giá hóa đơn")} ${products.get(line.product)?.name || 'hàng hóa'}`} type="number" min="0" step="any" value={invoicePrices[key] ?? (supplierInvoiceIsBaseCurrency ? line.price : '')} onChange={(e) => setInvoicePrices({ ...invoicePrices, [key]: e.target.value })} style={{ maxWidth: 140 }}/></label><label className="field"><span className="label">{uiText("Thuế HĐ")}</span><select className="input" aria-label={`${uiText("Thuế hóa đơn")} ${products.get(line.product)?.name || 'hàng hóa'}`} value={invoiceTaxes[key] ?? (line.tax || '__po__')} onChange={(e) => setInvoiceTaxes({ ...invoiceTaxes, [key]: e.target.value })}><option value="__po__">{uiText('Theo PO')}</option>{taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</select></label></div>; })}</div>
        <section className="field full"><span className="label">{uiText("Phí và chiết khấu")}</span><p className="small muted">{uiText("Phí có thể hạch toán vào chi phí mua (632) hoặc vốn hóa vào giá trị hàng nhận; thuế của phí được hạch toán riêng.")}</p>{invoiceAdjustments.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="input" aria-label={`${uiText("Loại điều chỉnh hóa đơn")} ${index + 1}`} value={line.kind} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, kind: event.target.value } : item))}><option value="charge">{uiText("Phí cộng thêm")}</option><option value="discount">{uiText("Chiết khấu")}</option></select><select className="input" aria-label={`${uiText("Cách hạch toán phí")} ${index + 1}`} value={line.allocation || 'expense'} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, allocation: event.target.value, receipt_ids: [] } : item))}><option value="expense">{uiText("Chi phí 632")}</option><option value="landed_cost">{uiText("Vốn hóa vào hàng tồn")}</option></select>{line.allocation === 'landed_cost' && <><select className="input" aria-label={`${uiText("Căn cứ phân bổ phí")} ${index + 1}`} value={line.allocation_basis || 'value'} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, allocation_basis: event.target.value } : item))}><option value="value">{uiText("Theo giá trị nhận")}</option><option value="quantity">{uiText("Theo số lượng nhận")}</option></select><select className="input" multiple size="2" aria-label={`${uiText("Phiếu nhận hàng chịu phí")} ${index + 1}`} value={line.receipt_ids || []} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, receipt_ids: [...event.target.selectedOptions].map((option) => option.value) } : item))}>{selectedReceipts.filter((receipt) => receipt.status === 'received').map((receipt) => <option key={receipt.id} value={receipt.id}>{fmtDate(receipt.created_at)} · {receipt.id.slice(0, 8)}</option>)}</select></>}<input className="input grow" aria-label={`${uiText("Mô tả điều chỉnh hóa đơn")} ${index + 1}`} placeholder={uiText("Mô tả: vận chuyển, giảm giá...")} value={line.description} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, description: event.target.value } : item))}/><input className="input num" aria-label={`${uiText("Số tiền điều chỉnh hóa đơn")} ${index + 1}`} type="number" min="0" step="any" placeholder={`Số tiền (${supplierInvoiceCurrency?.code || baseCurrencyCode})`} value={line.amount} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} style={{ maxWidth: 150 }}/><select className="input" aria-label={`${uiText("Thuế điều chỉnh hóa đơn")} ${index + 1}`} value={line.tax || ''} onChange={(event) => setInvoiceAdjustments(invoiceAdjustments.map((item, i) => i === index ? { ...item, tax: event.target.value } : item))}><option value="">{uiText("Không chịu thuế")}</option>{taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</select><button className="btn btn-ghost btn-sm" type="button" aria-label={`${uiText("Xóa điều chỉnh hóa đơn")} ${index + 1}`} onClick={() => setInvoiceAdjustments(invoiceAdjustments.filter((_, i) => i !== index))}>{uiText("Xóa")}</button></div>)}<button className="btn btn-ghost btn-sm" type="button" style={{ marginTop: 8 }} onClick={() => setInvoiceAdjustments([...invoiceAdjustments, { kind: 'charge', description: '', amount: '', tax: '', account_code: '632', allocation: 'expense', allocation_basis: 'value', receipt_ids: [] }])}>{uiText("Thêm phí/chiết khấu")}</button></section>
        <label className="field"><span className="label">{uiText("Số hóa đơn nhà cung cấp *")}</span><input className="input" required value={supplierInvoiceForm.invoice_number} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, invoice_number: e.target.value })}/></label>
        <label className="field"><span className="label">{uiText("Ngày hóa đơn *")}</span><input className="input" type="date" required value={supplierInvoiceForm.issue_date} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, issue_date: e.target.value })}/></label>
        <label className="field"><span className="label">{uiText("Tiền tệ hóa đơn")}</span><select className="input" required value={supplierInvoiceForm.currency} onChange={(e) => { setSupplierInvoiceForm({ ...supplierInvoiceForm, currency: e.target.value }); setInvoicePrices({}); }}><option value="">{uiText("Chọn tiền tệ")}</option>{[...currencies.values()].sort((a, b) => String(a.code).localeCompare(String(b.code))).map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name || currency.code}</option>)}</select><span className="small muted">{supplierInvoiceRate
          ? uiText('Tỷ giá ngày hóa đơn: 1 {currency} = {rate} {base}')
            .replace('{currency}', supplierInvoiceCurrency?.code || baseCurrencyCode)
            .replace('{rate}', String(supplierInvoiceRate))
            .replace('{base}', baseCurrencyCode)
          : uiText('Chưa có tỷ giá đến ngày hóa đơn.')}</span></label>
        <label className="field"><span className="label">{uiText("Hạn thanh toán")}</span><input className="input" type="date" min={supplierInvoiceForm.issue_date} value={supplierInvoiceForm.due_date} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, due_date: e.target.value })}/></label>
        <label className="field full"><span className="label">{uiText("Lý do tranh chấp (nếu có)")}</span><textarea className="input" rows="2" value={supplierInvoiceForm.dispute_reason} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, dispute_reason: e.target.value })} placeholder={uiText("Ví dụ: sai số lượng, sai thuế suất hoặc thiếu chứng từ")}/></label>
        <div className="row"><span className="grow small muted">{uiText("Chênh lệch ròng sau quy đổi:")} {fmtMoney(invoiceableVariance, baseCurrencyCode)}</span><button className="btn btn-secondary" disabled={Boolean(busy) || invoiceableTotal <= 0 || invoiceAdjustmentsInvalid || invoiceForeignPriceMissing || !supplierInvoiceRate}>{uiText("Lưu nháp ·")} {fmtMoney(invoiceableTotal, supplierInvoiceCurrency?.code || baseCurrencyCode)}</button></div>
      </div>
    </form>}
        {selectedSupplierInvoices.length > 0 && <div className="card card-pad" style={{ marginTop: 14 }}><h3>{uiText("Hóa đơn nhà cung cấp")}</h3>{selectedSupplierInvoices.map((invoice) => {
          const bill = billForSupplierInvoice(bills, invoice);
          const approval = approvalByInvoice.get(invoice.id);
          const variance = Number(invoice.price_variance || 0);
          const invoiceCurrencyCode = currencies.get(invoice.currency)?.code || baseCurrencyCode;
          const adjustmentSummary = (invoice.adjustments || []).map((item) => `${uiText(item.kind === 'discount' ? 'Chiết khấu' : 'Phí')}: ${item.description} ${fmtMoney(item.amount, invoiceCurrencyCode)}`).join(' · ');
          return <div className="row wrap" key={invoice.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><div className="grow"><strong>{invoice.invoice_number}</strong><div className="small muted">{fmtDate(invoice.issue_date)} · {fmtMoney(invoice.total, invoiceCurrencyCode)}{invoiceCurrencyCode !== baseCurrencyCode && invoice.base_total != null ? ` (${fmtMoney(invoice.base_total, baseCurrencyCode)})` : ''} · {statusLabel(invoice.status)}{Math.abs(variance) > 0.000001 ? <> · {uiText("Chênh lệch ròng sau quy đổi:")} {fmtMoney(variance, baseCurrencyCode)}</> : null}</div>{adjustmentSummary && <div className="small muted">{adjustmentSummary}</div>}{invoice.status === 'submitted' && approval && <div className="small"><a href={`#/e/workflow-approval/approval_request/${approval.id}`}>{uiText("Mở yêu cầu duyệt ·")} {statusLabel(approval.status)}</a></div>}</div><a className="btn btn-ghost btn-sm" href={`#/e/purchasing.supplier_invoice/${invoice.id}`}>{uiText("Chi tiết")}</a>{invoice.status === 'submitted' && can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.disputed') && <><input className="input" aria-label={uiText('Lý do tranh chấp hóa đơn')} maxLength="500" placeholder={uiText('Lý do tranh chấp')} value={invoiceDisputeReasons[invoice.id] ?? invoice.dispute_reason ?? ''} onChange={(event) => setInvoiceDisputeReasons({ ...invoiceDisputeReasons, [invoice.id]: event.target.value })}/><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(invoice.id + ':invoice-disputed', () => disputeSupplierInvoice(invoice), '\u0110\u00e3 chuy\u1ec3n h\u00f3a \u0111\u01a1n sang tr\u1ea1ng th\u00e1i tranh ch\u1ea5p.')}>{uiText("Mở tranh chấp")}</button></>}{invoice.status === 'disputed' && can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.submitted') && <><input className="input" aria-label={uiText('Ghi chú giải quyết tranh chấp')} maxLength="1000" placeholder={uiText('Ghi chú giải quyết tranh chấp')} value={invoiceResolutionNotes[invoice.id] ?? ''} onChange={(event) => setInvoiceResolutionNotes({ ...invoiceResolutionNotes, [invoice.id]: event.target.value })}/><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => run(invoice.id + ':invoice-resubmitted', () => resolveSupplierInvoiceDispute(invoice), '\u0110\u00e3 x\u1eed l\u00fd tranh ch\u1ea5p v\u00e0 g\u1eedi l\u1ea1i h\u00f3a \u0111\u01a1n.')}>{uiText("Giải quyết và gửi lại")}</button></>}{['draft','rejected'].includes(invoice.status) && workflowApproval && can('purchasing.supplier_invoice.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${invoice.id}:invoice-submitted`, () => action('purchasing.supplier_invoice', invoice, 'submitted'), uiText('Đã xử lý hóa đơn theo quy tắc dung sai và phê duyệt.'))}>{invoice.status === 'rejected' ? uiText('Gửi duyệt lại') : uiText('Gửi duyệt')}</button>}{invoice.status === 'draft' && !workflowApproval && can('purchasing.supplier_invoice.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${invoice.id}:invoice-approved`, () => action('purchasing.supplier_invoice', invoice, 'approved'), uiText('Đã duyệt hóa đơn nhà cung cấp và ghi sổ công nợ phải trả.'))}>{uiText("Duyệt và ghi sổ")}</button>}{bill && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/bill/${bill.id}`}>{uiText("Mở bill kế toán")}</a>}</div>;
        })}</div>}
        {receiptOrderId === selected.id && <form className="card card-pad" style={{ marginTop: 14 }} onSubmit={receiveGoods}><div className="row wrap"><h3>{uiText("Phiếu nhận hàng")}</h3><span className="grow"/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setReceiptOrderId('')}>{uiText("Đóng")}</button></div><p className="small muted">{uiText("Nhập số lượng thực nhận. Kho được khóa theo đơn mua; số lượng không được vượt phần còn lại.")}</p>{receiptLines.map((line, index) => <div className="row wrap" key={line.key}><strong className="grow">{products.get(line.product)?.name || uiText('Hàng hóa')} · còn {line.qty}</strong><input className="input num" aria-label={uiText("Số lượng thực nhận")} type="number" min="0" max={line.qty} step="any" required value={line.received ?? line.qty} onChange={(e) => setReceiptLines((current) => current.map((item, i) => i === index ? { ...item, received: e.target.value } : item))} style={{ maxWidth: 150}}/></div>)}<label className="field" style={{ marginTop: 10 }}><span className="label">{uiText("Ghi chú nhận hàng")}</span><textarea className="input" rows="2" value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)}/></label><div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{uiText("Ghi nhận vào kho")}</button></div></form>}
        {selectedReceipts.length > 0 && <div className="table-wrap" style={{ marginTop: 14 }}><h3>{uiText("Lịch sử nhận hàng")}</h3><table className="table"><thead><tr><th>{uiText("Ngày")}</th><th>{uiText("Tổng phiếu")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{selectedReceipts.map((row) => <tr key={row.id}><td>{fmtDate(row.created_at)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}
        {can('purchasing.purchase_return.read') && <div className="card card-pad" style={{ marginTop: 14 }}><h3>{uiText("Trả hàng nhà cung cấp")}</h3>{can('purchasing.purchase_return.create') && can('quality.inspection.read') && <form className="form-grid" onSubmit={createQualityReturn}><label className="field"><span className="label">{uiText("Phiếu QC không đạt *")}</span><select className="select" required value={returnForm.inspection} onChange={(event) => { const inspection = qualityInspections.find((row) => row.id === event.target.value); const reserved = inspection ? purchaseReturns.filter((row) => row.inspection === inspection.id && ['submitted', 'approved', 'dispatched'].includes(row.status)).reduce((sum, row) => sum + (row.lines || []).reduce((lineSum, line) => lineSum + Number(line.base_qty ?? line.qty ?? 0), 0), 0) : 0; setReturnForm((current) => ({ ...current, inspection: event.target.value, qty: inspection ? String(Math.max(0, Number(inspection.qty || 0) - reserved) / returnUnitRatioFor(inspection)) : '' })); }}><option value="">{uiText("Chọn phiếu QC")}</option>{selectedReturnInspections.map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || uiText('Hàng hóa')} · {fmtNumber(Number(inspection.qty))} · {inspection.source === 'purchase_receipt' ? 'Phiếu nhận' : 'Đơn mua'} {String(inspection.source_id).slice(0, 8)}</option>)}</select></label><label className="field"><span className="label">{uiText("Hóa đơn nhà cung cấp")}</span><select className="select" value={returnForm.supplier_invoice} onChange={(event) => setReturnForm((current) => ({ ...current, supplier_invoice: event.target.value }))}><option value="">{uiText("Không gắn hóa đơn")}</option>{selectedSupplierInvoices.filter((invoice) => invoice.status === 'approved').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} &#183; {statusLabel(invoice.status)}</option>)}</select></label><label className="field"><span className="label">{uiText("Số lượng trả")} ({units.get(returnSourceLineFor(returnInspection)?.uom || products.get(returnInspection?.product)?.uom)?.name || 'đơn vị gốc'}) *</span><input className="input num" type="number" min="0.000001" max={returnAvailableQuantity} step="any" required disabled={!returnInspection} value={returnForm.qty} onChange={(event) => setReturnForm((current) => ({ ...current, qty: event.target.value }))}/><span className="small muted">{uiText("Còn có thể trả:")} {fmtNumber(returnAvailableQuantity)}</span></label><label className="field full"><span className="label">{uiText("Lý do trả *")}</span><input className="input" required maxLength={500} value={returnForm.reason} onChange={(event) => setReturnForm((current) => ({ ...current, reason: event.target.value }))}/></label><div className="row full"><span className="grow small muted">{uiText("Hàng chỉ được xuất sau khi phiếu trả được duyệt.")}</span><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !returnInspection || !(Number(returnForm.qty) > 0) || Number(returnForm.qty) > returnAvailableQuantity + 0.000001}>{busy === 'return:create' ? 'Đang lập phiếu…' : 'Lập phiếu trả nháp'}</button></div></form>}
          {can('purchasing.purchase_return.create') && selected && ['partially_received', 'received'].includes(selected.status) && <form className="form-grid" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }} onSubmit={createGeneralReturn}>
            <h4 className="field full" style={{ margin: 0 }}>{uiText("Trả hàng khác (giao dư, sai mặt hàng)")}</h4>
            {returnableLines.length > 0 ? <>
              <label className="field"><span className="label">{uiText("Hàng đã nhận *")}</span><select className="select" required value={generalReturnForm.lineKey} onChange={(event) => setGeneralReturnForm((current) => ({ ...current, lineKey: event.target.value, qty: '' }))}><option value="">{uiText("Chọn dòng hàng")}</option>{returnableLines.map((line) => <option key={line.key} value={line.key}>{products.get(line.product)?.name || uiText('Hàng hóa')} · còn trả {fmtNumber(line.qty)} {units.get(line.uom)?.name || ''} · {fmtMoney(line.price)}</option>)}</select></label>
              <label className="field"><span className="label">{uiText("Số lượng trả *")}</span><input className="input num" type="number" min="0.000001" max={generalReturnLine?.qty || undefined} step="any" required disabled={!generalReturnLine} value={generalReturnForm.qty} onChange={(event) => setGeneralReturnForm((current) => ({ ...current, qty: event.target.value }))}/><span className="small muted">{uiText("Còn thực nhận có thể trả:")} {fmtNumber(generalReturnLine?.qty || 0)}</span></label>
              <label className="field"><span className="label">{uiText("Hóa đơn nhà cung cấp")}</span><select className="select" value={generalReturnForm.supplier_invoice} onChange={(event) => setGeneralReturnForm((current) => ({ ...current, supplier_invoice: event.target.value }))}><option value="">{uiText("Chưa gắn hóa đơn")}</option>{selectedSupplierInvoices.filter((invoice) => invoice.status === 'approved').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {statusLabel(invoice.status)}</option>)}</select></label>
              <label className="field full"><span className="label">{uiText("Lý do trả *")}</span><input className="input" required maxLength="500" value={generalReturnForm.reason} onChange={(event) => setGeneralReturnForm((current) => ({ ...current, reason: event.target.value }))}/></label>
              <div className="row full"><span className="grow small muted">{uiText("Số lượng được đối chiếu theo phiếu nhận và các phiếu trả đang xử lý.")}</span><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !generalReturnLine || !(Number(generalReturnForm.qty) > 0) || Number(generalReturnForm.qty) > (generalReturnLine?.qty || 0) + 0.000001}>{busy === 'return:general:create' ? 'Đang lập phiếu…' : 'Lập phiếu trả nháp'}</button></div>
            </> : <p className="small muted field full">{uiText("Không còn số lượng thực nhận để trả trên đơn này.")}</p>}
          </form>}
          {selectedReturns.length > 0 && <div className="stack" style={{ marginTop: 14 }}>{selectedReturns.map((row) => { const approval = approvalByReturn.get(row.id); return <div className="row wrap" key={row.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><div className="grow"><strong>{row.reason || 'Trả hàng'}</strong><div className="small muted">{(row.lines || []).map((line) => `${products.get(line.product)?.name || uiText('Hàng hóa')} · ${line.qty} ${line.uom_name || ''}`).join(' / ')} · {fmtMoney(row.total || 0)} · {statusLabel(row.status)}</div>{row.status === 'submitted' && workflowApproval && approval && <div className="small"><a href={`#/e/workflow-approval/approval_request/${approval.id}`}>{uiText("Mở yêu cầu duyệt ·")} {statusLabel(approval.status)}</a></div>}</div><a className="btn btn-ghost btn-sm" href={`#/e/purchasing.purchase_return/${row.id}`}>{uiText("Chi tiết")}</a>{['draft', 'rejected'].includes(row.status) && can('purchasing.purchase_return.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => purchaseReturnAction(row, 'submitted')}>{uiText("Gửi duyệt")}</button>}{row.status === 'submitted' && !workflowApproval && can('purchasing.purchase_return.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => purchaseReturnAction(row, 'approved')}>{uiText("Duyệt")}</button>}{row.status === 'approved' && can('purchasing.purchase_return.dispatched') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => purchaseReturnAction(row, 'dispatched')}>{uiText("Xuất trả")}</button>}{row.status === 'approved' && can('purchasing.purchase_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => purchaseReturnAction(row, 'cancelled')}>{uiText("Hủy phiếu")}</button>}{['draft', 'rejected'].includes(row.status) && can('purchasing.purchase_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => purchaseReturnAction(row, 'cancelled')}>{uiText("Hủy phiếu")}</button>}</div>; })}</div>}{!selectedReturns.length && <p className="small muted">{uiText("Chưa có phiếu trả hàng cho đơn mua này.")}</p>}</div>}
        <p className="small muted" style={{ marginTop: 12 }}>{uiText("Phiếu nhận cộng tồn kho theo số lượng thực nhận. Có thể nhập nhiều hóa đơn theo các đợt giao; mỗi hóa đơn chỉ được duyệt trong giới hạn số lượng đã nhận và chưa lập hóa đơn.")}</p>
      </section>}
    </div>}
  </div>;
}
