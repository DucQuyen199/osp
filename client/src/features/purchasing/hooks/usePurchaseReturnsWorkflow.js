import { useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { addDecimals, compareDecimals, divideDecimals, multiplyDecimals } from '../../../lib/decimal.js';
import {
  calculateReturnableLines,
  invoiceLineForReturn as findInvoiceLineForReturn,
  returnSourceLineFor as findReturnSourceLine,
  returnUnitRatioFor as getReturnUnitRatio,
  remainingInspectionBaseQuantity,
  selectReturnableInspections,
} from '../domain/purchasingSelectors.js';

export function usePurchaseReturnsWorkflow({ selected, selectedReceipts, selectedReturns, selectedSupplierInvoices, qualityInspections, units, run, setError }) {
  const [returnForm, setReturnForm] = useState({ inspection: '', qty: '', reason: '', supplier_invoice: '' });
  const [generalReturnForm, setGeneralReturnForm] = useState({ lineKey: '', qty: '', reason: '', supplier_invoice: '' });

  const returnSourceLineFor = (inspection) => findReturnSourceLine(inspection, selectedReceipts, selected);
  const returnUnitRatioFor = (inspection) => getReturnUnitRatio(inspection, selectedReceipts, selected, units);
  const invoiceLineForReturn = (invoiceId, orderLine) => findInvoiceLineForReturn(invoiceId, orderLine, selectedSupplierInvoices);
  const returnableLines = useMemo(() => calculateReturnableLines(selectedReceipts, selectedReturns), [selectedReceipts, selectedReturns]);
  const generalReturnLine = returnableLines.find((line) => line.key === generalReturnForm.lineKey) || null;
  const selectedReturnInspections = useMemo(
    () => selectReturnableInspections(qualityInspections, selected?.id || '', selectedReceipts, selectedReturns),
    [qualityInspections, selected?.id, selectedReceipts, selectedReturns],
  );
  const returnInspection = qualityInspections.find((row) => row.id === returnForm.inspection);
  const returnAvailableBaseQuantity = remainingInspectionBaseQuantity(returnInspection, selectedReturns);
  const returnAvailableQuantity = divideDecimals(returnAvailableBaseQuantity, returnUnitRatioFor(returnInspection), 28);

  async function createQualityReturn(event) {
    event.preventDefault();
    if (!selected || !returnInspection) return;
    const sourceLine = returnSourceLineFor(returnInspection);
    if (!sourceLine) { setError(uiText('Không đối chiếu được dòng QC với dòng đơn mua tương ứng.')); return; }
    const invoiceLine = returnForm.supplier_invoice ? invoiceLineForReturn(returnForm.supplier_invoice, sourceLine) : null;
    if (returnForm.supplier_invoice && !invoiceLine) { setError(uiText('Không đối chiếu được mặt hàng QC với dòng hóa đơn nhà cung cấp.')); return; }
    const qty = String(returnForm.qty || '0');
    const requestedBaseQuantity = multiplyDecimals([returnForm.qty || 0, returnUnitRatioFor(returnInspection)]);
    if (compareDecimals(qty, 0) <= 0 || compareDecimals(requestedBaseQuantity, addDecimals([returnAvailableBaseQuantity, '0.000001'])) > 0) {
      setError(uiText('Số lượng trả không được vượt quá lượng lỗi còn lại từ phiếu kiểm tra.')); return;
    }
    const payload = {
      purchase_order: selected.id, inspection: returnInspection.id,
      warehouse: returnInspection.warehouse || selected.warehouse,
      reason: returnForm.reason.trim(),
      lines: [{ product: returnInspection.product, uom: sourceLine?.uom || undefined, qty, price: String(invoiceLine?.price ?? sourceLine?.price ?? returnInspection.unit_cost ?? 0), tax: invoiceLine?.tax ?? sourceLine?.tax ?? null, tax_rate: String(invoiceLine?.tax_rate ?? sourceLine?.tax_rate ?? 0), po_tax: sourceLine?.tax ?? null, po_tax_rate: String(sourceLine?.tax_rate || 0), lot: returnInspection.lot || undefined }],
      ...(returnForm.supplier_invoice ? { supplier_invoice: returnForm.supplier_invoice } : {}),
    };
    await run('return:create', () => api(dataPath('purchasing.purchase_return'), { method: 'POST', body: payload }), uiText('Đã tạo phiếu trả nhà cung cấp từ lượng không đạt trong kiểm tra chất lượng.'));
    setReturnForm({ inspection: '', qty: '', reason: '', supplier_invoice: '' });
  }

  function selectReturnInspection(id) {
    const inspection = qualityInspections.find((row) => row.id === id);
    const availableBase = remainingInspectionBaseQuantity(inspection, selectedReturns);
    setReturnForm((current) => ({ ...current, inspection: id, qty: inspection ? divideDecimals(availableBase, returnUnitRatioFor(inspection), 28) : '' }));
  }

  async function createGeneralReturn(event) {
    event.preventDefault();
    if (!selected || !generalReturnLine) return;
    const qty = String(generalReturnForm.qty || '0');
    if (compareDecimals(qty, 0) <= 0 || compareDecimals(qty, addDecimals([generalReturnLine.qty, '0.000001'])) > 0) {
      setError(uiText('Số lượng trả phải lớn hơn 0 và không vượt quá lượng thực nhận còn lại.')); return;
    }
    const invoiceLine = generalReturnForm.supplier_invoice ? invoiceLineForReturn(generalReturnForm.supplier_invoice, generalReturnLine) : null;
    if (generalReturnForm.supplier_invoice && !invoiceLine) { setError(uiText('Không đối chiếu được mặt hàng đã nhận với dòng hóa đơn nhà cung cấp.')); return; }
    const payload = {
      purchase_order: selected.id,
      warehouse: selected.warehouse,
      reason: generalReturnForm.reason.trim(),
      lines: [{ product: generalReturnLine.product, uom: generalReturnLine.uom || undefined, qty, price: String(invoiceLine?.price ?? generalReturnLine.price), tax: invoiceLine?.tax ?? generalReturnLine.tax ?? null, tax_rate: String(invoiceLine?.tax_rate ?? generalReturnLine.tax_rate ?? 0), po_tax: generalReturnLine.po_tax ?? generalReturnLine.tax ?? null, po_tax_rate: String(generalReturnLine.po_tax_rate ?? generalReturnLine.tax_rate ?? 0), lot: generalReturnLine.lot || undefined }],
      ...(generalReturnForm.supplier_invoice ? { supplier_invoice: generalReturnForm.supplier_invoice } : {}),
    };
    await run('return:general:create', () => api(dataPath('purchasing.purchase_return'), { method: 'POST', body: payload }), uiText('Đã tạo phiếu trả hàng từ số lượng đã nhận.'));
    setGeneralReturnForm({ lineKey: '', qty: '', reason: '', supplier_invoice: '' });
  }

  async function purchaseReturnAction(row, verb) {
    const messages = { submitted: uiText('Đã gửi phiếu trả nhà cung cấp để phê duyệt.'), approved: uiText('Đã duyệt phiếu trả nhà cung cấp.'), rejected: uiText('Đã từ chối phiếu trả.'), dispatched: uiText('Đã xuất hàng trả lại nhà cung cấp.'), cancelled: uiText('Đã hủy phiếu trả nhà cung cấp.') };
    await run(`${row.id}:${verb}`, () => api(dataPath('purchasing.purchase_return', row.id, verb), { method: 'POST' }), messages[verb] || uiText('Đã cập nhật phiếu trả nhà cung cấp.'));
  }

  return {
    returnForm, setReturnForm, generalReturnForm, setGeneralReturnForm,
    returnSourceLineFor, returnUnitRatioFor, returnableLines, generalReturnLine,
    selectedReturnInspections, returnInspection, returnAvailableQuantity,
    selectReturnInspection, createQualityReturn, createGeneralReturn, purchaseReturnAction,
  };
}
