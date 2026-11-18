import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, fmtNumber, uiText } from '../../lib/i18n.js';
import { addDecimals, compareDecimals, multiplyDecimals } from '../../lib/decimal.js';
import { app, can, recordLabel } from '../../lib/state.js';
import PurchaseOrderDraftForm from './components/PurchaseOrderDraftForm.jsx';
import PurchaseRequisitionForm from './components/PurchaseRequisitionForm.jsx';
import PurchaseOrdersList from './components/PurchaseOrdersList.jsx';
import PurchaseRequisitionsTable from './components/PurchaseRequisitionsTable.jsx';
import PurchaseReceiptForm from './components/PurchaseReceiptForm.jsx';
import PurchaseReturnsPanel from './components/PurchaseReturnsPanel.jsx';
import SupplierInvoiceAdjustmentsEditor from './components/SupplierInvoiceAdjustmentsEditor.jsx';
import SupplierInvoiceDraftForm from './components/SupplierInvoiceDraftForm.jsx';
import SupplierInvoicesPanel from './components/SupplierInvoicesPanel.jsx';
import PurchaseOrderSummary from './components/PurchaseOrderSummary.jsx';
import { usePurchasingData } from './hooks/usePurchasingData.js';
import {
  calculateInvoiceableLines,
  calculateReturnableLines,
  calculateSupplierInvoiceDraftTotals,
  calculateUnreceivedPurchaseLines,
  invoiceLineForReturn as findInvoiceLineForReturn,
  keyOf,
  lineValue,
  remainingInspectionBaseQuantity,
  returnSourceLineFor as findReturnSourceLine,
  returnUnitRatioFor as getReturnUnitRatio,
  selectReturnableInspections,
} from './domain/purchasingSelectors.js';
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
export default function PurchasingWorkbenchPage() {
  useDocumentTitle(`${uiText('Mua hàng và nhận hàng')} · OSP Suite`);
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const { orders, requisitions, receipts, supplierInvoices, purchaseReturns, qualityInspections, suppliers, products, units, warehouses, taxes, currencies, currencyRates, bills, approvalRequests, loading, error, setError, load } = usePurchasingData(workflowApproval);
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
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setSelectedId((current) => orders.some((row) => row.id === current) ? current : orders[0]?.id || '');
    setOrderForm((current) => ({ ...current, supplier: current.supplier || [...suppliers.keys()][0] || '', warehouse: current.warehouse || [...warehouses.keys()][0] || '' }));
    setLines((current) => current.map((line) => ({ ...line, product: line.product || [...products.keys()][0] || '' })));
    const baseCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
    const baseCurrency = [...currencies.values()].find((currency) => String(currency.code || '').toUpperCase() === baseCode);
    setSupplierInvoiceForm((current) => ({ ...current, currency: current.currency || baseCurrency?.id || '' }));
  }, [orders, suppliers, warehouses, products, currencies]);
  const taxById = useMemo(() => new Map(taxes.map((row) => [row.id, row])), [taxes]);
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const selected = orders.find((row) => row.id === selectedId);
  const selectedReceipts = useMemo(() => receipts.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [receipts, selectedId]);
  const returnSourceLineFor = (inspection) => findReturnSourceLine(inspection, receipts, selected);
  const returnUnitRatioFor = (inspection) => getReturnUnitRatio(inspection, receipts, selected, units);
  const billByOrder = useMemo(() => new Map(bills.filter((row) => row.source === 'purchase_order').map((row) => [row.source_id, row])), [bills]);
  const selectedSupplierInvoices = useMemo(() => supplierInvoices.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))), [supplierInvoices, selectedId]);
  const invoiceLineForReturn = (invoiceId, orderLine) => findInvoiceLineForReturn(invoiceId, orderLine, selectedSupplierInvoices);
  const selectedReturns = useMemo(() => purchaseReturns.filter((row) => row.purchase_order === selectedId), [purchaseReturns, selectedId]);
  const returnableLines = useMemo(() => calculateReturnableLines(selectedReceipts, selectedReturns), [selectedReceipts, selectedReturns]);
  const generalReturnLine = returnableLines.find((line) => line.key === generalReturnForm.lineKey) || null;
  const selectedReturnInspections = useMemo(
    () => selectReturnableInspections(qualityInspections, selectedId, selectedReceipts, selectedReturns),
    [qualityInspections, selectedId, selectedReceipts, selectedReturns],
  );
  const approvalByInvoice = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.supplier_invoice').map((request) => [request.record_id, request])), [approvalRequests]);
  const approvalByReturn = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.purchase_return').map((request) => [request.record_id, request])), [approvalRequests]);
  const invoiceableReturns = useMemo(() => purchaseReturns.filter((row) => row.purchase_order === selectedId), [purchaseReturns, selectedId]);
  const invoiceableLines = useMemo(
    () => calculateInvoiceableLines(selectedReceipts, selectedSupplierInvoices, invoiceableReturns),
    [selectedReceipts, selectedSupplierInvoices, invoiceableReturns],
  );
  const baseCurrencyCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
  const baseCurrency = [...currencies.values()].find((currency) => String(currency.code || '').toUpperCase() === baseCurrencyCode);
  const supplierInvoiceCurrency = currencies.get(supplierInvoiceForm.currency);
  const supplierInvoiceIsBaseCurrency = !supplierInvoiceCurrency || String(supplierInvoiceCurrency.code || '').toUpperCase() === baseCurrencyCode;
  const supplierInvoiceRate = supplierInvoiceIsBaseCurrency ? 1 : currencyRates
    .filter((rate) => rate.from_currency === supplierInvoiceForm.currency && rate.to_currency === baseCurrency?.id && String(rate.effective_date || '') <= supplierInvoiceForm.issue_date)
    .sort((left, right) => String(right.effective_date || '').localeCompare(String(left.effective_date || '')))[0]?.rate;
  const invoiceDraftTotals = useMemo(() => calculateSupplierInvoiceDraftTotals({
    lines: invoiceableLines,
    quantities: invoiceQuantities,
    prices: invoicePrices,
    taxesById: taxById,
    taxChoices: invoiceTaxes,
    adjustments: invoiceAdjustments,
    isBaseCurrency: supplierInvoiceIsBaseCurrency,
    exchangeRate: supplierInvoiceRate,
  }), [invoiceableLines, invoiceQuantities, invoicePrices, taxById, invoiceTaxes, invoiceAdjustments, supplierInvoiceIsBaseCurrency, supplierInvoiceRate]);
  const { adjustmentsInvalid: invoiceAdjustmentsInvalid, foreignPriceMissing: invoiceForeignPriceMissing, total: invoiceableTotal, variance: invoiceableVariance } = invoiceDraftTotals;
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
    const remaining = calculateUnreceivedPurchaseLines(row, receipts);
    setReceiptOrderId(row.id); setReceiptLines(remaining.map((line) => ({ ...line, qty: String(line.qty), received: String(line.qty), lot_code: '', expiry: '' }))); setReceiptNote('');
  }
  async function receiveGoods(event) {
    event.preventDefault();
    const order = orders.find((row) => row.id === receiptOrderId);
    if (!order) return;
    const receiptItems = receiptLines.filter((line) => Number(line.received ?? line.qty) > 0).map((line) => ({ product: line.product, uom: line.uom || undefined, qty: Number(line.received ?? line.qty), price: Number(line.price), ...(line.lot_code?.trim() ? { lot_code: line.lot_code.trim() } : {}), ...(line.expiry ? { expiry: line.expiry } : {}) }));
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
  async function openSupplierInvoiceDispute(invoice) {
    await run(`${invoice.id}:invoice-disputed`, () => disputeSupplierInvoice(invoice), uiText('Đã chuyển hóa đơn sang trạng thái tranh chấp.'));
  }
  async function resolveSupplierInvoiceDisputeAndSubmit(invoice) {
    await run(`${invoice.id}:invoice-resubmitted`, () => resolveSupplierInvoiceDispute(invoice), uiText('Đã xử lý tranh chấp và gửi lại hóa đơn.'));
  }
  async function submitSupplierInvoice(invoice) {
    await run(`${invoice.id}:invoice-submitted`, () => action('purchasing.supplier_invoice', invoice, 'submitted'), uiText('Đã xử lý hóa đơn theo quy tắc dung sai và phê duyệt.'));
  }
  async function approveSupplierInvoice(invoice) {
    await run(`${invoice.id}:invoice-approved`, () => action('purchasing.supplier_invoice', invoice, 'approved'), uiText('Đã duyệt hóa đơn nhà cung cấp và ghi sổ công nợ phải trả.'));
  }
  const returnInspection = qualityInspections.find((row) => row.id === returnForm.inspection);
  const returnAvailableBaseQuantity = remainingInspectionBaseQuantity(returnInspection, selectedReturns);
  const returnAvailableQuantity = Number(returnAvailableBaseQuantity) / returnUnitRatioFor(returnInspection);
  async function createQualityReturn(event) {
    event.preventDefault();
    if (!selected || !returnInspection) return;
    const sourceLine = returnSourceLineFor(returnInspection);
    if (!sourceLine) { setError(uiText('Không đối chiếu được dòng QC với dòng đơn mua tương ứng.')); return; }
    const invoiceLine = returnForm.supplier_invoice ? invoiceLineForReturn(returnForm.supplier_invoice, sourceLine) : null;
    if (returnForm.supplier_invoice && !invoiceLine) { setError(uiText('Không đối chiếu được mặt hàng QC với dòng hóa đơn nhà cung cấp.')); return; }
    const qty = Number(returnForm.qty);
    const requestedBaseQuantity = multiplyDecimals([returnForm.qty || 0, returnUnitRatioFor(returnInspection)]);
    if (!Number.isFinite(qty) || qty <= 0 || compareDecimals(requestedBaseQuantity, addDecimals([returnAvailableBaseQuantity, '0.000001'])) > 0) {
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
      lines: [{ product: generalReturnLine.product, uom: generalReturnLine.uom || undefined, qty, price: Number(invoiceLine?.price ?? generalReturnLine.price), tax: invoiceLine?.tax ?? generalReturnLine.tax ?? null, tax_rate: Number(invoiceLine?.tax_rate ?? generalReturnLine.tax_rate ?? 0), po_tax: generalReturnLine.po_tax ?? generalReturnLine.tax ?? null, po_tax_rate: Number(generalReturnLine.po_tax_rate ?? generalReturnLine.tax_rate ?? 0), lot: generalReturnLine.lot || undefined }],
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
  const orderLinesTotal = Number(addDecimals(lines.map((line) => lineValue(line, taxById))));
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Mua hàng và nhận hàng')}</h1><p className="sub">{uiText('Lập đơn mua, gửi duyệt, nhận đủ hoặc từng phần vào kho và theo dõi hóa đơn nhà cung cấp.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {can('purchasing.rfq.read') && <div className="row u-legacy-41bc5191db" ><a className="btn btn-secondary btn-sm" href="#/sourcing">{uiText('RFQ và so sánh báo giá')}</a></div>}
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{uiText('Nháp / bị trả')}</span><strong className="stat-value">{totals.draft}</strong></div><div className="card stat"><span className="stat-label">{uiText('Chờ duyệt')}</span><strong className="stat-value">{totals.awaitingApproval}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đang nhận hàng')}</span><strong className="stat-value">{totals.receiving}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã nhận đủ')}</span><strong className="stat-value">{totals.received}</strong></div></div>
    {can('purchasing.purchase_requisition.read') && <>
      {!can('purchasing.purchase_requisition.create') && <section className="card card-pad"><h2>{uiText('Đề nghị mua nội bộ')}</h2><p className="small muted">{uiText('Ghi nhu cầu hàng hóa và kho nhận. Sau khi phê duyệt, hệ thống sinh đơn mua nháp có liên kết nguồn; đơn mua vẫn cần giá và phê duyệt riêng trước khi đặt hàng.')}</p></section>}
      {can('purchasing.purchase_requisition.create') && <PurchaseRequisitionForm
        editingId={editingRequisitionId}
        form={requisitionForm}
        lines={requisitionLines}
        suppliers={suppliers}
        warehouses={warehouses}
        products={products}
        unitsFor={unitsFor}
        busy={busy}
        onSubmit={saveRequisition}
        onFormChange={(field, value) => setRequisitionForm((current) => ({ ...current, [field]: value, ...(field === 'sourcing_method' && value === 'competitive' ? { supplier: '' } : {}) }))}
        onAddLine={() => setRequisitionLines((current) => [...current, { product: [...products.keys()][0] || '', uom: products.get([...products.keys()][0])?.uom || '', qty: '1' }])}
        onProductChange={updateRequisitionProduct}
        onLineChange={updateRequisitionLine}
        onRemoveLine={removeRequisitionLine}
        onExitEdit={() => { setEditingRequisitionId(''); setRequisitionLines([{ product: [...products.keys()][0] || '', uom: products.get([...products.keys()][0])?.uom || '', qty: '1' }]); }}
        label={recordLabel}
        t={uiText}
      />}
      <section className="card card-pad"><PurchaseRequisitionsTable requisitions={requisitions} suppliers={suppliers} warehouses={warehouses} products={products} units={units} approvalByRequisition={approvalByRequisition} orderByRequisition={orderByRequisition} workflowApproval={workflowApproval} busy={busy} can={can} onEdit={editRequisition} onAction={requisitionAction} /></section>
    </>}
    {can('purchasing.purchase_order.create') && <PurchaseOrderDraftForm
      editingId={editingId}
      form={orderForm}
      lines={lines}
      suppliers={suppliers}
      warehouses={warehouses}
      products={products}
      unitsFor={unitsFor}
      taxes={taxes}
      taxById={taxById}
      total={orderLinesTotal}
      busy={busy}
      onSubmit={saveOrder}
      onFormChange={(field, value) => setOrderForm((current) => ({ ...current, [field]: value }))}
      onAddLine={addLine}
      onLineChange={updateLine}
      onRemoveLine={(index) => setLines((current) => current.filter((_, i) => i !== index))}
      onExitEdit={() => { setEditingId(''); setLines([{ product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]); }}
      lineValue={lineValue}
      formatMoney={fmtMoney}
      label={recordLabel}
      t={uiText}
    />}
    {loading ? <div className="skeleton" data-h="row"/> : !orders.length ? <div className="card card-pad empty u-legacy-92c18f6bda" >{uiText('Chưa có đơn mua. Tạo đơn mua nháp, gửi duyệt rồi nhận hàng theo số lượng thực tế.')}</div> : <div className="layout-split u-legacy-92c18f6bda" >
      <PurchaseOrdersList orders={orders} suppliers={suppliers} selectedId={selectedId} onSelect={setSelectedId} />
      {selected && <section className="card card-pad"><PurchaseOrderSummary
        order={selected}
        receipts={selectedReceipts}
        supplier={suppliers.get(selected.supplier)}
        warehouse={warehouses.get(selected.warehouse)}
        products={products}
        units={units}
        approvalRequest={approvalByOrder.get(selected.id)}
        workflowApproval={workflowApproval}
        bill={billByOrder.get(selected.id)}
        busy={busy}
        canEdit={['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.update')}
        canSubmit={['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.submitted')}
        canApprove={selected.status === 'submitted' && !workflowApproval && can('purchasing.purchase_order.approved')}
        canCancel={['draft','submitted','approved','rejected'].includes(selected.status) && approvalByOrder.get(selected.id)?.status !== 'pending' && can('purchasing.purchase_order.cancelled')}
        canReceive={canReceive(selected)}
        onEdit={() => editOrder(selected)}
        onSubmit={() => submitOrder(selected)}
        onApprove={() => approveOrder(selected)}
        onCancel={() => orderAction(selected, 'cancelled')}
        onReceive={() => prepareReceipt(selected)}
      />
    {['partially_received','received'].includes(selected.status) && selectedReceipts.some((receipt) => receipt.status === 'received') && can('purchasing.supplier_invoice.create') && <SupplierInvoiceDraftForm onSubmit={createSupplierInvoice} lines={invoiceableLines} products={products} currencies={currencies} taxes={taxes} taxById={taxById} selectedReceipts={selectedReceipts} invoiceQuantities={invoiceQuantities} invoicePrices={invoicePrices} invoiceTaxes={invoiceTaxes} invoiceAdjustments={invoiceAdjustments} supplierInvoiceForm={supplierInvoiceForm} supplierInvoiceCurrency={supplierInvoiceCurrency} supplierInvoiceIsBaseCurrency={supplierInvoiceIsBaseCurrency} supplierInvoiceRate={supplierInvoiceRate} baseCurrencyCode={baseCurrencyCode} invoiceableVariance={invoiceableVariance} invoiceableTotal={invoiceableTotal} invoiceAdjustmentsInvalid={invoiceAdjustmentsInvalid} invoiceForeignPriceMissing={invoiceForeignPriceMissing} busy={busy} lineKey={keyOf} fmtMoney={fmtMoney} t={uiText} onQuantityChange={(key, value) => setInvoiceQuantities((current) => ({ ...current, [key]: value }))} onPriceChange={(key, value) => setInvoicePrices((current) => ({ ...current, [key]: value }))} onCurrencyChange={(value) => { setSupplierInvoiceForm((current) => ({ ...current, currency: value })); setInvoicePrices({}); }} onTaxChange={(key, value) => setInvoiceTaxes((current) => ({ ...current, [key]: value }))} onAdjustmentsChange={setInvoiceAdjustments} onFormChange={(field, value) => setSupplierInvoiceForm((current) => ({ ...current, [field]: value }))} />}
        <SupplierInvoicesPanel invoices={selectedSupplierInvoices} bills={bills} approvalByInvoice={approvalByInvoice} currencies={currencies} baseCurrencyCode={baseCurrencyCode} workflowApproval={workflowApproval} busy={busy} disputeReasons={invoiceDisputeReasons} resolutionNotes={invoiceResolutionNotes} canDispute={can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.disputed')} canResolve={can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.submitted')} canSubmit={can('purchasing.supplier_invoice.submitted')} canApprove={can('purchasing.supplier_invoice.approved')} onDisputeReasonChange={(id, value) => setInvoiceDisputeReasons((current) => ({ ...current, [id]: value }))} onResolutionNoteChange={(id, value) => setInvoiceResolutionNotes((current) => ({ ...current, [id]: value }))} onDispute={openSupplierInvoiceDispute} onResolve={resolveSupplierInvoiceDisputeAndSubmit} onSubmit={submitSupplierInvoice} onApprove={approveSupplierInvoice} />

        {receiptOrderId === selected.id && <PurchaseReceiptForm lines={receiptLines} products={products} note={receiptNote} busy={busy} onClose={() => setReceiptOrderId('')} onLineChange={(index, field, value) => setReceiptLines((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [field]: value } : item))} onNoteChange={setReceiptNote} onSubmit={receiveGoods} />}
        {selectedReceipts.length > 0 && <div className="table-wrap u-legacy-c53ea1da23" ><h3>{uiText("Lịch sử nhận hàng")}</h3><table className="table"><thead><tr><th>{uiText("Ngày")}</th><th>{uiText("Tổng phiếu")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{selectedReceipts.map((row) => <tr key={row.id}><td>{fmtDate(row.created_at)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}
        {can('purchasing.purchase_return.read') && <PurchaseReturnsPanel
          selected={selected}
          returns={selectedReturns}
          returnForm={returnForm}
          generalReturnForm={generalReturnForm}
          returnInspection={returnInspection}
          returnAvailableQuantity={returnAvailableQuantity}
          returnSourceUnit={units.get(returnSourceLineFor(returnInspection)?.uom || products.get(returnInspection?.product)?.uom)?.name}
          returnableLines={returnableLines}
          generalReturnLine={generalReturnLine}
          returnableInspections={selectedReturnInspections}
          supplierInvoices={selectedSupplierInvoices}
          products={products}
          units={units}
          approvalByReturn={approvalByReturn}
          workflowApproval={workflowApproval}
          busy={busy}
          canCreateQualityReturn={can('purchasing.purchase_return.create') && can('quality.inspection.read')}
          canCreateGeneralReturn={can('purchasing.purchase_return.create')}
          canSubmit={can('purchasing.purchase_return.submitted')}
          canApprove={can('purchasing.purchase_return.approved')}
          canDispatch={can('purchasing.purchase_return.dispatched')}
          canCancel={can('purchasing.purchase_return.cancelled')}
          onInspectionChange={(id) => {
            const inspection = qualityInspections.find((row) => row.id === id);
            const availableBase = remainingInspectionBaseQuantity(inspection, selectedReturns);
            setReturnForm((current) => ({ ...current, inspection: id, qty: inspection ? String(Number(availableBase) / returnUnitRatioFor(inspection)) : '' }));
          }}
          onReturnFormChange={(field, value) => setReturnForm((current) => ({ ...current, [field]: value }))}
          onGeneralReturnFormChange={(field, value) => setGeneralReturnForm((current) => ({ ...current, [field]: value, ...(field === 'lineKey' ? { qty: '' } : {}) }))}
          onCreateQualityReturn={createQualityReturn}
          onCreateGeneralReturn={createGeneralReturn}
          onAction={purchaseReturnAction}
        />}
        <p className="small muted">{uiText('Phiếu nhận cộng tồn kho theo số lượng thực nhận. Có thể nhập nhiều hóa đơn theo các đợt giao; mỗi hóa đơn chỉ được duyệt trong giới hạn số lượng đã nhận và chưa lập hóa đơn.')}</p>
      </section>}
    </div>}
  </div>;
}
