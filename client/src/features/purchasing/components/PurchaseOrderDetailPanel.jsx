import React from 'react';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../../lib/i18n.js';
import PurchaseOrderSummary from './PurchaseOrderSummary.jsx';
import PurchaseReceiptForm from './PurchaseReceiptForm.jsx';
import PurchaseReturnsPanel from './PurchaseReturnsPanel.jsx';
import SupplierInvoiceDraftForm from './SupplierInvoiceDraftForm.jsx';
import SupplierInvoicesPanel from './SupplierInvoicesPanel.jsx';

/** Renders the selected purchase order and its controlled receipt/invoice/return workflows. */
export default function PurchaseOrderDetailPanel({
  summaryProps,
  invoiceDraftProps,
  supplierInvoicesProps,
  receiptFormProps,
  receipts,
  returnsProps,
}) {
  return <section className="card card-pad">
    <PurchaseOrderSummary {...summaryProps} />
    {invoiceDraftProps && <SupplierInvoiceDraftForm {...invoiceDraftProps} />}
    <SupplierInvoicesPanel {...supplierInvoicesProps} />
    {receiptFormProps && <PurchaseReceiptForm {...receiptFormProps} />}
    {receipts.length > 0 && <div className="table-wrap u-mt-14"><h3>{uiText('Lịch sử nhận hàng')}</h3><table className="table"><thead><tr><th>{uiText('Ngày')}</th><th>{uiText('Tổng phiếu')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{receipts.map((row) => <tr key={row.id}><td>{fmtDate(row.created_at)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}
    {returnsProps && <PurchaseReturnsPanel {...returnsProps} />}
    <p className="small muted">{uiText('Phiếu nhận cộng tồn kho theo số lượng thực nhận. Có thể nhập nhiều hóa đơn theo các đợt giao; mỗi hóa đơn chỉ được duyệt trong giới hạn số lượng đã nhận và chưa lập hóa đơn.')}</p>
  </section>;
}
