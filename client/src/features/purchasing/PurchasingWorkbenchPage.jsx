import React, { useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtMoney, uiText } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import PurchaseOrderDraftForm from './components/PurchaseOrderDraftForm.jsx';
import PurchaseRequisitionForm from './components/PurchaseRequisitionForm.jsx';
import PurchaseOrdersList from './components/PurchaseOrdersList.jsx';
import PurchaseRequisitionsTable from './components/PurchaseRequisitionsTable.jsx';
import PurchaseOrderDetailPanel from './components/PurchaseOrderDetailPanel.jsx';
import PurchasingWorkbenchHeader from './components/PurchasingWorkbenchHeader.jsx';
import PurchasingOverviewStats from './components/PurchasingOverviewStats.jsx';
import { usePurchasingData } from './hooks/usePurchasingData.js';
import { usePurchaseDraftWorkflow } from './hooks/usePurchaseDraftWorkflow.js';
import { useSupplierInvoiceWorkflow } from './hooks/useSupplierInvoiceWorkflow.js';
import { usePurchaseReturnsWorkflow } from './hooks/usePurchaseReturnsWorkflow.js';
import {
  calculateInvoiceableLines,
  keyOf,
  lineValue,
} from './domain/purchasingSelectors.js';
export default function PurchasingWorkbenchPage() {
  useDocumentTitle(`${uiText('Mua hàng và nhận hàng')} · OSP Suite`);
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const { orders, requisitions, receipts, supplierInvoices, purchaseReturns, qualityInspections, suppliers, products, units, warehouses, taxes, currencies, currencyRates, bills, approvalRequests, loading, error, setError, load } = usePurchasingData(workflowApproval);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  const taxById = useMemo(() => new Map(taxes.map((row) => [row.id, row])), [taxes]);
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const {
    selectedId, setSelectedId, selected, editingId, setEditingId, orderForm, setOrderForm, lines, setLines,
    requisitionForm, setRequisitionForm, requisitionLines, setRequisitionLines, editingRequisitionId, setEditingRequisitionId,
    receiptOrderId, setReceiptOrderId, receiptLines, setReceiptLines, receiptNote, setReceiptNote,
    orderLinesTotal, canReceive, saveOrder, saveRequisition, editRequisition, requisitionAction, editOrder,
    submitOrder, approveOrder, orderAction, prepareReceipt, receiveGoods, addLine, exitEditOrder, updateLine,
    addRequisitionLine, exitEditRequisition, updateRequisitionProduct, updateRequisitionLine, removeRequisitionLine,
  } = usePurchaseDraftWorkflow({ orders, receipts, suppliers, warehouses, products, taxById, run, setError });

  const selectedReceipts = useMemo(() => receipts.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [receipts, selectedId]);
  const billByOrder = useMemo(() => new Map(bills.filter((row) => row.source === 'purchase_order').map((row) => [row.source_id, row])), [bills]);
  const selectedSupplierInvoices = useMemo(() => supplierInvoices.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))), [supplierInvoices, selectedId]);
  const selectedReturns = useMemo(() => purchaseReturns.filter((row) => row.purchase_order === selectedId), [purchaseReturns, selectedId]);
  const approvalByInvoice = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.supplier_invoice').map((request) => [request.record_id, request])), [approvalRequests]);
  const approvalByReturn = useMemo(() => new Map(approvalRequests.filter((request) => request.entity === 'purchasing.purchase_return').map((request) => [request.record_id, request])), [approvalRequests]);
  const invoiceableReturns = useMemo(() => purchaseReturns.filter((row) => row.purchase_order === selectedId), [purchaseReturns, selectedId]);
  const invoiceableLines = useMemo(() => calculateInvoiceableLines(selectedReceipts, selectedSupplierInvoices, invoiceableReturns), [selectedReceipts, selectedSupplierInvoices, invoiceableReturns]);
  const baseCurrencyCode = String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase();
  const baseCurrency = useMemo(() => [...currencies.values()].find((currency) => String(currency.code || '').toUpperCase() === baseCurrencyCode), [currencies, baseCurrencyCode]);
  const {
    supplierInvoiceForm, setSupplierInvoiceForm, invoiceDisputeReasons, setInvoiceDisputeReasons,
    invoiceResolutionNotes, setInvoiceResolutionNotes, invoiceQuantities, setInvoiceQuantities,
    invoicePrices, setInvoicePrices, invoiceTaxes, setInvoiceTaxes, invoiceAdjustments, setInvoiceAdjustments,
    supplierInvoiceCurrency, supplierInvoiceIsBaseCurrency, supplierInvoiceRate,
    invoiceableTotal, invoiceableVariance, invoiceAdjustmentsInvalid, invoiceForeignPriceMissing,
    createSupplierInvoice, openSupplierInvoiceDispute, resolveSupplierInvoiceDisputeAndSubmit,
    submitSupplierInvoice, approveSupplierInvoice,
  } = useSupplierInvoiceWorkflow({ selected, selectedSupplierInvoices, invoiceableLines, currencies, currencyRates, baseCurrency, baseCurrencyCode, taxById, run });
  const {
    returnForm, setReturnForm, generalReturnForm, setGeneralReturnForm,
    returnSourceLineFor, returnUnitRatioFor, returnableLines, generalReturnLine,
    selectedReturnInspections, returnInspection, returnAvailableQuantity, selectReturnInspection,
    createQualityReturn, createGeneralReturn, purchaseReturnAction,
  } = usePurchaseReturnsWorkflow({ selected, selectedReceipts, selectedReturns, selectedSupplierInvoices, qualityInspections, units, run, setError });

  const approvalByOrder = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_order').map((row) => [row.record_id, row])), [approvalRequests]);
  const approvalByRequisition = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_requisition').map((row) => [row.record_id, row])), [approvalRequests]);
  const orderByRequisition = useMemo(() => new Map(orders.filter((row) => row.source === 'purchase_requisition').map((row) => [row.source_id, row])), [orders]);
  const totals = useMemo(() => ({
    draft: orders.filter((row) => ['draft','rejected'].includes(row.status)).length,
    awaitingApproval: orders.filter((row) => row.status === 'submitted').length,
    receiving: orders.filter((row) => ['approved','partially_received'].includes(row.status)).length,
    received: orders.filter((row) => row.status === 'received').length,
  }), [orders]);
  return <div className="page">
    <PurchasingWorkbenchHeader loading={loading} busy={busy} onRefresh={() => load()} canReadSourcing={can('purchasing.rfq.read')} />
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <PurchasingOverviewStats totals={totals} />
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
        onAddLine={addRequisitionLine}
        onProductChange={updateRequisitionProduct}
        onLineChange={updateRequisitionLine}
        onRemoveLine={removeRequisitionLine}
        onExitEdit={exitEditRequisition}
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
      onExitEdit={exitEditOrder}
      lineValue={lineValue}
      formatMoney={fmtMoney}
      label={recordLabel}
      t={uiText}
    />}
    {loading ? <div className="skeleton" data-h="row"/> : !orders.length ? <div className="card card-pad empty u-mt-16" >{uiText('Chưa có đơn mua. Tạo đơn mua nháp, gửi duyệt rồi nhận hàng theo số lượng thực tế.')}</div> : <div className="layout-split u-mt-16" >
      <PurchaseOrdersList orders={orders} suppliers={suppliers} selectedId={selectedId} onSelect={setSelectedId} />
      {selected && <PurchaseOrderDetailPanel
        summaryProps={{
          order: selected,
          receipts: selectedReceipts,
          supplier: suppliers.get(selected.supplier),
          warehouse: warehouses.get(selected.warehouse),
          products,
          units,
          approvalRequest: approvalByOrder.get(selected.id),
          workflowApproval,
          bill: billByOrder.get(selected.id),
          busy,
          canEdit: ['draft', 'rejected'].includes(selected.status) && can('purchasing.purchase_order.update'),
          canSubmit: ['draft', 'rejected'].includes(selected.status) && can('purchasing.purchase_order.submitted'),
          canApprove: selected.status === 'submitted' && !workflowApproval && can('purchasing.purchase_order.approved'),
          canCancel: ['draft', 'submitted', 'approved', 'rejected'].includes(selected.status) && approvalByOrder.get(selected.id)?.status !== 'pending' && can('purchasing.purchase_order.cancelled'),
          canReceive: canReceive(selected),
          onEdit: () => editOrder(selected),
          onSubmit: () => submitOrder(selected),
          onApprove: () => approveOrder(selected),
          onCancel: () => orderAction(selected, 'cancelled'),
          onReceive: () => prepareReceipt(selected),
        }}
        invoiceDraftProps={
          ['partially_received', 'received'].includes(selected.status)
            && selectedReceipts.some((receipt) => receipt.status === 'received')
            && can('purchasing.supplier_invoice.create')
            ? {
                onSubmit: createSupplierInvoice,
                lines: invoiceableLines,
                products,
                currencies,
                taxes,
                taxById,
                selectedReceipts,
                invoiceQuantities,
                invoicePrices,
                invoiceTaxes,
                invoiceAdjustments,
                supplierInvoiceForm,
                supplierInvoiceCurrency,
                supplierInvoiceIsBaseCurrency,
                supplierInvoiceRate,
                baseCurrencyCode,
                invoiceableVariance,
                invoiceableTotal,
                invoiceAdjustmentsInvalid,
                invoiceForeignPriceMissing,
                busy,
                lineKey: keyOf,
                fmtMoney,
                t: uiText,
                onQuantityChange: (key, value) => setInvoiceQuantities((current) => ({ ...current, [key]: value })),
                onPriceChange: (key, value) => setInvoicePrices((current) => ({ ...current, [key]: value })),
                onCurrencyChange: (value) => {
                  setSupplierInvoiceForm((current) => ({ ...current, currency: value }));
                  setInvoicePrices({});
                },
                onTaxChange: (key, value) => setInvoiceTaxes((current) => ({ ...current, [key]: value })),
                onAdjustmentsChange: (lines) => setInvoiceAdjustments(lines.map((line) => ({ ...line, rowId: line.rowId || crypto.randomUUID() }))),
                onFormChange: (field, value) => setSupplierInvoiceForm((current) => ({ ...current, [field]: value })),
              }
            : null
        }
        supplierInvoicesProps={{
          invoices: selectedSupplierInvoices,
          bills,
          approvalByInvoice,
          currencies,
          baseCurrencyCode,
          workflowApproval,
          busy,
          disputeReasons: invoiceDisputeReasons,
          resolutionNotes: invoiceResolutionNotes,
          canDispute: can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.disputed'),
          canResolve: can('purchasing.supplier_invoice.update') && can('purchasing.supplier_invoice.submitted'),
          canSubmit: can('purchasing.supplier_invoice.submitted'),
          canApprove: can('purchasing.supplier_invoice.approved'),
          onDisputeReasonChange: (id, value) => setInvoiceDisputeReasons((current) => ({ ...current, [id]: value })),
          onResolutionNoteChange: (id, value) => setInvoiceResolutionNotes((current) => ({ ...current, [id]: value })),
          onDispute: openSupplierInvoiceDispute,
          onResolve: resolveSupplierInvoiceDisputeAndSubmit,
          onSubmit: submitSupplierInvoice,
          onApprove: approveSupplierInvoice,
        }}
        receiptFormProps={receiptOrderId === selected.id ? {
          lines: receiptLines,
          products,
          note: receiptNote,
          busy,
          onClose: () => setReceiptOrderId(''),
          onLineChange: (index, field, value) => setReceiptLines((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [field]: value } : item)),
          onNoteChange: setReceiptNote,
          onSubmit: receiveGoods,
        } : null}
        receipts={selectedReceipts}
        returnsProps={can('purchasing.purchase_return.read') ? {
          selected,
          returns: selectedReturns,
          returnForm,
          generalReturnForm,
          returnInspection,
          returnAvailableQuantity,
          returnSourceUnit: units.get(returnSourceLineFor(returnInspection)?.uom || products.get(returnInspection?.product)?.uom)?.name,
          returnableLines,
          generalReturnLine,
          returnableInspections: selectedReturnInspections,
          supplierInvoices: selectedSupplierInvoices,
          products,
          units,
          approvalByReturn,
          workflowApproval,
          busy,
          canCreateQualityReturn: can('purchasing.purchase_return.create') && can('quality.inspection.read'),
          canCreateGeneralReturn: can('purchasing.purchase_return.create'),
          canSubmit: can('purchasing.purchase_return.submitted'),
          canApprove: can('purchasing.purchase_return.approved'),
          canDispatch: can('purchasing.purchase_return.dispatched'),
          canCancel: can('purchasing.purchase_return.cancelled'),
          onInspectionChange: selectReturnInspection,
          onReturnFormChange: (field, value) => setReturnForm((current) => ({ ...current, [field]: value })),
          onGeneralReturnFormChange: (field, value) => setGeneralReturnForm((current) => ({ ...current, [field]: value, ...(field === 'lineKey' ? { qty: '' } : {}) })),
          onCreateQualityReturn: createQualityReturn,
          onCreateGeneralReturn: createGeneralReturn,
          onAction: purchaseReturnAction,
        } : null}
      />}
    </div>}
  </div>;
}
