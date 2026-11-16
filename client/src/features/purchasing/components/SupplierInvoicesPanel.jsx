import React from 'react';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../../lib/i18n.js';

export default function SupplierInvoicesPanel({
  invoices, bills, approvalByInvoice, currencies, baseCurrencyCode, workflowApproval, busy,
  disputeReasons, resolutionNotes, canDispute, canResolve, canSubmit, canApprove,
  onDisputeReasonChange, onResolutionNoteChange, onDispute, onResolve, onSubmit, onApprove,
}) {
  if (!invoices.length) return null;
  return <section className="card card-pad u-legacy-c53ea1da23">
    <h3>{uiText('Hóa đơn nhà cung cấp')}</h3>
    {invoices.map((invoice) => {
      const bill = bills.find((row) => row.supplier_invoice_id === invoice.id);
      const approval = approvalByInvoice.get(invoice.id);
      const variance = Number(invoice.price_variance || 0);
      const invoiceCurrencyCode = currencies.get(invoice.currency)?.code || baseCurrencyCode;
      const adjustmentSummary = (invoice.adjustments || []).map((item) => `${uiText(item.kind === 'discount' ? 'Chiết khấu' : 'Phí')}: ${item.description} ${fmtMoney(item.amount, invoiceCurrencyCode)}`).join(' · ');
      return <div className="row wrap u-legacy-a1f0ee6f62" key={invoice.id}>
        <div className="grow"><strong>{invoice.invoice_number}</strong>
          <div className="small muted">{fmtDate(invoice.issue_date)} · {fmtMoney(invoice.total, invoiceCurrencyCode)}{invoiceCurrencyCode !== baseCurrencyCode && invoice.base_total != null ? ` (${fmtMoney(invoice.base_total, baseCurrencyCode)})` : ''} · {statusLabel(invoice.status)}{Math.abs(variance) > 0.000001 ? <> · {uiText('Chênh lệch ròng sau quy đổi:')} {fmtMoney(variance, baseCurrencyCode)}</> : null}</div>
          {adjustmentSummary && <div className="small muted">{adjustmentSummary}</div>}
          {invoice.status === 'submitted' && approval && <div className="small"><a href={`#/e/workflow-approval/approval_request/${approval.id}`}>{uiText('Mở yêu cầu duyệt ·')} {statusLabel(approval.status)}</a></div>}
        </div>
        <a className="btn btn-ghost btn-sm" href={`#/e/purchasing.supplier_invoice/${invoice.id}`}>{uiText('Chi tiết')}</a>
        {invoice.status === 'submitted' && canDispute && <>
          <input className="input" aria-label={uiText('Lý do tranh chấp hóa đơn')} maxLength="500" placeholder={uiText('Lý do tranh chấp')} value={disputeReasons[invoice.id] ?? invoice.dispute_reason ?? ''} onChange={(event) => onDisputeReasonChange(invoice.id, event.target.value)}/>
          <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onDispute(invoice)}>{uiText('Mở tranh chấp')}</button>
        </>}
        {invoice.status === 'disputed' && canResolve && <>
          <input className="input" aria-label={uiText('Ghi chú giải quyết tranh chấp')} maxLength="1000" placeholder={uiText('Ghi chú giải quyết tranh chấp')} value={resolutionNotes[invoice.id] ?? ''} onChange={(event) => onResolutionNoteChange(invoice.id, event.target.value)}/>
          <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onResolve(invoice)}>{uiText('Giải quyết và gửi lại')}</button>
        </>}
        {['draft', 'rejected'].includes(invoice.status) && workflowApproval && canSubmit && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onSubmit(invoice)}>{invoice.status === 'rejected' ? uiText('Gửi duyệt lại') : uiText('Gửi duyệt')}</button>}
        {invoice.status === 'draft' && !workflowApproval && canApprove && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onApprove(invoice)}>{uiText('Duyệt và ghi sổ')}</button>}
        {bill && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/bill/${bill.id}`}>{uiText('Mở bill kế toán')}</a>}
      </div>;
    })}
  </section>;
}
