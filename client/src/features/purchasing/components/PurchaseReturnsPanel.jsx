import React from 'react';
import { fmtMoney, fmtNumber, statusLabel, uiText } from '../../../lib/i18n.js';

export default function PurchaseReturnsPanel({
  selected,
  returns,
  returnForm,
  generalReturnForm,
  returnInspection,
  returnAvailableQuantity,
  returnSourceUnit,
  returnableLines,
  generalReturnLine,
  returnableInspections,
  supplierInvoices,
  products,
  units,
  approvalByReturn,
  workflowApproval,
  busy,
  canCreateQualityReturn,
  canCreateGeneralReturn,
  canSubmit,
  canApprove,
  canDispatch,
  canCancel,
  onInspectionChange,
  onReturnFormChange,
  onGeneralReturnFormChange,
  onCreateQualityReturn,
  onCreateGeneralReturn,
  onAction,
}) {
  return <section className="card card-pad">
    <h3>{uiText('Trả hàng nhà cung cấp')}</h3>
    {canCreateQualityReturn && <form className="form-grid" onSubmit={onCreateQualityReturn}>
      <label className="field">
        <span className="label">{uiText('Phiếu QC không đạt *')}</span>
        <select className="select" required value={returnForm.inspection} onChange={(event) => onInspectionChange(event.target.value)}>
          <option value="">{uiText('Chọn phiếu QC')}</option>
          {returnableInspections.map((inspection) => <option key={inspection.id} value={inspection.id}>
            {products.get(inspection.product)?.name || uiText('Hàng hóa')} · {fmtNumber(Number(inspection.qty))} · {uiText(inspection.source === 'purchase_receipt' ? 'Phiếu nhận' : 'Đơn mua')} {String(inspection.source_id).slice(0, 8)}
          </option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{uiText('Hóa đơn nhà cung cấp')}</span>
        <select className="select" value={returnForm.supplier_invoice} onChange={(event) => onReturnFormChange('supplier_invoice', event.target.value)}>
          <option value="">{uiText('Không gắn hóa đơn')}</option>
          {supplierInvoices.filter((invoice) => invoice.status === 'approved').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {statusLabel(invoice.status)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{uiText('Số lượng trả')} ({returnSourceUnit || uiText('đơn vị gốc')}) *</span>
        <input className="input num" type="number" min="0.000001" max={returnAvailableQuantity} step="any" required disabled={!returnInspection} value={returnForm.qty} onChange={(event) => onReturnFormChange('qty', event.target.value)} />
        <span className="small muted">{uiText('Còn có thể trả:')} {fmtNumber(returnAvailableQuantity)}</span>
      </label>
      <label className="field full">
        <span className="label">{uiText('Lý do trả *')}</span>
        <input className="input" required maxLength="500" value={returnForm.reason} onChange={(event) => onReturnFormChange('reason', event.target.value)} />
      </label>
      <div className="row full">
        <span className="grow small muted">{uiText('Hàng chỉ được xuất sau khi phiếu trả được duyệt.')}</span>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !returnInspection || !(Number(returnForm.qty) > 0) || Number(returnForm.qty) > returnAvailableQuantity + 0.000001}>
          {busy === 'return:create' ? uiText('Đang lập phiếu…') : uiText('Lập phiếu trả nháp')}
        </button>
      </div>
    </form>}
    {canCreateGeneralReturn && selected && ['partially_received', 'received'].includes(selected.status) && <form className="form-grid" onSubmit={onCreateGeneralReturn}>
      <h4 className="field full">{uiText('Trả hàng khác (giao dư, sai mặt hàng)')}</h4>
      {returnableLines.length > 0 ? <>
        <label className="field">
          <span className="label">{uiText('Hàng đã nhận *')}</span>
          <select className="select" required value={generalReturnForm.lineKey} onChange={(event) => onGeneralReturnFormChange('lineKey', event.target.value)}>
            <option value="">{uiText('Chọn dòng hàng')}</option>
            {returnableLines.map((line) => <option key={line.key} value={line.key}>
              {products.get(line.product)?.name || uiText('Hàng hóa')}{line.lot_code ? ` · ${uiText('Lô')} ${line.lot_code}` : ''} · {uiText('còn trả')} {fmtNumber(line.qty)} {units.get(line.uom)?.name || ''} · {fmtMoney(line.price)}
            </option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">{uiText('Số lượng trả *')}</span>
          <input className="input num" type="number" min="0.000001" max={generalReturnLine?.qty || undefined} step="any" required disabled={!generalReturnLine} value={generalReturnForm.qty} onChange={(event) => onGeneralReturnFormChange('qty', event.target.value)} />
          <span className="small muted">{uiText('Còn thực nhận có thể trả:')} {fmtNumber(generalReturnLine?.qty || 0)}</span>
        </label>
        <label className="field">
          <span className="label">{uiText('Hóa đơn nhà cung cấp')}</span>
          <select className="select" value={generalReturnForm.supplier_invoice} onChange={(event) => onGeneralReturnFormChange('supplier_invoice', event.target.value)}>
            <option value="">{uiText('Chưa gắn hóa đơn')}</option>
            {supplierInvoices.filter((invoice) => invoice.status === 'approved').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {statusLabel(invoice.status)}</option>)}
          </select>
        </label>
        <label className="field full">
          <span className="label">{uiText('Lý do trả *')}</span>
          <input className="input" required maxLength="500" value={generalReturnForm.reason} onChange={(event) => onGeneralReturnFormChange('reason', event.target.value)} />
        </label>
        <div className="row full">
          <span className="grow small muted">{uiText('Số lượng được đối chiếu theo phiếu nhận và các phiếu trả đang xử lý.')}</span>
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !generalReturnLine || !(Number(generalReturnForm.qty) > 0) || Number(generalReturnForm.qty) > generalReturnLine.qty + 0.000001}>
            {busy === 'return:general:create' ? uiText('Đang lập phiếu…') : uiText('Lập phiếu trả nháp')}
          </button>
        </div>
      </> : <p className="small muted field full">{uiText('Không còn số lượng thực nhận để trả trên đơn này.')}</p>}
    </form>}
    {returns.length > 0 ? <div className="stack">
      {returns.map((row) => {
        const approval = approvalByReturn.get(row.id);
        const editable = ['draft', 'rejected'].includes(row.status);
        return <div className="row wrap" key={row.id}>
          <div className="grow">
            <strong>{row.reason || uiText('Trả hàng')}</strong>
            <div className="small muted">{(row.lines || []).map((line) => `${products.get(line.product)?.name || uiText('Hàng hóa')} · ${line.qty} ${line.uom_name || ''}`).join(' / ')} · {fmtMoney(row.total || 0)} · {statusLabel(row.status)}</div>
            {row.status === 'submitted' && workflowApproval && approval && <div className="small"><a href={`#/e/workflow-approval/approval_request/${approval.id}`}>{uiText('Mở yêu cầu duyệt ·')} {statusLabel(approval.status)}</a></div>}
          </div>
          <a className="btn btn-ghost btn-sm" href={`#/e/purchasing.purchase_return/${row.id}`}>{uiText('Chi tiết')}</a>
          {editable && canSubmit && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'submitted')}>{uiText('Gửi duyệt')}</button>}
          {row.status === 'submitted' && !workflowApproval && canApprove && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'approved')}>{uiText('Duyệt')}</button>}
          {row.status === 'approved' && canDispatch && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'dispatched')}>{uiText('Xuất trả')}</button>}
          {['approved', 'draft', 'rejected'].includes(row.status) && canCancel && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'cancelled')}>{uiText('Hủy phiếu')}</button>}
        </div>;
      })}
    </div> : <p className="small muted">{uiText('Chưa có phiếu trả hàng cho đơn mua này.')}</p>}
  </section>;
}
