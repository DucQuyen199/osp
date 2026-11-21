import React from 'react';
import { statusLabel, uiText } from '../../../lib/i18n.js';

export default function PurchaseRequisitionsTable({
  requisitions,
  suppliers,
  warehouses,
  products,
  units,
  approvalByRequisition,
  orderByRequisition,
  workflowApproval,
  busy,
  can,
  onEdit,
  onAction,
}) {
  return <div className="table-wrap u-mt-16" ><table className="table">
    <thead><tr><th>{uiText('Đề nghị')}</th><th>{uiText('Người yêu cầu / lý do')}</th><th>{uiText('Hàng / số lượng')}</th><th>{uiText('Trạng thái / thao tác')}</th></tr></thead>
    <tbody>{requisitions.map((row) => {
      const request = approvalByRequisition.get(row.id);
      const order = orderByRequisition.get(row.id);
      return <tr key={row.id}>
        <td><strong>{suppliers.get(row.supplier)?.name || uiText('Đề nghị mua')}</strong><div className="small muted">{uiText('Kho')}: {warehouses.get(row.warehouse)?.name || '—'} · {String(row.id).slice(0, 8)}</div>
          {order && <div className="small"><a href={`#/e/purchasing/purchase_order/${order.id}`}>{uiText('Đơn mua nháp đã sinh ·')} {String(order.id).slice(0, 8)}</a></div>}
        </td>
        <td>{row.requested_by || '—'}<div className="small muted">{row.reason || uiText('Không có lý do')}</div></td>
        <td>{(row.lines || []).map((line, index) => <div key={`${line.product}-${index}`} className="small">{products.get(line.product)?.name || uiText('Hàng hóa')} · {line.qty} {line.uom_name || units.get(line.uom)?.name || units.get(products.get(line.product)?.uom)?.name || ''}</div>)}</td>
        <td><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span>
          {row.status === 'submitted' && workflowApproval && request && <div className="small"><a href={`#/e/workflow-approval/approval_request/${request.id}`}>{uiText('Mở yêu cầu duyệt ·')} {statusLabel(request.status)}</a></div>}
          <div className="row wrap">
            {['draft', 'rejected'].includes(row.status) && can('purchasing.purchase_requisition.update') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onEdit(row)}>{uiText('Sửa')}</button>}
            {['draft', 'rejected'].includes(row.status) && can('purchasing.purchase_requisition.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'submitted')}>{uiText('Gửi duyệt')}</button>}
            {['draft', 'rejected'].includes(row.status) && can('purchasing.purchase_requisition.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'cancelled')}>{uiText('Hủy')}</button>}
            {row.status === 'submitted' && !workflowApproval && can('purchasing.purchase_requisition.approved') && <>
              <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'approved')}>{uiText('Duyệt')}</button>
              {can('purchasing.purchase_requisition.rejected') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onAction(row, 'rejected')}>{uiText('Từ chối')}</button>}
            </>}
          </div>
        </td>
      </tr>;
    })}
    {!requisitions.length && <tr><td colSpan="4" className="muted">{uiText('Chưa có đề nghị mua nội bộ. Bạn cũng có thể sinh đề nghị từ màn bổ sung tồn kho.')}</td></tr>}
    </tbody>
  </table></div>;
}
