import React, { useMemo } from 'react';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';
import { addDecimals, compareDecimals, multiplyDecimals } from '../../../lib/decimal.js';
import { keyOf } from '../domain/purchasingSelectors.js';

export default function PurchaseOrderSummary({
  order,
  receipts,
  supplier,
  warehouse,
  products,
  units,
  approvalRequest,
  workflowApproval,
  bill,
  busy,
  canEdit,
  canSubmit,
  canApprove,
  canCancel,
  canReceive,
  onEdit,
  onSubmit,
  onApprove,
  onCancel,
  onReceive,
}) {
  const receivedByLine = useMemo(() => {
    const totals = new Map();
    receipts.filter((receipt) => receipt.status === 'received')
      .flatMap((receipt) => receipt.lines || [])
      .forEach((line) => totals.set(keyOf(line), addDecimals([totals.get(keyOf(line)) || 0, line.qty || 0])));
    return totals;
  }, [receipts]);

  return <>
    <div className="row wrap">
      <div>
        <h2>{supplier ? recordLabel('master-data.party', supplier) : uiText('Đơn mua hàng')}</h2>
        <div className="small muted">{uiText('Kho nhận:')} {warehouse?.name || '—'} · {uiText('Giao dự kiến')}: {fmtDate(order.expected_date)}</div>
      </div>
      <span className="grow" />
      <span className="badge warning">{statusLabel(order.status)}</span>
    </div>

    <div className="table-wrap u-mt-12">
      <table className="table">
        <thead><tr><th>{uiText('Hàng')}</th><th>{uiText('Đặt')}</th><th>{uiText('Đã nhận')}</th><th>{uiText('Đơn giá')}</th><th>{uiText('Thành tiền')}</th></tr></thead>
        <tbody>{(order.lines || []).map((line, index) => {
          const unitName = line.uom_name || units.get(line.uom)?.name || '';
          return <tr key={`${line.product}-${index}`}>
            <td>{products.get(line.product)?.name || uiText('Hàng hóa')}</td>
            <td>{line.qty} {unitName}</td>
            <td>{receivedByLine.get(keyOf(line)) || '0'} {unitName}</td>
            <td>{fmtMoney(line.price)}</td>
            <td>{fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0]))}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr><th colSpan="4">{uiText('Tổng có thuế')}</th><th>{fmtMoney(order.total || 0)}</th></tr></tfoot>
      </table>
    </div>

    {order.status === 'submitted' && workflowApproval && approvalRequest && <p className="small muted u-mt-10">
      {uiText('Yêu cầu phê duyệt:')} <a href={`#/e/workflow-approval/approval_request/${approvalRequest.id}`}>{statusLabel(approvalRequest.status)} · {uiText('mở yêu cầu')}</a>
    </p>}

    <div className="row wrap u-mt-12">
      {canEdit && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={onEdit}>{uiText('Sửa nháp')}</button>}
      {canSubmit && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy) || !(order.lines || []).length || compareDecimals(order.total || 0, 0) <= 0} onClick={onSubmit}>{uiText('Gửi duyệt')}</button>}
      {canApprove && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={onApprove}>{uiText('Duyệt đơn')}</button>}
      {canCancel && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={onCancel}>{uiText('Hủy đơn')}</button>}
      {canReceive && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={onReceive}>{uiText('Nhận hàng')}</button>}
      {bill && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/bill/${bill.id}`}>{uiText('Mở hóa đơn')} {statusLabel(bill.status)}</a>}
    </div>
  </>;
}
