import { useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDate } from '../../../lib/dates.js';
import { uiText } from '../../../lib/i18n.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { calculateSupplierInvoiceDraftTotals, keyOf } from '../domain/purchasingSelectors.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useSupplierInvoiceWorkflow({ selected, selectedSupplierInvoices, invoiceableLines, currencies, currencyRates, baseCurrency, baseCurrencyCode, taxById, run }) {
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState({ invoice_number: '', issue_date: localDate(), due_date: '', dispute_reason: '', currency: '' });
  const [invoiceDisputeReasons, setInvoiceDisputeReasons] = useState({});
  const [invoiceResolutionNotes, setInvoiceResolutionNotes] = useState({});
  const [invoiceQuantities, setInvoiceQuantities] = useState({});
  const [invoicePrices, setInvoicePrices] = useState({});
  const [invoiceTaxes, setInvoiceTaxes] = useState({});
  const [invoiceAdjustments, setInvoiceAdjustments] = useState([]);

  useEffect(() => {
    setSupplierInvoiceForm((current) => ({ ...current, currency: current.currency || baseCurrency?.id || '' }));
  }, [baseCurrency]);

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

  async function createSupplierInvoice(event) {
    event.preventDefault();
    if (!selected || invoiceForeignPriceMissing || !supplierInvoiceRate) return;
    await run(`${selected.id}:supplier-invoice`, () => api(dataPath('purchasing.supplier_invoice'), { method: 'POST', body: {
      purchase_order: selected.id, supplier: selected.supplier, department: selected.department || undefined,
      invoice_number: supplierInvoiceForm.invoice_number.trim(),
      issue_date: supplierInvoiceForm.issue_date, due_date: supplierInvoiceForm.due_date || undefined,
      currency: supplierInvoiceForm.currency || undefined,
      dispute_reason: supplierInvoiceForm.dispute_reason.trim() || undefined,
      lines: invoiceableLines.map((line) => ({ ...line, qty: String(invoiceQuantities[keyOf(line)] ?? line.qty) })).filter((line) => compareDecimals(line.qty, 0) > 0).map((line) => { const key = keyOf(line); const tax = invoiceTaxes[key]; return { product: line.product, uom: line.uom || undefined, qty: line.qty, order_price: String(line.price), price: String(invoicePrices[key] ?? (supplierInvoiceIsBaseCurrency ? line.price : 0)), tax: tax === '__po__' || tax === undefined ? line.tax || undefined : tax || undefined, po_tax: line.po_tax ?? line.tax ?? null, po_tax_rate: String(line.po_tax_rate ?? line.tax_rate ?? 0) }; }),
      adjustments: invoiceAdjustments.filter((line) => compareDecimals(line.amount || 0, 0) > 0 && line.description.trim()).map(({ rowId, ...line }) => ({ ...line, amount: String(line.amount), tax: line.tax || undefined })),
    } }), uiText('Đã lưu nháp hóa đơn nhà cung cấp. Hãy đối chiếu số hóa đơn và duyệt để ghi nhận công nợ.'));
    setSupplierInvoiceForm((current) => ({ ...current, invoice_number: '', due_date: '', dispute_reason: '' }));
    setInvoiceQuantities({}); setInvoicePrices({}); setInvoiceTaxes({}); setInvoiceAdjustments([]);
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

  return {
    supplierInvoiceForm, setSupplierInvoiceForm, invoiceDisputeReasons, setInvoiceDisputeReasons,
    invoiceResolutionNotes, setInvoiceResolutionNotes, invoiceQuantities, setInvoiceQuantities,
    invoicePrices, setInvoicePrices, invoiceTaxes, setInvoiceTaxes, invoiceAdjustments, setInvoiceAdjustments,
    supplierInvoiceCurrency, supplierInvoiceIsBaseCurrency, supplierInvoiceRate,
    invoiceableTotal, invoiceableVariance, invoiceAdjustmentsInvalid, invoiceForeignPriceMissing,
    createSupplierInvoice, openSupplierInvoiceDispute, resolveSupplierInvoiceDisputeAndSubmit,
    submitSupplierInvoice, approveSupplierInvoice,
  };
}
